import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
const html=readFileSync('app/index.html','utf8');
const scripts=['app/history-sync-contract.js','app/history-backup-bridge.js','app/web-reminders.js','app/app.js'].map(f=>readFileSync(f,'utf8'));
const pause=()=>new Promise(r=>setTimeout(r,30));

async function guest(search){
  const dom=new JSDOM(html,{url:'https://escudofit.example/app/'+search,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  const posts=[];
  w.fetch=async(url,options={})=>{
    if(String(url).endsWith('/trial/register')){posts.push(JSON.parse(options.body));
      return {ok:true,status:200,json:async()=>({registered:true,participantId:'P-20',existing:false,pendingGoogleLogin:true,next:'GOOGLE_LOGIN'})};}
    return {ok:false,status:401,json:async()=>({})};
  };
  for(const s of scripts)w.eval(s);await pause();
  return {w,posts};
}
async function signUp(w){
  w.document.getElementById('trialName').value='Ana Souza';
  w.document.getElementById('trialEmail').value='ana@example.com';
  w.document.getElementById('trialLgpd').checked=true;
  w.document.getElementById('trialSubmit').closest('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  await pause();
}

test('campaign link ?promo=CRF-SP keeps the 14-day trial, shows the coupon and sends it with the sign-up',async()=>{
  const {w,posts}=await guest('?promo=crf-sp');
  try{
    const d=w.document;
    assert.equal(d.getElementById('trialEyebrow').textContent,'CUPOM CRF-SP APLICADO');
    assert.match(d.getElementById('trialIntro').textContent,/Cupom CRF-SP aplicado.*14 dias grátis/);
    assert.equal(d.getElementById('trialSubmit').textContent,'Começar 14 dias grátis');
    assert.equal(d.getElementById('trialTitle').textContent,'Experimente o Escudo Fit Premium por 14 dias');
    assert.doesNotMatch(d.body.textContent,/\b7 dias grátis/);
    assert.equal(d.getElementById('trialPromoCode').value,'CRF-SP');
    await signUp(w);
    assert.equal(posts.length,1);assert.equal(posts[0].promoCode,'CRF-SP');
    assert.doesNotMatch(d.getElementById('trialStatus')?.textContent||'',/em análise/);
  }finally{w.close();}
});

test('Monise30 keeps its 30-day manual approval flow; no promo sends no coupon',async()=>{
  const m=await guest('?promo=Monise30');
  try{
    assert.equal(m.w.document.getElementById('trialTitle').textContent,'30 dias grátis de Escudo Fit');
    await signUp(m.w);assert.equal(m.posts[0].promoCode,'Monise30');
  }finally{m.w.close();}
  const plain=await guest('');
  try{
    const d=plain.w.document;
    assert.equal(d.getElementById('trialEyebrow').textContent,'TESTE GRÁTIS');
    // Standard sign-up: 7 free days everywhere on the page (owner decision, 13/11).
    assert.equal(d.getElementById('trialTitle').textContent,'Experimente o Escudo Fit Premium por 7 dias');
    assert.equal(d.getElementById('trialSubmit').textContent,'Começar 7 dias grátis');
    assert.doesNotMatch(d.body.textContent,/14 dias/);
    await signUp(plain.w);assert.equal('promoCode' in plain.posts[0],false);
  }finally{plain.w.close();}
});

test('every campaign page links to a coupon the Web recognizes, with the period it promises',async()=>{
  const {readdirSync}=await import('node:fs');
  const js=readFileSync('app/app.js','utf8');
  for(const dir of readdirSync('app/campanhas')){
    const page=readFileSync('app/campanhas/'+dir+'/index.html','utf8');
    const code=/href="\.\.\/\.\.\/\?promo=([A-Za-z0-9-]+)#trialSection"/.exec(page)?.[1];
    assert.ok(code,dir+' links to a coupon');
    const days=Number(/(\d+) dias grátis/.exec(page)?.[1]);
    const entry=new RegExp("code:'"+code+"',trialDays:(\\d+)").exec(js);
    assert.ok(entry,dir+': coupon '+code+' is recognized');
    assert.equal(Number(entry[1]),days,dir+': page promise matches the coupon period');
  }
});

test('Patriota22 campaign keeps its 14 days after the standard period became 7',async()=>{
  const {w,posts}=await guest('?promo=Patriota22');
  try{
    assert.equal(w.document.getElementById('trialSubmit').textContent,'Começar 14 dias grátis');
    await signUp(w);assert.equal(posts[0].promoCode,'Patriota22');
  }finally{w.close();}
});
