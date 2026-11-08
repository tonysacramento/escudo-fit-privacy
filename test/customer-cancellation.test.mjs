import test from 'node:test';
import assert from 'node:assert/strict';
import {cancellationController,cancellationTransport,validCancellationReceipt,cancellationReceiptText,withdrawalText}
  from '../app/cancelar/cancellation-client.mjs';

const oldId='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',newId='EF-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const purchase={orderId:newId,participantId:'P-00',planKey:'monthly',amountBRL:'4.99',currency:'BRL',premiumUntil:'2026-12-02T00:00:00.000Z'};
const receipt={orderId:newId,caseId:'b'.repeat(64),protocol:'EF-CANCEL-'+'b'.repeat(24),refundStatusVersion:2,
  status:'REQUEST_RECEIVED',receivedAt:'2026-11-02T12:00:00.000Z',amountBRL:'4.99',currency:'BRL',
  eligibility:'PENDING_REVIEW',refundExecuted:false,entitlementChanged:false,acknowledgementDigest:'c'.repeat(64)};
const entry=(p=purchase,r=null)=>({purchase:p,request:r,refundExecuted:r?.refundExecuted===true,entitlementChanged:r?.entitlementChanged===true});
const listed=(entries=[entry()])=>({purchases:entries,truncated:false,refundExecutionAvailable:false});
const legacy=()=>entry({...purchase,orderId:oldId,planKey:undefined});
const memory=()=>{const m=new Map([['health_history','preserve']]);return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),m};};
function harness(request=async path=>path.includes('customer-cancellations')?listed():legacy()){
  const calls=[],events=[],storage=memory();let session={user:{id:'buyer'},access_token:'synthetic-access'};
  const transport={session:()=>session,request:async(...args)=>{calls.push(args);return request(...args);}};
  const view=Object.fromEntries(['clear','busy','purchase','receipt','error'].map(k=>[k,v=>events.push([k,v])]));
  view.purchases=(items,selected,truncated)=>events.push(['purchases',{items,selected,truncated}]);
  const controller=cancellationController({transport,view,keyStorage:storage,discoverCustomerPurchases:true,
    newKey:()=> '11111111-1111-4111-8111-111111111111'});
  return {controller,calls,events,storage,setSession:v=>{session=v;}};
}

test('new Web purchase and historical manual payment remain distinct and POST targets only the selected order',async()=>{
  const h=harness(async(path,options)=>options?.method==='POST'?receipt:path.includes('customer-cancellations')?listed():legacy());
  await h.controller.load();const options=h.events.find(([k])=>k==='purchases')[1];
  assert.deepEqual(options.items.map(p=>p.orderId),[newId,oldId]);assert.equal(options.selected,newId);
  h.controller.selectOrder(oldId);h.controller.selectOrder(newId);await h.controller.submit(true);
  assert.equal(h.calls.at(-1)[0],'/payments/customer-cancellations');
  assert.equal(JSON.parse(h.calls.at(-1)[1].body).orderId,newId);
  assert.deepEqual(Object.keys(JSON.parse(h.calls.at(-1)[1].body)).sort(),['confirm','orderId','requestKey']);
  assert(h.storage.m.has('escudofit_cancellation_request_v2:buyer:'+newId));assert.equal(h.storage.getItem('health_history'),'preserve');
});

test('annual purchase and refund keep R$ 49,90 without inheriting the manual pilot amount',async()=>{
  const annual={...purchase,planKey:'yearly',amountBRL:'49.90'};
  const acknowledged={...receipt,amountBRL:'49.90'};
  const h=harness(async(path,opts)=>{
    if(opts?.method==='POST')return acknowledged;
    if(path.includes('customer-cancellations'))return listed([entry(annual)]);
    throw Error('PILOT_UNAVAILABLE');
  });await h.controller.load();await h.controller.submit(true);
  assert(h.events.some(([k,v])=>k==='receipt'&&v.amountBRL==='49.90'));
  const confirmed={...acknowledged,status:'REFUND_CONFIRMED',eligibility:'APPROVED',refundExecuted:true,
    refundId:'REF01SYNTHETIC00000000001',numericRefundId:'123',refundedAt:'2026-11-02T13:00:00.000Z',accessCompensation:'PENDING'};
  assert(validCancellationReceipt(confirmed));assert.match(cancellationReceiptText(confirmed).message,/R\$ 49,90/);
});

test('completed general refund preserves a previous Premium period as historical access and needs no new POST',async()=>{
  const complete={...receipt,status:'REFUND_COMPLETED',eligibility:'APPROVED',refundExecuted:true,entitlementChanged:true,
    refundId:'REF01SYNTHETIC00000000001',numericRefundId:'123',refundedAt:'2026-11-02T13:00:00.000Z',accessCompensation:'COMPLETED',
    publishedAt:'2026-11-02T13:00:05.000Z',accessSnapshotAt:'2026-11-02T13:00:05.000Z',
    planAfterRefund:'PREMIUM',premiumUntilAfterRefund:'2026-11-05T00:00:00.000Z'};
  const h=harness(async path=>{if(path.includes('customer-cancellations'))return listed([entry(purchase,complete)]);throw Error('PILOT_UNAVAILABLE');});
  await h.controller.load();await h.controller.submit(true);
  assert.equal(h.calls.length,2);assert(h.events.some(([k,v])=>k==='receipt'&&v.status==='REFUND_COMPLETED'));
  const text=cancellationReceiptText(complete).detail;assert.match(text,/período Premium anterior foi preservado/);
  assert.match(text,/plano atual no Perfil/);assert.doesNotMatch(text,/Plano atual: Free|Premium referente a esta compra foi encerrado/);
});

test('unavailable general channel preserves the original manual route and its v1 idempotency namespace',async()=>{
  const oldReceipt={...receipt,orderId:oldId,refundStatusVersion:undefined};
  const h=harness(async(path,opts)=>{if(path.includes('customer-cancellations'))throw Error('PILOT_UNAVAILABLE');
    return opts?.method==='POST'?oldReceipt:legacy();});
  await h.controller.load();await h.controller.submit(true);
  assert.equal(h.calls.at(-1)[0],'/payments/cancellations');
  assert(h.storage.m.has('escudofit_cancellation_request_v1:buyer:'+oldId));
});

test('malformed general response never silently displays an unrelated legacy purchase',async()=>{
  const h=harness(async path=>path.includes('customer-cancellations')?{purchases:[entry({...purchase,amountBRL:'49.90'})],truncated:false,refundExecutionAvailable:false}:legacy());
  await h.controller.load();assert.equal(h.calls.length,1);assert.equal(h.events.some(([k])=>k==='purchase'),false);
  assert(h.events.some(([k,v])=>k==='error'&&v==='REQUEST_UNCONFIRMED'));
});

test('a refund receipt with another amount or namespace cannot be attached to the selected purchase',async()=>{
  for(const change of [{amountBRL:'49.90'},{refundStatusVersion:1}]){
    const h=harness(async path=>path.includes('customer-cancellations')?listed([entry(purchase,{...receipt,...change})]):legacy());
    await h.controller.load();assert.equal(h.events.some(([k])=>k==='receipt'),false);
  }
});

test('selecting an unknown order clears the purchase and cannot send a cancellation',async()=>{
  const h=harness();await h.controller.load();h.controller.selectOrder('EF-cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await h.controller.submit(true);assert.equal(h.calls.length,2);assert.equal(h.storage.m.size,1);
});

test('lost general POST response retains one idempotency key and original body on retry',async()=>{
  let lost=true;const h=harness(async(path,opts)=>{
    if(opts?.method==='POST'){if(lost){lost=false;throw Error('NETWORK_ERROR');}return receipt;}
    if(path.includes('customer-cancellations'))return listed();throw Error('PILOT_UNAVAILABLE');
  });await h.controller.load();await h.controller.submit(true);await h.controller.submit(true);
  const posts=h.calls.filter(([,o])=>o?.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0][1].body,posts[1][1].body);
});

test('changing Google account during general discovery prevents displaying purchases or issuing POSTs',async()=>{
  let finish;const h=harness(async()=>new Promise(r=>{finish=r;}));
  const pending=h.controller.load();h.setSession({user:{id:'other'}});finish(listed());await pending;
  await h.controller.submit(true);assert.equal(h.events.some(([k])=>k==='purchase'),false);assert.equal(h.calls.length,1);
});

test('completed receipt rejects inconsistent financial and historical access fields',()=>{
  const completed={...receipt,status:'REFUND_COMPLETED',eligibility:'APPROVED',refundExecuted:true,entitlementChanged:true,
    refundId:'REF01SYNTHETIC00000000001',numericRefundId:'123',refundedAt:'2026-11-02T13:00:00.000Z',accessCompensation:'COMPLETED',
    publishedAt:'2026-11-02T13:00:05.000Z',accessSnapshotAt:'2026-11-02T13:00:05.000Z',planAfterRefund:'FREE',premiumUntilAfterRefund:null};
  assert(validCancellationReceipt(completed));
  for(const change of [{refundId:'123'},{numericRefundId:null},{accessCompensation:'PENDING'},{publishedAt:null},
    {accessSnapshotAt:'2026-11-03T00:00:00.000Z'},{planAfterRefund:'VIP'},{premiumUntilAfterRefund:'2027-01-01T00:00:00.000Z'}])
    assert.equal(validCancellationReceipt({...completed,...change}),false);
});

test('transport sends buyer credentials only to fixed cancellation endpoints and legitimate order selectors',async()=>{
  const storage=memory();storage.setItem('escudofit_web_auth_v1',JSON.stringify({user:{id:'buyer'},access_token:'synthetic-access'}));
  const calls=[],transport=cancellationTransport({storage,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>listed()};}});
  await transport.request('/payments/customer-cancellations/purchases');
  await transport.request('/payments/customer-cancellations/purchases/'+newId);
  assert(calls.every(c=>c.url.startsWith('https://escudo-fit-cancellation-requests-835029473980.us-central1.run.app/api/v38/')));
  for(const path of ['/payments/customer-cancellations/execute','/payments/customer-cancellations/purchases/'+newId+'/refund',
    '/payments/customer-cancellations/purchases/'+newId+'?buyer=other','https://foreign.example.invalid'])
    await assert.rejects(transport.request(path),/REQUEST_UNCONFIRMED/);
  assert.equal(calls.length,2);
});

const within={basis:'PROVIDER_PAYMENT_APPROVED',startsAt:'2026-11-08T03:04:00.000Z',deadlineAt:'2026-11-15T03:04:00.000Z',withinPeriod:true};
test('7-day period shows the Brasília deadline and announces the automatic refund only within the period',()=>{
  const before=withdrawalText(within);
  assert.equal(before.state,'WITHIN');assert.equal(before.deadline,'15/11/2026 às 00:04 (horário de Brasília)');
  assert.match(before.message,/dentro do prazo de 7 dias da aprovação do pagamento.*automaticamente/);
  const pending=withdrawalText(within,receipt);
  assert.match(pending.message,/processado automaticamente.*mesmo protocolo/);
  const done=withdrawalText(within,{...receipt,status:'REFUND_COMPLETED'});
  assert.doesNotMatch(done.message,/automaticamente|análise/);
  const late=withdrawalText({...within,withinPeriod:false},receipt);
  assert.equal(late.state,'OUTSIDE');assert.match(late.message,/analisado pelo suporte; o reembolso automático não se aplica/);
  assert.match(withdrawalText({...within,withinPeriod:false}).message,/terminou.*ainda pode registrar/);
  assert.match(withdrawalText({...within,basis:'ACCESS_CONFIRMED_FALLBACK'}).message,/confirmação do acesso/);
});
test('missing or malformed period never blocks the page nor promises an automatic refund',()=>{
  for(const w of [undefined,null,{basis:'UNAVAILABLE',startsAt:null,deadlineAt:null,withinPeriod:null},
    {...within,basis:'CLIENT_CLAIM'},{...within,deadlineAt:'amanhã'},{...within,withinPeriod:'true'}]){
    const t=withdrawalText(w,receipt);
    assert.equal(t.state,'UNKNOWN');assert.equal(t.deadline,null);assert.doesNotMatch(t.message,/automaticamente/);
  }
});
test('the period reaches the view from the listing and from the POST receipt',async()=>{
  const p={...purchase,withdrawal:within},late={...within,withinPeriod:false};
  const run=async(request,submit)=>{
    const shown=[],view={clear(){},busy(){},error(){},purchases(){},purchase:x=>shown.push(['purchase',x]),
      receipt:(r,w)=>shown.push(['receipt',r,w])};
    const m=new Map(),controller=cancellationController({transport:{session:()=>({user:{id:'buyer'}}),request},view,
      keyStorage:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)},discoverCustomerPurchases:true,
      newKey:()=>'11111111-1111-4111-8111-111111111111'});
    await controller.load();if(submit)await controller.submit(true);return shown;
  };
  const posted=await run(async(path,o)=>{if(o?.method==='POST')return {...receipt,withdrawal:within};
    if(path.includes('customer-cancellations'))return listed([entry(p)]);throw Error('PILOT_UNAVAILABLE');},true);
  assert.deepEqual(posted[0],['purchase',p]);assert.deepEqual(posted[1][2],within);
  const reloaded=await run(async path=>{if(path.includes('customer-cancellations'))
    return listed([{...entry(p,receipt),requestWithdrawal:late}]);throw Error('PILOT_UNAVAILABLE');},false);
  assert.equal(reloaded.length,1);assert.deepEqual(reloaded[0][2],late);
});
