import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { JSDOM }=require('jsdom');
const html=readFileSync('app/index.html','utf8');
const files=['app/history-sync-contract.js','app/history-backup-bridge.js','app/web-reminders.js','app/app.js'].map(f=>readFileSync(f,'utf8'));
const pause=(ms=150)=>new Promise(r=>setTimeout(r,ms));
const KEY='0123abcd-4567-89ef-0123-456789abcdef';

async function boot({hevyStatus=200,existing=[]}={}){
  const dom=new JSDOM(html,{url:'https://escudofit.example/app/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.localStorage.setItem('escudofit_web_auth_v1',JSON.stringify({user:{id:'qa',email:'qa@example.invalid',name:'QA'},access_token:'t',refresh_token:'r',entitlement:{mode:'VIP_LIFETIME'}}));
  const now=Date.now(), date=new Date().toLocaleDateString('en-CA');
  const start=new Date(now-2*3600000), end=new Date(start.getTime()+45*60000);
  const calls=[], posts=[];
  w.fetch=async(url,options={})=>{
    const u=String(url); calls.push({u,h:options.headers||{}});
    if(u.startsWith('https://api.hevyapp.com/')){
      if(hevyStatus!==200)return {ok:false,status:hevyStatus,json:async()=>({})};
      const d=u.includes('/count')?{workout_count:2}:{page:1,page_count:1,workouts:[
        {id:'w1',title:'Treino A',start_time:start.toISOString(),end_time:end.toISOString()},
        {id:'old',title:'Antigo',start_time:'2020-01-01T10:00:00Z',end_time:'2020-01-01T11:00:00Z'}]};
      return {ok:true,status:200,json:async()=>d};
    }
    let d={};
    if(u.endsWith('/entitlement/me'))d={mode:'VIP_LIFETIME'};
    else if(u.endsWith('/me'))d={user:{id:'qa',email:'qa@example.invalid',name:'QA'}};
    else if(u.endsWith('/history'))d={movement:existing.length?[{date,updatedAtMs:now,records:existing.map(id=>({id,activityType:'STRENGTH',durationMinutes:45,timestampMs:start.getTime()+60000}))}]:[]};
    else if(u.endsWith('/history/backup'))d={revision:0,entries:[]};
    else if(u.endsWith('/history/sync')){posts.push(JSON.parse(options.body||'{}'));d={synced:true};}
    return {ok:true,status:200,json:async()=>d};
  };
  for(const c of files)w.eval(c);
  await pause();
  return {w,calls,posts,get:id=>w.document.getElementById(id)};
}

test('Hevy: key stays in the browser, recent workouts count for the 30-min shield',async()=>{
  const {w,get,calls,posts}=await boot();
  assert.ok(!calls.some(c=>c.u.includes('hevyapp')),'no Hevy call before connecting');
  get('hevyKey').value=KEY; get('hevyConnect').click();
  await pause(400);
  const hevyCalls=calls.filter(c=>c.u.includes('hevyapp'));
  assert.ok(hevyCalls.every(c=>c.h['api-key']===KEY));
  assert.ok(!calls.some(c=>!c.u.includes('hevyapp')&&JSON.stringify(c).includes(KEY)),'key never sent to Escudo Fit');
  assert.equal(get('stepsPct').textContent,'100%');
  assert.match(get('hevyList').textContent,/Treino A • 45 min/);
  assert.ok(!get('hevyList').textContent.includes('Antigo'),'only the last 7 days');
  const sent=posts.flatMap(p=>p.movement||[]).flatMap(d=>d.records);
  assert.ok(sent.some(r=>r.id==='hevy-w1'&&r.activityType==='STRENGTH'&&r.durationMinutes===45));
  get('hevyDisconnect').click();
  assert.equal(w.localStorage.getItem('escudo_hevy_key_qa'),null);
  w.close();
});

test('Hevy: skips a workout already imported by Android (hc-) and reports a refused key',async()=>{
  let {w,get,posts}=await boot({existing:['hc-abc']});
  get('hevyKey').value=KEY; get('hevyConnect').click(); await pause(400);
  assert.ok(!posts.flatMap(p=>p.movement||[]).flatMap(d=>d.records).some(r=>r.id==='hevy-w1'),'no duplicate of the Health Connect import');
  w.close();
  ({w,get}=await boot({hevyStatus:401}));
  get('hevyKey').value=KEY; get('hevyConnect').click(); await pause(300);
  assert.equal(w.localStorage.getItem('escudo_hevy_key_qa'),null);
  assert.ok(!get('hevyDisconnected').classList.contains('hidden'));
  w.close();
});
