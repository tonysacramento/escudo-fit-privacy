import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrivateV2Controller,validatePrivateV2Result,PRIVATE_V2_API,REQUEST_KEY,ORDER_ID}
  from '../app/pilot-pix/v2/private-v2.mjs';
const NOW=Date.UTC(2026,10,4,19),JWT='synthetic.buyer.token';
const ready=()=>({state:'READY_FOR_SINGLE_PURCHASE',amountBRL:'4.99',paymentConfirmed:false,premiumGranted:false});
const status=(state='AWAITING_PAYMENT')=>({state,orderId:ORDER_ID,paymentConfirmed:false,premiumGranted:false,noticeState:null});
const pix=()=>({...status(),amountBRL:'4.99',expiresAt:new Date(NOW+120000).toISOString(),
  qrCode:'000201synthetic-private-payment-test-only',qrCodeBase64:null,ticketUrl:null});
const response=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function fixture(handler=async b=>response(b.action==='preflight'?ready():b.action==='checkout'?pix():status())){
  const calls=[],states=[];let ms=NOW;
  const c=createPrivateV2Controller({now:()=>ms,schedule:()=>1,cancel:()=>{},onState:s=>states.push(s),
    fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});return handler(body,calls);}});
  return {c,calls,states,advance:n=>{ms+=n;}};
}
test('activation and QR require the exact case, amount, lifetime and canonical confirmation',()=>{
  assert.equal(validatePrivateV2Result(pix(),NOW).qrCode,pix().qrCode);
  for(const patch of [{orderId:'EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{amountBRL:'49.90'},
    {premiumGranted:true},{paymentConfirmed:true},{state:'PREMIUM_ACTIVE'},
    {expiresAt:new Date(NOW).toISOString()},{qrCode:'bad'},{providerToken:'synthetic'}])
    assert.throws(()=>validatePrivateV2Result({...pix(),...patch},NOW));
  assert.throws(()=>validatePrivateV2Result({...status('PREMIUM_ACTIVE'),paymentConfirmed:true,premiumGranted:false,
    expiresAt:new Date(NOW+30*86400000).toISOString()},NOW));
});
test('login is memory-only; purchase requires consent and one immutable request despite concurrent clicks',async()=>{
  const h=fixture();const login={credential:JWT};assert.equal(await h.c.login(login),true);assert.equal(login.credential,undefined);
  assert.equal(await h.c.purchase(false),false);assert.equal(h.calls.length,1);
  await Promise.all(Array.from({length:15},()=>h.c.purchase(true)));
  const issue=h.calls.filter(x=>x.body.action==='issue');assert.equal(issue.length,1);
  assert.deepEqual(issue[0].body,{action:'issue',requestKey:REQUEST_KEY,confirmedTermsVersion:'prepaid-v1-2026-10-16'});
  assert.equal(issue[0].url,PRIVATE_V2_API);assert.equal(issue[0].options.credentials,'omit');assert.equal(issue[0].options.redirect,'error');
  assert.equal(h.c.getPix().qrCode,pix().qrCode);assert.equal(JSON.stringify(h.states).includes(JWT),false);
});
test('uncertain issuance never retries and refresh only consults the same case after reset',async()=>{
  const h=fixture(async b=>{if(b.action==='preflight')return response(ready());if(b.action==='issue')throw Error('private-bank-response');return response(status());});
  // Fixture handlers return Response objects for this uncertainty scenario.
  const real=createPrivateV2Controller({schedule:()=>1,cancel:()=>{},now:()=>NOW,
    fetchImpl:async(url,options)=>h.calls.push({url,body:JSON.parse(options.body)})&&
      (JSON.parse(options.body).action==='issue'?Promise.reject(Error('private-bank-response')):
        response(JSON.parse(options.body).action==='preflight'?ready():status()))});
  await real.login({credential:JWT});await real.purchase(true);assert.equal(await real.purchase(true),false);
  await real.refresh();real.reset();await real.login({credential:JWT});
  assert.equal(h.calls.filter(x=>x.body.action==='issue').length,1);
  assert.equal(h.calls.at(-1).body.action,'checkout');
});
test('a fresh checkout GET is required to show bank material after every status refresh',async()=>{
  let paid=false;
  const h=fixture(async b=>response(b.action==='preflight'?ready():b.action==='checkout'?
    paid?{state:'PAYMENT_OBSERVED_AWAITING_DELIVERY',qrCode:null,qrCodeBase64:null,ticketUrl:null,
      paymentConfirmed:false,premiumGranted:false}:pix():status()));
  await h.c.login({credential:JWT});await h.c.purchase(true);assert.ok(h.c.getPix());paid=true;
  await h.c.refresh();assert.equal(h.c.getPix(),null);assert.equal(h.c.snapshot().phase,'PAYMENT_OBSERVED_AWAITING_DELIVERY');
});
test('expiry and logout erase the Pix; late network responses cannot restore it',async()=>{
  const h=fixture();await h.c.login({credential:JWT});await h.c.purchase(true);h.advance(240001);
  assert.equal(h.c.getPix(),null);assert.equal(h.c.snapshot().hasLogin,false);
  let release;const waiting=new Promise(r=>{release=r;});
  const c=createPrivateV2Controller({schedule:()=>1,cancel:()=>{},now:()=>NOW,fetchImpl:()=>waiting});
  const task=c.login({credential:JWT});c.reset();release(response(ready()));await task;
  assert.equal(c.snapshot().hasLogin,false);assert.equal(c.snapshot().hasPix,false);
});
test('mail success is displayed only with canonical Premium and a SENT notification',()=>{
  const v={...status('PREMIUM_ACTIVE'),paymentConfirmed:true,premiumGranted:true,
    expiresAt:new Date(NOW+30*86400000).toISOString(),noticeState:'SENT'};
  assert.equal(validatePrivateV2Result(v,NOW).noticeState,'SENT');
  assert.throws(()=>validatePrivateV2Result({...v,state:'DELIVERY_PENDING'},NOW));
});
test('private page has no public landing link, token storage, remote payment URL or direct financial credentials',()=>{
  const html=readFileSync(new URL('../app/pilot-pix/v2/index.html',import.meta.url),'utf8');
  const code=readFileSync(new URL('../app/pilot-pix/v2/private-v2.mjs',import.meta.url),'utf8');
  assert.match(html,/noindex,nofollow,noarchive/);assert.match(html,/Sem renovação automática/);
  assert.doesNotMatch(code,/localStorage|sessionStorage|APP_USR-|BEGIN PRIVATE KEY|api\.mercadopago/);
  assert.match(code,/ticketUrl:null/);assert.match(html,/type="checkbox"/);assert.match(html,/no-referrer/);
});
test('rendering after logout can read the empty Pix without recursively requesting another logout',async()=>{
  let c,events=0;
  c=createPrivateV2Controller({now:()=>NOW,schedule:()=>1,cancel:()=>{},
    fetchImpl:async()=>response(ready()),onState:()=>{events++;if(c)c.getPix();}});
  await c.login({credential:JWT});c.reset();assert.equal(c.getPix(),null);assert.ok(events<10);
});
