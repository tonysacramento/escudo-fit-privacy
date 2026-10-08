import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { JSDOM }=require('jsdom');

const html=readFileSync('app/index.html','utf8');
const js=readFileSync('app/app.js','utf8');
const contract=readFileSync('app/history-sync-contract.js','utf8');
const bridge=readFileSync('app/history-backup-bridge.js','utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,55));

test('synthetic authenticated Web session renders all categories and posts two-way compatible records',async()=>{
  const dom=new JSDOM(html,{
    url:'https://escudofit.example/app/',runScripts:'outside-only',pretendToBeVisual:true,
  });
  const {window}=dom;
  try {
  window.scrollTo=()=>{};
  window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.localStorage.setItem('escudofit_web_auth_v1',JSON.stringify({
    user:{id:'qa-user',email:'qa@example.invalid',name:'QA'},
    access_token:'test-access',refresh_token:'test-refresh',
    entitlement:{mode:'PREMIUM'}
  }));
  const now=Date.now()-10000;
  const date=new Date().toLocaleDateString('en-CA'); // current local synthetic day in CI
  const apiDate=/^\d{4}-\d{2}-\d{2}$/.test(date)?date:new Date().toISOString().slice(0,10);
  const payload={
    weights:[{id:'w1',weightKg:87.2,timestampMs:now,origin:'PROFILE'}],
    measurements:[{date:apiDate,waist:90,hips:95}],
    applications:[{id:'a1',appliedAtMs:now,applicationSite:'ABDOMEN_LEFT',scheduledDateIso:apiDate}],
    movement:[{date:apiDate,updatedAtMs:now,records:[{id:'mv1',activityType:'WALKING',timestampMs:now}]}],
    nutrition:[{date:apiDate,updatedAtMs:now,meals:[{id:'ml1',mealType:'LUNCH',proteinG:22,timestampMs:now}]}],
    treatment:{medication:'MOUNJARO',updatedAtMs:now,treatmentStartDateIso:apiDate,history:[]},
    water:[{date:apiDate,consumedMl:500,updatedAtMs:now}],
  };
  const calls=[];
  let offline=false;
  let structuredHistory=payload;
  let backupSnapshot={revision:0,entries:[]};
  window.fetch=async(url,options={})=>{
    const path=String(url);
    calls.push({path,options});
    if(offline&&path.endsWith('/history/sync'))throw new Error('SIMULATED_NETWORK_OFFLINE');
    let data={};
    if(path.endsWith('/entitlement/me'))data={mode:'PREMIUM'};
    else if(path.endsWith('/me'))data={user:{id:'qa-user',email:'qa@example.invalid',name:'QA'}};
    else if(path.endsWith('/history'))data=structuredHistory;
    else if(path.endsWith('/history/backup'))data=backupSnapshot;
    else if(path.endsWith('/history/sync'))data={synced:true};
    else throw new Error('Unexpected API path '+path);
    return {ok:true,status:200,json:async()=>data};
  };
  window.eval(contract);
  window.eval(bridge);
  window.eval(js);
  await pause();
  const get=id=>window.document.getElementById(id);
  assert.ok(get('appExperience')&&!get('appExperience').classList.contains('hidden'),JSON.stringify({
    calls:calls.map(call=>call.path),
    auth:window.localStorage.getItem('escudofit_web_auth_v1'),
    marketing:get('marketingExperience')?.className,
    app:get('appExperience')?.className,
    login:get('loginStatus')?.textContent,
  }));
  assert.match(get('historySyncStatus').textContent,/1 pesos|1 peso/);
  assert.match(get('historySyncStatus').textContent,/1 aplicações/);
  assert.match(get('historySyncStatus').textContent,/1 refeições/);
  assert.match(get('historySyncStatus').textContent,/Nutrição recebida: API 1, backup 0/);
  assert.match(get('historySyncStatus').textContent,/1 tratamento/);
  assert.match(get('measurementHistoryList').textContent,/95/);
  assert.match(get('movementHistoryList').textContent,/Caminhada/);
  assert.match(get('nutritionHistoryList').textContent,/22/);
  assert.match(get('treatmentHistoryList').textContent,/Mounjaro/);

  get('nutritionMealType').value='DINNER';
  get('nutritionMealProtein').value='25';
  get('nutritionMealDescription').value='Jantar QA';
  get('nutritionAddMeal').click();
  await pause();
  const meals=calls.filter(c=>c.path.endsWith('/history/sync'))
    .map(c=>JSON.parse(c.options.body||'{}')).filter(x=>x.nutrition);
  assert.ok(meals.length>=1,'Web should POST nutrition');
  assert.equal(meals.at(-1).nutrition[0].meals.at(-1).proteinG,25);

  get('treatmentMedication').value='WEGOVY';
  get('treatmentDose').value='registro do usuário';
  get('treatmentStart').value=apiDate;
  get('saveTreatment').click();
  await pause();
  const treatments=calls.filter(c=>c.path.endsWith('/history/sync'))
    .map(c=>JSON.parse(c.options.body||'{}')).filter(x=>x.treatment);
  assert.ok(treatments.length>=1,'Web should POST treatment');
  assert.equal(treatments.at(-1).treatment.medication,'WEGOVY');
  assert.equal(window.localStorage.getItem('escudofit_history_outbox_v1_qa-user'),'[]');

  // Old Android versions may have uploaded a backup but no structured history.
  structuredHistory={};
  const backupDate=new Date(Date.parse(apiDate+'T12:00:00.000Z')-86400000).toISOString().slice(0,10);
  backupSnapshot={
    revision:4,
    entries:[
      {key:'weight_history',value:JSON.stringify([{id:'only-in-backup',weightKg:72.3,timestampMs:now,origin:'PROFILE'}])},
      {key:'body_measurements_v1',value:JSON.stringify([{date:backupDate,waist:78,hips:97}])},
      {key:'dose_records_history',value:JSON.stringify([{id:'only-backup-dose',appliedAtMs:now,applicationSite:'ARM_RIGHT'}])},
      {key:'movement:'+backupDate,value:JSON.stringify({updatedAtMs:now,records:[{id:'bk-move',activityType:'WALKING',timestampMs:now}]})},
      {key:'nutrition:'+backupDate,value:JSON.stringify({updatedAtMs:now,meals:[{id:'bk-meal-1',mealType:'LUNCH',proteinG:33,timestampMs:now},{id:'bk-meal-2',mealType:'DINNER',proteinG:19,timestampMs:now}]})},
      {key:'water:'+backupDate,value:JSON.stringify({updatedAtMs:now,consumedMl:910})},
    ]
  };
  get('refreshHistoryButton').click();
  await pause();
  assert.match(get('historySyncStatus').textContent,/Backup 200 \(revisão 4/);
  assert.match(get('weightHistory').textContent,/72,3/);
  assert.match(get('waterHistoryList').textContent,/910/);
  assert.match(get('applicationHistory').textContent,/Braço direito/);
  assert.match(get('nutritionHistoryList').textContent,/33/);
  assert.match(get('nutritionHistoryList').textContent,/19/);
  assert.match(get('historySyncStatus').textContent,/Nutrição recebida: API 0, backup 2/);

  backupSnapshot={revision:0,entries:[]};
  get('refreshHistoryButton').click();
  await pause();
  assert.match(get('historySyncStatus').textContent,/Nutrição recebida: API 0, backup 0|Nutrição ausente na conta: API 0, backup 0/);
  // Local browser data remains preserved; zero remote sources cannot erase it.
  assert.match(get('nutritionHistoryList').textContent,/33/);

  offline=true;
  get('waterReset').click();
  await pause();
  assert.equal(JSON.parse(window.localStorage.getItem('escudofit_history_outbox_v1_qa-user')||'[]').length,1,
    'offline update is queued per account');
  offline=false;
  get('refreshHistoryButton').click();
  await pause();
  assert.equal(window.localStorage.getItem('escudofit_history_outbox_v1_qa-user'),'[]',
    'pending Web write is retried before reading account history');
  } finally {
    dom.window.close();
  }
});
