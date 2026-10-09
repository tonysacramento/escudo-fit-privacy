import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bridge=require('../app/history-backup-bridge.js');
const json=value=>JSON.stringify(value);
const entry=(key,value)=>({key,value:json(value)});

test('recovers all history categories from authenticated Android backup',()=>{
  const snapshot={
    revision:7,
    entries:[
      entry('weight_history',[{id:'wb-1',weightKg:87.2,timestampMs:1791460800000,origin:'PROFILE'}]),
      entry('body_measurements_v1',[{date:'2026-10-08',waist:94,hips:106}]),
      entry('dose_records_history',[{id:'dose-1',appliedAtMs:1791460800000,applicationSite:'ARM_LEFT',scheduledDateIso:'2026-10-08'}]),
      entry('movement:2026-10-08',{updatedAtMs:1791460800000,records:[{id:'mov-1',activityType:'WALKING',timestampMs:1791460800000}]}),
      entry('nutrition:2026-10-08',{updatedAtMs:1791460800000,meals:[{id:'nut-1',mealType:'LUNCH',proteinG:30,timestampMs:1791460800000}]}),
      entry('water:2026-10-08',{updatedAtMs:1791460800000,consumedMl:1400}),
      entry('profile',{id:'profile-1',medication:'MOUNJARO',treatmentStartDateIso:'2026-10-01',updatedAtMs:1791460800000,medicationHistory:[{id:'t1',medication:'OZEMPIC',endDateIso:'2026-09-30',changedAtMs:1780000000000}]}),
      entry('app_access_plan',{mode:'PREMIUM'}),
    ],
  };
  const result=bridge.unpackBackup(snapshot);
  assert.equal(result.revision,7);
  assert.equal(result.validEntries,7);
  assert.equal(result.data.weights[0].weightKg,87.2);
  assert.equal(result.data.measurements[0].hips,106);
  assert.equal(result.data.applications[0].applicationSite,'ARM_LEFT');
  assert.equal(result.data.movement[0].records[0].id,'mov-1');
  assert.equal(result.data.nutrition[0].meals[0].proteinG,30);
  assert.equal(result.data.water[0].consumedMl,1400);
  assert.equal(result.data.treatment.medication,'MOUNJARO');
  assert.equal(result.data.treatment.history.length,1);
});

test('separately reports application reminder config preserved in backup but not rendered by Web',()=>{
  const snapshot={revision:1,entries:[
    entry('profile',{updatedAtMs:1800000000000,medication:'NONE'}),
    entry('weight_history',[{id:'w1',weightKg:89,timestampMs:1800000000000}]),
    entry('dose_schedule_config',{enabled:true,intervalHours:7}),
  ]};
  const unpacked=bridge.unpackBackup(snapshot);
  assert.equal(unpacked.totalEntries,3);
  assert.equal(unpacked.validEntries,2);
  assert.equal(unpacked.scheduleEntries,1);
  assert.equal(unpacked.revision,1);
  assert.equal(unpacked.data.weights.length,1);
  assert.equal(Object.hasOwn(unpacked.data,'dose_schedule_config'),false,
    'Do not present private medication schedule as a Web history category');
});

test('the structured API wins matching IDs while Android backup recovers remote-only records',()=>{
  const structured={weights:[{id:'a',weightKg:80,timestampMs:300}],applications:[],water:[{date:'2026-10-08',consumedMl:1000,updatedAtMs:300}]};
  const backup={weights:[{id:'a',weightKg:82,timestampMs:100},{id:'b',weightKg:79,timestampMs:200}],applications:[{id:'dose-x'}],water:[{date:'2026-10-08',consumedMl:700,updatedAtMs:200},{date:'2026-10-07',consumedMl:900,updatedAtMs:100}]};
  const result=bridge.mergeHistorySources(structured,backup);
  assert.equal(result.weights.length,2);
  assert.equal(result.weights.find(x=>x.id==='a').weightKg,80);
  assert.equal(result.weights.find(x=>x.id==='b').weightKg,79);
  assert.equal(result.applications.length,1);
  assert.equal(result.water.find(x=>x.date==='2026-10-08').consumedMl,1000);
  assert.equal(result.water.find(x=>x.date==='2026-10-07').consumedMl,900);
});

test('a newer backup correction wins per-day data but empty backups never delete primary',()=>{
  const result=bridge.mergeHistorySources({
    nutrition:[{date:'2026-10-08',updatedAtMs:100,meals:[{id:'old'}]}],
    water:[{date:'2026-10-08',updatedAtMs:100,consumedMl:900}],
  },{
    nutrition:[{date:'2026-10-08',updatedAtMs:200,meals:[{id:'new'}]}],
    water:[{date:'2026-10-08',updatedAtMs:200,consumedMl:0}],
  });
  assert.equal(result.nutrition[0].meals[0].id,'new');
  assert.equal(result.water[0].consumedMl,0);
  const preserved=bridge.mergeHistorySources({weights:[{id:'a'}]},null);
  assert.equal(preserved.weights[0].id,'a');
});

test('ignores invalid backup keys, malformed JSON, invalid dates, and no ownership data',()=>{
  const snapshot={revision:10,entries:[
    {key:'weight_history',value:'not-json'},
    entry('water:2026-02-31',{consumedMl:1000,updatedAtMs:200}),
    entry('auth_token',{access_token:'do-not-import'}),
    entry('water:2026-10-08',{consumedMl:750,updatedAtMs:100}),
    entry('dose_records_history',[{id:'bad',appliedAtMs:'invalid'}])
  ]};
  const result=bridge.unpackBackup(snapshot);
  assert.equal(result.data.water.length,1);
  assert.equal(result.data.applications.length,0);
  assert.equal(result.data.weights.length,0);
  assert.equal(result.data.treatment,null);
  assert.equal(Object.hasOwn(result.data,'auth_token'),false);
});
