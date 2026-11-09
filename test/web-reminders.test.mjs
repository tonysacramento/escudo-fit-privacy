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
  assert.match(html,/web-v43-sync-recovery-20/);
});

test('missed applications respect cycle, tolerance, reference date, today and dismissals',()=>{
  const {missedApplications:m}=require('../app/web-reminders.js');
  const weekly={frequency:'WEEKLY',weekday:1,intervalDays:7,anchor:'2026-10-05'};
  const now=new Date(2026,10,9,10); // Monday 09/11: today is never "missed"
  const at=dates=>dates.map(d=>({scheduledDateIso:d}));
  assert.deepEqual(m(weekly,at(['2026-10-05','2026-10-12','2026-10-21','2026-11-02']),now),
    [{date:'2026-10-26',earliest:'2026-10-23',latest:'2026-10-29'}],'21/10 covers 19/10 (3-day tolerance)');
  assert.deepEqual(m(weekly,at(['2026-10-05','2026-10-12','2026-10-21','2026-11-02']),now,{dismissed:{'2026-10-26':1}}),[]);
  assert.deepEqual(m({...weekly,anchor:'2026-11-03'},[],now),[],'nothing before the reference date');
  assert.deepEqual(m(weekly,at(['2026-10-05','2026-10-12','2026-10-19','2026-10-26']),new Date(2026,10,4,10)),[],
    'the 02/11 dose may still be taken until 05/11');
  assert.deepEqual(m({frequency:'DAILY',anchor:'2026-11-06'},at(['2026-11-06','2026-11-08']),now).map(x=>x.date),['2026-11-07']);
  assert.deepEqual(m({frequency:'OTHER',intervalDays:3,anchor:'2026-11-01'},at(['2026-11-01','2026-11-04']),now).map(x=>x.date),['2026-11-07']);
  assert.equal(m(weekly,[],now).length,5,'every week since the reference date (first dose)');
  assert.equal(m({...weekly,anchor:'2025-01-06'},[],now).length,52,'at most one year back');
  const monthly={frequency:'MONTHLY',anchor:'2026-07-31'};
  assert.deepEqual(m(monthly,at(['2026-07-31','2026-09-02']),now).map(x=>x.date),['2026-09-30','2026-10-31'],
    'same day each month (last day when shorter); 02/09 covers 31/08 within 7 days');
  assert.equal(dueApplication({...monthly,enabled:true,time:'09:00'},new Date(2026,8,30,9,0)),'2026-09-30:application:540');
  assert.deepEqual(m({...weekly,anchor:''},[],now),[]);
  assert.deepEqual(m({...weekly,frequency:'OTHER',intervalDays:1},[],now),[]);
  assert.equal(m(weekly,[{at:'2026-10-26T15:00:00'}],now).some(x=>x.date==='2026-10-26'),false,'legacy entries without scheduledDateIso count by day');
});
