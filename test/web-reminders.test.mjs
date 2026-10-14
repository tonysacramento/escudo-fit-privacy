import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { dueHydration, dueApplication }=require('../app/web-reminders.js');

test('hydration is disabled unless explicitly enabled, respects user hours and cadence',()=>{
  const s={enabled:true,intervalHours:2,start:'07:00',end:'22:00'};
  assert.match(dueHydration(s,new Date(2026,9,13,9,0)),/2026-10-13:water:540$/);
  assert.equal(dueHydration(s,new Date(2026,9,13,9,4)),null);
  assert.equal(dueHydration(s,new Date(2026,9,13,6,59)),null);
  assert.equal(dueHydration(s,new Date(2026,9,13,23,0)),null);
  assert.equal(dueHydration({...s,enabled:false},new Date(2026,9,13,9,0)),null);
  assert.equal(dueHydration({...s,start:'22:00',end:'07:00'},new Date(2026,9,13,23,0)),null);
  assert.equal(dueHydration({...s,intervalHours:0},new Date(2026,9,13,9,0)),null);
});

test('application reminder supports daily, weekly and configurable multi-day cycle',()=>{
  const now=new Date(2026,9,13,9,0);
  const s={enabled:true,frequency:'DAILY',weekday:1,intervalDays:3,anchor:'2026-10-10',time:'09:00'};
  assert.match(dueApplication(s,now),/2026-10-13:application:540$/);
  assert.equal(dueApplication(s,new Date(2026,9,13,9,4)),null);
  assert.equal(dueApplication({...s,enabled:false},now),null);
  assert.equal(dueApplication({...s,anchor:'2026-10-14'},now),null);
  assert.equal(dueApplication({...s,frequency:'OTHER'},now),'2026-10-13:application:540');
  assert.equal(dueApplication({...s,frequency:'OTHER',intervalDays:4},now),null);
  assert.equal(dueApplication({...s,frequency:'WEEKLY',weekday:now.getDay()},now),'2026-10-13:application:540');
  assert.equal(dueApplication({...s,frequency:'WEEKLY',weekday:(now.getDay()+1)%7},now),null);
  assert.equal(dueApplication({...s,time:'99:99'},now),null);
});

test('Web page contains explicit measurement routes, reminders and no false background push claim',()=>{
  const fs=require('node:fs');
  const html=fs.readFileSync('app/index.html','utf8');
  const appJs=fs.readFileSync('app/app.js','utf8');
  const sw=fs.readFileSync('app/sw.js','utf8');
  for(const id of ['profileMeasurementSummary','measurementHistoryList','webHydrationEnabled','webHydrationSave','webApplicationEnabled','webApplicationSave'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/MEDIDAS CORPORAIS/);
  assert.match(html,/não alteram o calendário nem as notificações do Android/);
  assert.match(html,/navegador fechado/);
  assert.match(appJs,/EscudoFitWebReminders/);
  assert.match(sw,/web-reminders\.js/);
  assert.match(html,/web-v43-campaigns-20/);
});
