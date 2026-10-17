import test from 'node:test';
import assert from 'node:assert/strict';
import payment from '../app/payment-checkout.js';

const NOW=Date.UTC(2026,9,17,12),key='11111111-1111-4111-8111-111111111111';
const id='EF-00000000-0000-4000-8000-000000000001';
const health={mode:'CONFIGURED',termsVersion:'prepaid-v1-2026-10-16',intakeEnabled:true,checkoutEnabled:true,
  webhookEnabled:true,workerEnabled:true,deliveryEnabled:true,grantsEnabled:true,canonicalEntitlementEnabled:true,
  plans:{monthly:{amount:'4.99'},yearly:{amount:'49.90'}}};
const order=()=>({orderId:id,requestKey:key,planKey:'monthly',amountBRL:'4.99',currency:'BRL',status:'AWAITING_PAYMENT',
  qrCode:'000201SYNTHETIC_ONLY',qrCodeBase64:null,checkoutExpiresAt:new Date(NOW+1800000).toISOString(),
  estimatedExpiresAt:new Date(NOW+30*86400000).toISOString(),expiresAt:null,premiumActivated:true});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function fixture({available=true,pending=null,entitlement={mode:'FREE'}}={}){
  let owner='google-user-a',clock=NOW,refreshes=0,posts=[],storage=new Map(),timers=new Map(),next=0;
  const calls=[];
  const request=async(path,options)=>{
    calls.push({path,options});
    if(path.endsWith('/health'))return response(available?health:{...health,mode:'OFF',checkoutEnabled:false});
    if(path.endsWith('/orders/current'))return response({order:pending});
    if(options?.method==='POST'){posts.push(JSON.parse(options.body));return response(order(),201);}
    return response(pending||order());
  };
  const config={request,getOwner:()=>owner,getEntitlement:()=>entitlement,now:()=>clock,uuid:()=>key,
    refreshEntitlement:async()=>{refreshes++;return entitlement;},
    storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    schedule:fn=>{const n=++next;timers.set(n,fn);return n;},cancel:n=>timers.delete(n)};
  const controller=payment.createController(config);
  return {controller,config,calls,posts,timers,get refreshes(){return refreshes;},
    setOwner:value=>{owner=value;},setNow:value=>{clock=value;},setEntitlement:value=>{entitlement=value;}};
}

test('OFF and signed-out checkout cannot create a Pix or load private payment state',async()=>{
  const off=fixture({available:false});await off.controller.open();
  assert.equal(off.controller.getState().status,'UNAVAILABLE');assert.equal(await off.controller.start(true),false);
  assert.equal(off.calls.length,1);assert.equal(off.posts.length,0);
  const guest=fixture();guest.setOwner(null);await guest.controller.open();
  assert.equal(guest.controller.getState().status,'SIGNED_OUT');assert.equal(guest.calls.length,0);
});

test('one-time terms are explicit; an order response cannot activate Premium and double click creates once',async()=>{
  const f=fixture();await f.controller.open();await f.controller.start(false);
  assert.equal(f.posts.length,0);
  await Promise.all([f.controller.start(true),f.controller.start(true)]);
  assert.equal(f.posts.length,1);assert.deepEqual(Object.keys(f.posts[0]).sort(),
    ['acceptedTermsVersion','channel','planKey','requestKey']);
  assert.equal(f.posts[0].requestKey,key);assert.equal(f.controller.getState().status,'AWAITING_PAYMENT');
  assert.equal(f.refreshes,0,'even premiumActivated:true in an order is not access authority');
});

test('a lost POST response keeps its request UUID; reopening recovers the same server pending order',async()=>{
  const f=fixture(),saved=[];let pending=null;
  const controller=payment.createController({...f.config,request:async(path,options)=>{
    if(path.endsWith('/health'))return response(health);
    if(path.endsWith('/orders/current'))return response({order:pending});
    saved.push(JSON.parse(options.body));pending=order();throw Error('SYNTHETIC_ACK_LOST');
  }});
  await controller.open();await controller.start(true);
  assert.equal(controller.getState().status,'RETRY');controller.close();
  await controller.open('yearly');
  assert.equal(controller.getState().status,'AWAITING_PAYMENT');assert.equal(controller.getState().planKey,'monthly');
  assert.equal(controller.getState().order.orderId,id);assert.equal(saved.length,1);
  assert.equal(await controller.start(true),false);
});

test('COMMITTED still waits for a fresh active entitlement; a repeated status query never charges again',async()=>{
  const paid={...order(),status:'COMMITTED',qrCode:null,expiresAt:new Date(NOW+30*86400000).toISOString()};
  const f=fixture({pending:paid});await f.controller.open();
  assert.equal(f.controller.getState().status,'RECONCILING');assert.equal(f.posts.length,0);
  f.setEntitlement({mode:'PREMIUM',source:'PIX_PAYMENT',isActive:true,expiresAt:paid.expiresAt});
  await f.controller.refresh();
  assert.equal(f.controller.getState().status,'COMMITTED');assert.equal(f.refreshes,2);assert.equal(f.posts.length,0);
});

test('switching account or closing cancels polling and late private responses cannot leak a QR or success',async()=>{
  const f=fixture({pending:order()});await f.controller.open();assert.equal(f.timers.size,1);
  f.setOwner('google-user-b');assert.equal(f.controller.getState().status,'CLOSED');
  assert.equal(f.controller.getState().order,null);assert.equal(f.timers.size,0);
  let release;const slow=new Promise(r=>{release=r;});
  const late=payment.createController({...f.config,request:async(path,options)=>options?.method==='POST'?slow:
    response(path.endsWith('/health')?health:{order:null})});
  await late.open();const post=late.start(true);late.close();release(response(order(),201));await post;
  assert.equal(late.getState().status,'CLOSED');assert.equal(late.getState().order,null);
});

test('expiry and review suppress payable state; VIP and active trial are preserved before a provider request',async()=>{
  const expired=fixture({pending:order()});expired.setNow(NOW+1800001);await expired.controller.open();
  assert.equal(expired.controller.getState().status,'EXPIRED');assert.equal(expired.timers.size,0);
  assert.equal(await expired.controller.start(true),false);
  const review=fixture({pending:{...order(),status:'REVIEW_REQUIRED'}});await review.controller.open();
  assert.equal(review.controller.getState().status,'REVIEW_REQUIRED');assert.equal(review.timers.size,0);
  for(const mode of ['TRIAL_14D','VIP_TEMPORARY','VIP_LIFETIME']){
    const f=fixture({entitlement:{mode}});await f.controller.open();
    assert.equal(f.controller.getState().status,'PROTECTED');assert.equal(f.calls.length,0);
  }
});

test('missing readiness, altered price and failed pending lookup cannot start a new purchase',async()=>{
  for(const value of [{...health,canonicalEntitlementEnabled:false},
    {...health,plans:{...health.plans,monthly:{amount:'0.01'}}}]){
    const f=fixture(),c=payment.createController({...f.config,request:async()=>response(value)});
    await c.open();assert.equal(c.getState().status,'UNAVAILABLE');assert.equal(await c.start(true),false);
  }
  const f=fixture(),c=payment.createController({...f.config,request:async path=>
    path.endsWith('/health')?response(health):response({code:'UNAVAILABLE'},503)});
  await c.open();assert.equal(c.getState().status,'UNAVAILABLE');assert.equal(await c.start(true),false);
});
