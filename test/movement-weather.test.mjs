import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { JSDOM }=require('jsdom');

const html=readFileSync('app/index.html','utf8');
const files=['app/history-sync-contract.js','app/history-backup-bridge.js','app/web-reminders.js','app/app.js'].map(f=>readFileSync(f,'utf8'));
const pause=(ms=120)=>new Promise(r=>setTimeout(r,ms));

async function boot({records,weather,geo=true,ids=[]}){
  const dom=new JSDOM(html,{url:'https://escudofit.example/app/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.localStorage.setItem('escudofit_web_auth_v1',JSON.stringify({user:{id:'qa',email:'qa@example.invalid',name:'QA'},access_token:'t',refresh_token:'r',entitlement:{mode:'VIP_LIFETIME'}}));
  const now=Date.now(), date=new Date().toLocaleDateString('en-CA');
  const calls=[];
  Object.defineProperty(w.navigator,'geolocation',{configurable:true,value:geo?{getCurrentPosition:(ok)=>ok({coords:{latitude:-23.5631,longitude:-46.6543}})}:undefined});
  w.fetch=async(url)=>{
    const u=String(url); calls.push(u); let d={};
    if(u.includes('action=weather'))d=weather||{ok:true,temperatureC:31.4};
    else if(u.endsWith('/entitlement/me'))d={mode:'VIP_LIFETIME'};
    else if(u.endsWith('/me'))d={user:{id:'qa',email:'qa@example.invalid',name:'QA'}};
    else if(u.endsWith('/history'))d={movement:[{date,updatedAtMs:now,records:records.map((r,i)=>({id:ids[i]||'m'+i,activityType:r[0],...(r[1]?{durationMinutes:r[1]}:{}),timestampMs:now-i*1000}))}]};
    else if(u.endsWith('/history/backup'))d={revision:0,entries:[]};
    return {ok:true,status:200,json:async()=>d};
  };
  for(const c of files)w.eval(c);
  await pause();
  return {w,calls,get:id=>w.document.getElementById(id)};
}

test('Movement shield completes with 30 minutes and shows partial progress before',async()=>{
  let {w,get}=await boot({records:[['STRENGTH',15]]});
  assert.equal(get('stepsPct').textContent,'50%');
  assert.equal(get('movementStatusPill').textContent,'EM ANDAMENTO');
  assert.match(get('movementHint').textContent,/15 de 30 min.*Faltam 15 min/);
  assert.match(get('heroWorkout').textContent,/Musculação • 15 min • 15 de 30 min hoje/);
  w.close();
  ({w,get}=await boot({records:[['STRENGTH',45],['WALKING',10]]}));
  assert.equal(get('stepsPct').textContent,'100%');
  assert.equal(get('movementStatusPill').textContent,'ESCUDO PROTEGIDO');
  assert.match(get('heroWorkout').textContent,/✅ Musculação • 45 min \(\+1\) • movimento concluído/);
  w.close();
  ({w,get}=await boot({records:[['WALKING',null]]}));
  assert.ok(get('movementWorkouts').classList.contains('hidden'),'no imported workout, no line');
  assert.equal(get('stepsPct').textContent,'0%');
  assert.match(get('movementHint').textContent,/Informe a duração/);
  w.close();
});

test('Weather is opt-in, uses rounded coordinates and shows on the main card',async()=>{
  const {w,get,calls}=await boot({records:[]});
  assert.match(get('heroWeather').textContent,/desativado/);
  assert.ok(!calls.some(u=>u.includes('action=weather')),'no location or weather call before opt-in');
  get('heroWeatherEnable').click();
  await pause(150);
  const call=calls.find(u=>u.includes('action=weather'));
  assert.match(call,/lat=-23\.56&lng=-46\.65$/);
  assert.match(get('heroWeather').textContent,/31,4 °C agora • Dia muito quente/);
  assert.match(get('weatherDetail').textContent,/31,4 °C/);
  assert.ok(get('heroWeatherEnable').classList.contains('hidden'));
  w.close();
});

test('Movement card shows workouts imported from the phone (Hevy via Health Connect)',async()=>{
  const {w,get}=await boot({records:[['STRENGTH',45]],ids:['hc-abc']});
  assert.ok(!get('movementWorkouts').classList.contains('hidden'));
  assert.match(get('movementWorkouts').textContent,/🏋️ Musculação • 45 min • \d\d:\d\d • Hevy \/ Health Connect/);
  w.close();
});
