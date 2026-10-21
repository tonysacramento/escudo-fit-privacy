import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import contract from '../app/history-sync-contract.js';

const html=readFileSync('app/index.html','utf8');
const js=readFileSync('app/app.js','utf8');
const sw=readFileSync('app/sw.js','utf8');
const treatments=['OZEMPIC','WEGOVY','MOUNJARO','SAXENDA','OZIVY','SEMAVY','OWOZY','SEEMASUN',
  'ZEMPNEO','ORSEMA','SEMACLIQUE','SEMAGLUTIDE_GENERIC','OTHER','NONE'];
const newcomers=['OZIVY','SEMAVY','OWOZY','SEEMASUN','ZEMPNEO','ORSEMA','SEMACLIQUE','SEMAGLUTIDE_GENERIC'];

test('all legacy and Anvisa-registered new medications appear in the exact treatment selector',()=>{
  const select=/<select id="treatmentMedication">([\s\S]*?)<\/select>/.exec(html)?.[1];
  assert.ok(select,'Existing treatment selector must remain');
  for(const code of treatments){
    assert.match(select,new RegExp('<option value="'+code+'">'));
    assert.doesNotMatch(select,new RegExp('<option value="'+code+'">[\\s\\S]*?<option value="'+code+'">'));
  }
  assert.match(html,/data-focus-target="treatmentMedication"/,'application screen reaches actual treatment form');
  assert.match(html,/id="applicationTreatmentLabel"/);
  assert.match(js,/medicationLabels\[state.treatment.medication\]/);
  assert.match(html,/A lista não constitui indicação, recomendação de dose/);
});

test('new and old medication codes are accepted in history contract, unknown codes rejected',()=>{
  for(const medication of treatments){
    const payload=contract.treatmentPatch({
      medication,updatedAtMs:100,treatmentStartDateIso:'2026-10-13',medicationDoseLabel:'informada pelo usuário',
      history:[{id:'prior-legacy',medication:'OZEMPIC',changedAtMs:80}],
    });
    assert.equal(payload.medication,medication);
    assert.equal(payload.history[0].medication,'OZEMPIC','historical IDs must be preserved');
  }
  assert.throws(()=>contract.treatmentPatch({medication:'NON_REGULATED_CODE',updatedAtMs:100}),/INVALID_TREATMENT/);
  assert.ok(newcomers.length>=7);
});

test('PWA cache tracks the current Web revision and preload of core code',()=>{
  const version=/<meta name="escudo-fit-build" content="([^"]+)"/.exec(html)?.[1];
  assert.match(version,/^web-v[0-9]+-[a-z0-9-]+$/);
  const cache=/const CACHE=['"]([^'"]+)['"]/.exec(sw)?.[1];
  assert.match(cache,/^escudo-fit-web-v[0-9]+-[a-z0-9-]+$/);
  const scripts=Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g),m=>m[1]);
  for(const asset of ['history-sync-contract.js','app.js']){
    const src=scripts.find(value=>value.startsWith('./'+asset+'?v='));
    assert.ok(src,'versioned core script is present: '+asset);
    const revision=new URL(src,'https://escudofit.com.br/app/').searchParams.get('v');
    assert.match(revision,/^web-v[0-9]+-[a-z0-9-]+$/);
    assert.ok(sw.includes(src),'cache preloads the actual HTML revision: '+asset);
  }
});

test('future push receiver uses fixed privacy-safe messages; no background delivery without server',async()=>{
  const handlers={};
  const calls=[];
  const self={
    location:{origin:'https://escudofit.com.br'},
    registration:{
      scope:'https://escudofit.com.br/app/',
      showNotification:async(title,options)=>calls.push({title,options}),
    },
    addEventListener:(name,fn)=>{handlers[name]=fn},
    clients:{
      matchAll:async()=>[],
      openWindow:async url=>({url}),
    },
  };
  vm.runInNewContext(sw,{self,URL,caches:{},fetch,console});
  assert.equal(typeof handlers.push,'function');
  assert.equal(typeof handlers.notificationclick,'function');
  let waiting;
  handlers.push({data:{json:()=>({kind:'APPLICATION',medication:'private-name',dose:'private-dose'})},
    waitUntil:p=>{waiting=p}});
  await waiting;
  assert.equal(calls.length,1);
  assert.equal(calls[0].title,'Escudo Fit — lembrete');
  assert.doesNotMatch(JSON.stringify(calls[0]),/private-name|private-dose/);
  handlers.push({data:{json:()=>({kind:'UNKNOWN'})},waitUntil:p=>{waiting=p}});
  assert.equal(calls.length,1,'do not display arbitrary notification types');
  assert.match(sw,/REQUIRES a separately/,'the SW alone is not background delivery');
});
