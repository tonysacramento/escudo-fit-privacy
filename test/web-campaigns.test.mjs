import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
const html=readFileSync('app/index.html','utf8');
const history=readFileSync('app/history-sync-contract.js','utf8');
const backup=readFileSync('app/history-backup-bridge.js','utf8');
const reminders=readFileSync('app/web-reminders.js','utf8');
const app=readFileSync('app/app.js','utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,55));

async function load(promo,reply){
  const dom=new JSDOM(html,{url:'https://escudofit.com.br/app/'+(promo?'?promo='+promo:''),
    runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  const calls=[];
  w.fetch=async(url,options={})=>{
    const p=String(url);calls.push({path:p,options});
    if(p.endsWith('/trial/register'))return {ok:true,status:200,json:async()=>reply};
    return {ok:true,status:200,json:async()=>({})};
  };
  w.eval(history);w.eval(backup);w.eval(reminders);w.eval(app);
  await pause();
  return {dom,w,calls,el:id=>w.document.getElementById(id)};
}
async function submit(context){
  const {w,el}=context;
  el('trialName').value='Novo Participante';
  el('trialEmail').value='novo@gmail.com';
  el('trialLgpd').checked=true;
  el('trialForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await pause();
}

test('all campaign links show 30-day offer but do not activate until API approval',async()=>{
  for(const code of ['Requinte30','Tamires30','Monise30','Patriota22']){
    const h=await load(code,{registered:true,participantId:'P-24',existing:false,
      campaignAccepted:true,promoCode:code,trialDays:30,pendingApproval:false,accessChannel:'GOOGLE_PLAY'});
    try{
      assert.match(h.el('trialTitle').textContent,/30 dias/);
      assert.equal(h.el('trialPromoCode').value,code);
      await submit(h);
      const req=h.calls.find(x=>x.path.endsWith('/trial/register'));
      assert.ok(req,'a registration request must be sent');
      const payload=JSON.parse(req.options.body);
      assert.equal(payload.promoCode,code);
      assert.equal(payload.consentAccepted,true);
      assert.match(h.el('trialStatus').textContent,/Entre com a mesma Conta Google/);
      assert.equal(h.el('trialLoginButton').classList.contains('hidden'),false);
    }finally{h.dom.window.close();}
  }
});
test('existing accounts are not told they received a new 30-day grant',async()=>{
 const h=await load('Requinte30',{registered:true,existing:true,participantId:'P-03',
   campaignAccepted:false,promoCode:'',trialDays:14,pendingApproval:false,accessChannel:'GOOGLE_PLAY'});
 try{await submit(h);assert.match(h.el('trialStatus').textContent,/não renova nem substitui/);}
 finally{h.dom.window.close()}
});
test('unknown promo code is rejected client side and no 14-day fallback is submitted',async()=>{
 const h=await load('VoucherFake30',{});
 try{
  assert.match(h.el('trialStatus').textContent,/não reconhecido/);
  await submit(h);
  assert.equal(h.calls.filter(x=>x.path.endsWith('/trial/register')).length,0);
 }finally{h.dom.window.close()}
});
test('standard signup remains available without promo at 14 days',async()=>{
 const h=await load('',{registered:true,existing:false,participantId:'P-40',
   accessChannel:'GOOGLE_PLAY'});
 try{assert.match(h.el('trialTitle').textContent,/14 dias/);await submit(h);
  assert.equal(JSON.parse(h.calls.find(x=>x.path.endsWith('/trial/register')).options.body).promoCode,undefined);
 }finally{h.dom.window.close()}
});

test('manual field accepts Patriota22 as a 30-day campaign without query parameter',async()=>{
  const h=await load('',{registered:true,participantId:'P-52',existing:false,
    campaignAccepted:true,promoCode:'Patriota22',trialDays:30,pendingApproval:false,accessChannel:'GOOGLE_PLAY'});
  try{
    h.el('trialPromoCode').value='PATRIOTA22';
    await submit(h);
    const req=h.calls.find(x=>x.path.endsWith('/trial/register'));
    assert.equal(JSON.parse(req.options.body).promoCode,'Patriota22');
    assert.match(h.el('trialStatus').textContent,/30 dias/);
  }finally{h.dom.window.close()}
});
test('manual field rejects unknown promo without creating trial or registration',async()=>{
  const h=await load('',{});
  try{
    h.el('trialPromoCode').value='false30';
    await submit(h);
    assert.match(h.el('trialStatus').textContent,/não reconhecido/);
    assert.equal(h.calls.filter(x=>x.path.endsWith('/trial/register')).length,0);
  }finally{h.dom.window.close()}
});
