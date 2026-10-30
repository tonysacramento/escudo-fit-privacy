import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cancellationController,cancellationTransport,validCancellationReceipt}
  from '../app/cancelar/cancellation-client.mjs';

const orderId='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const purchase={orderId,participantId:'P-00',amountBRL:'4.99',currency:'BRL',
  premiumUntil:'2026-11-29T14:00:00.000Z'};
const receipt={caseId:'a'.repeat(64),protocol:'EF-CANCEL-'+'a'.repeat(24),orderId,
  status:'REQUEST_RECEIVED',receivedAt:'2026-10-30T20:00:00.000Z',amountBRL:'4.99',currency:'BRL',
  eligibility:'PENDING_REVIEW',refundExecuted:false,entitlementChanged:false,acknowledgementDigest:'b'.repeat(64)};
const response=()=>({purchase,request:null,refundExecuted:false,entitlementChanged:false});
function memory(seed=[]) {const m=new Map(seed);return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),m};}
function harness(request=async()=>response()) {
  const calls=[],events=[],storage=memory([['existing_health_history','preserved']]);
  let session={user:{id:'synthetic-buyer'},access_token:'test-access'};
  const transport={session:()=>session,request:async(...args)=>{calls.push(args);return request(...args);}};
  const view=Object.fromEntries(['clear','busy','purchase','receipt','error'].map(k=>[k,v=>events.push([k,v])]));
  const controller=cancellationController({transport,view,keyStorage:storage,
    newKey:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
  return {calls,events,storage,controller,setSession:v=>{session=v;}};
}
test('an authenticated purchase can be shown without POST or financial changes',async()=>{
  const h=harness();await h.controller.load();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'/payments/cancellations/current');
  assert(h.events.some(([k])=>k==='purchase'));assert.equal(h.storage.getItem('existing_health_history'),'preserved');
});
test('explicit confirmation is required and only order/key/confirmation are sent',async()=>{
  const h=harness(async(path)=>path.endsWith('/current')?response():receipt);
  await h.controller.load();await h.controller.submit(false);assert.equal(h.calls.length,1);
  await h.controller.submit(true);
  const payload=JSON.parse(h.calls[1][1].body);
  assert.deepEqual(Object.keys(payload).sort(),['confirm','orderId','requestKey']);
  assert.equal(payload.confirm,true);assert.equal(payload.orderId,orderId);
  assert(h.events.some(([k])=>k==='receipt'));
  assert.equal(h.storage.getItem('existing_health_history'),'preserved');
});
test('a double click while receiving sends one request only',async()=>{
  let finish;const h=harness(async path=>path.endsWith('/current')?response():new Promise(r=>{finish=r;}));
  await h.controller.load();const first=h.controller.submit(true);await h.controller.submit(true);
  assert.equal(h.calls.length,2);finish(receipt);await first;
  await h.controller.submit(true);assert.equal(h.calls.length,2);
});
test('a lost response never invents a protocol and retry retains the same idempotency key',async()=>{
  let lost=true;const h=harness(async path=>{
    if(path.endsWith('/current'))return response();
    if(lost){lost=false;throw Error('NETWORK_ERROR');}return receipt;
  });
  await h.controller.load();await h.controller.submit(true);
  assert.equal(h.events.some(([k])=>k==='receipt'),false);
  await h.controller.submit(true);
  assert.equal(h.calls[1][1].body,h.calls[2][1].body);
  assert(h.events.some(([k])=>k==='receipt'));
});
test('reload recovers the existing server protocol without another POST',async()=>{
  const h=harness(async()=>({...response(),request:receipt}));
  await h.controller.load();await h.controller.submit(true);
  assert.equal(h.calls.length,1);assert(h.events.some(([k,v])=>k==='receipt'&&v.protocol===receipt.protocol));
});
test('foreign purchase receipts, malformed acknowledgements and financial completion claims are rejected',async()=>{
  for(const override of [{orderId:'EF-'+ 'b'.repeat(36)},{status:'COMPLETED'},{refundExecuted:true},
    {entitlementChanged:true},{amountBRL:'49.90'},{protocol:'fake'},{receivedAt:'not-a-date'},
    {acknowledgementDigest:'fake'}]) {
    const h=harness(async p=>p.endsWith('/current')?response():({...receipt,...override}));
    await h.controller.load();await h.controller.submit(true);
    assert.equal(h.events.some(([k])=>k==='receipt'),false);
  }
});
test('changing account while a request is in flight clears the old account response',async()=>{
  let finish;const h=harness(async p=>p.endsWith('/current')?response():new Promise(r=>{finish=r;}));
  await h.controller.load();const pending=h.controller.submit(true);
  h.setSession({user:{id:'other-buyer'}});finish(receipt);await pending;
  assert.equal(h.events.some(([k])=>k==='receipt'),false);
  assert(h.events.some(([k,v])=>k==='error'&&v==='SESSION_CHANGED'));
});
test('a late purchase lookup cannot display the previous account data',async()=>{
  let finish;const h=harness(async()=>new Promise(r=>{finish=r;}));
  const pending=h.controller.load();h.setSession({user:{id:'other-buyer'}});finish(response());await pending;
  assert.equal(h.events.some(([k])=>k==='purchase'),false);
});
test('unavailable API does not claim the request was received',async()=>{
  const h=harness(async()=>{throw Error('PILOT_UNAVAILABLE');});
  await h.controller.load();await h.controller.submit(true);
  assert.equal(h.calls.length,1);assert.equal(h.events.some(([k])=>k==='receipt'),false);
});
test('transport uses only the fixed API and authenticated no-store requests',async()=>{
  const storage=memory([['escudofit_web_auth_v1',JSON.stringify({user:{id:'test'},access_token:'test-access'})]]);
  const calls=[];const transport=cancellationTransport({storage,fetchImpl:async(...args)=>{
    calls.push(args);return {ok:true,status:200,json:async()=>response()};}});
  await transport.request('/payments/cancellations/current');
  assert.equal(calls[0][0],'https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/payments/cancellations/current');
  assert.equal(calls[0][1].headers.Authorization,'Bearer test-access');
  assert.equal(calls[0][1].cache,'no-store');assert.equal(calls[0][1].redirect,'error');
});
test('refreshing an expired session preserves the same POST body and client key',async()=>{
  const storage=memory([['escudofit_web_auth_v1',JSON.stringify({user:{id:'test'},
    access_token:'old-access',refresh_token:'test-refresh'})]]);
  const calls=[];const transport=cancellationTransport({storage,fetchImpl:async(url,options)=>{
    calls.push([url,options]);
    if(url.endsWith('/auth/refresh'))return {ok:true,status:200,json:async()=>({access_token:'new-access',refresh_token:'new-refresh'})};
    return options.headers.Authorization==='Bearer old-access'?{ok:false,status:401}:
      {ok:true,status:200,json:async()=>receipt};
  }});
  const body=JSON.stringify({orderId,confirm:true,requestKey:'synthetic-key'});
  await transport.request('/payments/cancellations',{method:'POST',body});
  assert.equal(calls.length,3);assert.equal(calls[0][1].body,calls[2][1].body);
  assert.equal(calls[2][1].headers.Authorization,'Bearer new-access');
});
test('transport rejects a response after account switch without overwriting the new session',async()=>{
  const storage=memory([['escudofit_web_auth_v1',JSON.stringify({user:{id:'old'},access_token:'old-access'})]]);
  let changed=false;const transport=cancellationTransport({storage,onAccountChange:()=>{changed=true;},fetchImpl:async()=>{
    storage.setItem('escudofit_web_auth_v1',JSON.stringify({user:{id:'new'},access_token:'new-access'}));
    return {ok:true,status:200,json:async()=>response()};
  }});
  await assert.rejects(transport.request('/payments/cancellations/current'),/SESSION_CHANGED/);
  assert.equal(changed,true);assert.equal(JSON.parse(storage.getItem('escudofit_web_auth_v1')).user.id,'new');
});
test('receiving acknowledgement is deliberately distinct from refund proof',()=>{
  assert.equal(validCancellationReceipt(receipt),true);
  assert.equal(validCancellationReceipt({...receipt,refundExecuted:true}),false);
  assert.equal(validCancellationReceipt({...receipt,eligibility:'APPROVED'}),false);
});
test('the cancellation page is reachable outside the Premium application gate and bypasses service-worker caching',()=>{
  const html=readFileSync(new URL('../app/cancelar/index.html',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../app/sw.js',import.meta.url),'utf8');
  const profile=readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
  assert.match(html,/id="confirm"/);assert.match(html,/id="submit"/);
  assert.match(html,/não executa o reembolso/);assert.match(html,/mailto:escudofit@gmail.com/);
  assert.match(profile,/href="\.\/cancelar\/"/);
  assert.match(sw,/new URL\('\.\/cancelar\/'/);
  assert.doesNotMatch(html,/MERCADO_PAGO_ACCESS_TOKEN|PAYMENT_GRANT_HMAC_SECRET|KMS/);
});
