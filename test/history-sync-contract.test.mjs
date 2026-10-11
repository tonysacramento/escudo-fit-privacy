import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const c=require('../app/history-sync-contract.js');

test('all seven history categories are counted for QA diagnostics',()=>{
  assert.deepEqual(c.countHistory({
    weights:[{id:'w'}],measurements:[{date:'2026-10-08'}],
    applications:[{id:'a'}],
    movement:[{date:'2026-10-08',records:[{id:'m1'},{id:'m2'}]}],
    nutrition:[{date:'2026-10-08',meals:[{id:'n1'}]}],
    treatment:{medication:'NONE',updatedAtMs:100},
    water:[{date:'2026-10-08',consumedMl:500}]
  }),{
    weights:1,measurements:1,applications:1,movement:2,
    nutrition:1,treatment:1,water:1,
  });
});

test('measurement hips use the exact API field and valid dates',()=>{
  assert.equal(c.asMeasurement({date:'2026-10-08',hips:103}).hips,103);
  assert.equal(c.asMeasurement({date:'2026-10-08',hip:98}).hips,98);
  assert.equal(c.asMeasurement({date:'2026-02-30',hips:102}),null);
});

test('Web keeps independent meals from Android even when daily update timestamps differ',()=>{
  const remote=[{date:'2026-10-08',updatedAtMs:200,meals:[{id:'web',at:'2026-10-08T15:00:00Z'}]}];
  const local=[{date:'2026-10-08',updatedAtMs:300,meals:[
    {id:'android-1',at:'2026-10-08T08:00:00Z'},
    {id:'android-2',at:'2026-10-08T12:00:00Z'},
  ]}];
  const first=c.mergeNutritionDays(local,remote);
  assert.deepEqual(first[0].meals.map(meal=>meal.id),['android-1','android-2','web']);
  assert.equal(first[0].updatedAtMs,300);
  const webNewer=c.mergeNutritionDays([{...local[0],updatedAtMs:100}],remote);
  assert.deepEqual(webNewer[0].meals.map(meal=>meal.id),['android-1','android-2','web']);
  const repeat=c.mergeNutritionDays(first,remote);
  assert.equal(repeat[0].meals.length,3,'same ID must never duplicate a meal');
});

test('Web preserves latest edit for an identical meal ID while keeping unique records',()=>{
  const remote=[{date:'2026-10-08',updatedAtMs:300,meals:[{id:'same',proteinG:25,at:'2026-10-08T12:00:00Z'}]}];
  const local=[{date:'2026-10-08',updatedAtMs:200,meals:[{id:'same',proteinG:20,at:'2026-10-08T12:00:00Z'}]}];
  assert.equal(c.mergeNutritionDays(local,remote)[0].meals[0].proteinG,25);
  assert.equal(c.mergeNutritionDays([{...local[0],updatedAtMs:300}],remote)[0].meals[0].proteinG,20);
});

test('Web does not resurrect meals deleted on Android from an older local cache',()=>{
  const remote=[{date:'2026-10-09',updatedAtMs:300,deletedIds:['gone'],
    meals:[{id:'keep',at:'2026-10-09T08:00:00Z'}]}];
  const local=[{date:'2026-10-09',updatedAtMs:200,meals:[
    {id:'gone',at:'2026-10-09T07:00:00Z'},
    {id:'keep',at:'2026-10-09T08:00:00Z'},
  ]}];
  const merged=c.mergeNutritionDays(local,remote);
  assert.deepEqual(merged[0].meals.map(x=>x.id),['keep']);
  assert.deepEqual(merged[0].deletedIds,['gone']);
  const stale=c.mergeNutritionDays(local,merged);
  assert.deepEqual(stale[0].meals.map(x=>x.id),['keep']);
  assert.deepEqual(c.nutritionPatch({...merged[0],meals:[{
    id:'keep',mealType:'BREAKFAST',proteinG:12,at:'2026-10-09T08:00:00Z',
  }]}).deletedIds,['gone']);
});

test('nutrition patch matches backend required meal fields and validates protein',()=>{
  const at='2026-10-08T12:00:00.000Z';
  const day=c.nutritionPatch({date:'2026-10-08',updatedAtMs:1791460800000,meals:[
    {id:'web-meal-1',mealType:'LUNCH',proteinG:27.5,at,description:'Almoço'},
  ]});
  assert.deepEqual(day.meals[0],{
    id:'web-meal-1',mealType:'LUNCH',proteinG:27.5,timestampMs:Date.parse(at),description:'Almoço',
  });
  assert.throws(()=>c.nutritionPatch({date:'2026-10-08',updatedAtMs:3,meals:[
    {id:'x',mealType:'LUNCH',proteinG:-2,at},
  ]}),/INVALID_MEAL/);
});

test('treatment patch supports medication timeline with no dose recommendation',()=>{
  const source={medication:'MOUNJARO',updatedAtMs:100,treatmentStartDateIso:'2026-10-08',history:[
    {id:'past',medication:'OZEMPIC',startDateIso:'2026-09-01',endDateIso:'2026-10-08',changedAtMs:98},
  ]};
  assert.equal(c.treatmentPatch(source).history[0].medication,'OZEMPIC');
  assert.throws(()=>c.treatmentPatch({...source,treatmentStartDateIso:'2026-14-81'}),/INVALID_TREATMENT_DATE/);
});

test('Web markup, service worker and client share same revision and full history entry points',()=>{
  const html=fs.readFileSync('app/index.html','utf8');
  const js=fs.readFileSync('app/app.js','utf8');
  const sw=fs.readFileSync('app/sw.js','utf8');
  const version=/<meta name="escudo-fit-build" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(version,'Web HTML must declare a build version');
  assert.ok(version.startsWith('web-v43-'),'keep the approved v43 Web identity');
  assert.ok(sw.includes(version),'service worker must cache the same HTML build');
  for(const asset of ['styles.css','app.js','history-sync-contract.js','history-backup-bridge.js','body-map.js']){
    assert.ok(html.includes(asset+'?v='+version),'HTML version for '+asset);
    assert.ok(sw.includes(asset+'?v='+version),'service worker version for '+asset);
  }
  assert.match(html,/data-view="nutrition"/);
  assert.match(html,/data-view="weight"/);
  assert.match(html,/id="approvedBodyMap"/);
  assert.match(html,/data-application-site="ABDOMEN_LEFT"/);
  assert.match(sw,/body-map\.js/);
  assert.match(sw,/android-icon\.svg/);
  for(const id of ['nutritionAddMeal','saveTreatment','refreshHistoryButton','historySyncStatus','waterHistoryList','measurementHistoryList','movementHistoryList','nutritionHistoryList','treatmentHistoryList']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  for(const marker of ['historyContract.nutritionPatch','historyContract.treatmentPatch','historyContract.countHistory',
    'syncHistoryPatch({nutrition:[patch]})','syncHistoryPatch({treatment:patch})',
    'syncHistoryPatch({movement:[','syncHistoryPatch({applications:[',
    'syncHistoryPatch({weights:[','water:[{date:localDayKey()',
    'syncHistoryPatch({weights:[],measurements:[remote]})']){
    assert.ok(js.includes(marker),marker);
  }
  assert.ok(!js.includes("proteinInput').addEventListener('change'"),'protein must be event sourced');
});

