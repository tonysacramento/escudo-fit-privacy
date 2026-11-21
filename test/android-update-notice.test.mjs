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
const reminders=readFileSync('app/web-reminders.js','utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
const APK='https://github.com/tonysacramento/escudo-fit-privacy/releases/download/v46-full-qa/escudo-fit-v46-full.apk';

async function boot({userAgent,mode='VIP_LIFETIME',manifest}){
  const dom=new JSDOM(html,{url:'https://escudofit.example/app/',runScripts:'outside-only',pretendToBeVisual:true});
  const {window}=dom;
  Object.defineProperty(window.navigator,'userAgent',{value:userAgent,configurable:true});
  window.scrollTo=()=>{};
  window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.localStorage.setItem('escudofit_web_auth_v1',JSON.stringify({
    user:{id:'qa-user',email:'qa@example.invalid',name:'QA'},access_token:'t',refresh_token:'r',entitlement:{mode},
  }));
  window.fetch=async(url)=>{
    const path=String(url);
    let data={};
    if(path.endsWith('update.json'))data=manifest;
    else if(path.endsWith('/entitlement/me'))data={mode};
    else if(path.endsWith('/me'))data={user:{id:'qa-user',email:'qa@example.invalid',name:'QA'}};
    else if(path.endsWith('/history'))data={};
    else if(path.endsWith('/history/backup'))data={revision:0,entries:[]};
    return {ok:true,status:200,json:async()=>data};
  };
  for(const code of [contract,bridge,reminders,js])window.eval(code);
  await pause();
  return window;
}
const android='Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
const manifest={available:true,latestBuild:46,latestVersion:'1.0.46',message:'Atualize para ter as novidades.',changes:['Medidas: Tórax no lugar de Abdômen','Treinos do Hevy no Movimento'],updateUrl:APK};

test('Android visitor with the full app sees the update notice with the changes',async(t)=>{
  const w=await boot({userAgent:android,manifest});
  t.after(()=>w.close());
  const box=w.document.getElementById('androidUpdateNotice');
  assert.ok(!box.classList.contains('hidden'));
  assert.match(w.document.getElementById('androidUpdateTitle').textContent,/1\.0\.46/);
  assert.equal(w.document.querySelectorAll('#androidUpdateChanges li').length,2);
  assert.equal(w.document.getElementById('androidUpdateLink').href,APK);
  assert.equal(w.document.getElementById('downloadAndroidFull').href,APK);
  w.document.getElementById('androidUpdateLater').click();
  assert.ok(box.classList.contains('hidden'));
});

test('no notice when nothing is published, on desktop, for Free or with an unsafe link',async()=>{
  for(const opts of [
    {userAgent:android,manifest:{...manifest,available:false}},
    {userAgent:desktop,manifest},
    {userAgent:android,manifest,mode:'FREE'},
    {userAgent:android,manifest:{...manifest,updateUrl:'https://evil.example/app.apk'}},
  ]){
    const w=await boot(opts);
    try{assert.ok(w.document.getElementById('androidUpdateNotice').classList.contains('hidden'),JSON.stringify(opts).slice(0,80));}
    finally{w.close();}
  }
});
