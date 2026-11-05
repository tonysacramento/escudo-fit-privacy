import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUYER_API,BUYER_RELAY,BUYER_REQUEST_KEY,BUYER_TERMS,
  validatePrivateBuyerResult,createPrivateBuyerController,privateBuyerRequest
} from '../app/comprar/v2/buyer.mjs';

const NOW=1793916000000;
const token='aaa.bbb.ccc';
const id='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const noAccess={paymentConfirmed:false,premiumGranted:false};
const preflight={...noAccess,state:'READY_FOR_SINGLE_PURCHASE',amountBRL:'4.99'};
const issued={...noAccess,state:'ORDER_CREATED_CHECKOUT_REVIEW_REQUIRED',orderCreated:true,orderId:id};
const checkout={...noAccess,state:'AWAITING_PAYMENT',orderId:id,amountBRL:'4.99',
  expiresAt:new Date(NOW+900000).toISOString(),qrCode:'000201'+'1'.repeat(50)};
const paid={state:'PREMIUM_ACTIVE',orderId:id,paymentConfirmed:true,premiumGranted:true,
  noticeState:'SENT',expiresAt:new Date(NOW+30*86400000).toISOString()};

test('private result accepts only consistent QR, amount, time and Premium evidence',()=>{
  assert.equal(validatePrivateBuyerResult(checkout,NOW).qrCode,checkout.qrCode);
  assert.equal(validatePrivateBuyerResult(paid,NOW).premiumGranted,true);
  for(const change of [
    {amountBRL:'49.90'},{state:'PAID'}, {qrCode:'javascript:'},
    {expiresAt:new Date(NOW-1).toISOString()}, {expiresAt:new Date(NOW+1900000).toISOString()},
    {paymentConfirmed:true}, {orderId:'wrong'}
  ])assert.throws(()=>validatePrivateBuyerResult({...checkout,...change},NOW));
  assert.throws(()=>validatePrivateBuyerResult({...preflight,premiumGranted:true},NOW));
});

test('one authenticated preflight, one user-confirmed Pix issue, explicit QR read and Premium status',async()=>{
  const calls=[];
  const ctrl=createPrivateBuyerController({now:()=>NOW,
    request:async(action,jwt)=>{calls.push({action,jwt});
      return {preflight,issue:issued,checkout,status:paid}[action];}});
  assert.equal(await ctrl.issue(true),false);
  assert.equal(await ctrl.signIn(token),true);
  assert.equal(ctrl.snapshot().phase,'READY_FOR_SINGLE_PURCHASE');
  assert.equal(ctrl.snapshot().canIssue,true);
  assert.equal(await ctrl.issue(false),false);
  assert.equal(await ctrl.issue(true),true);
  assert.equal(ctrl.snapshot().attempted,true);
  assert.equal(await ctrl.issue(true),false);
  assert.equal(await ctrl.checkout(),true);
  assert.equal(ctrl.pix(),checkout.qrCode);
  assert.equal(await ctrl.status(),true);
  assert.equal(ctrl.snapshot().serverState,'PREMIUM_ACTIVE');
  assert.equal(ctrl.snapshot().premiumGranted,true);
  assert.equal(ctrl.snapshot().noticeState,'SENT');
  assert.equal(ctrl.pix(),null);
  assert.deepEqual(calls.map(x=>x.action),['preflight','issue','checkout','status']);
  assert(calls.every(x=>x.jwt===token));
  assert(!JSON.stringify(ctrl.snapshot()).includes(token));
});

test('lost issue result is terminal and status reads remain possible',async()=>{
  const calls=[];
  const ctrl=createPrivateBuyerController({now:()=>NOW,
    request:async action=>{calls.push(action);if(action==='issue')throw Error('timeout');return preflight;}});
  await ctrl.signIn(token);
  assert.equal(await ctrl.issue(true),false);
  assert.equal(ctrl.snapshot().phase,'ISSUE_OUTCOME_UNCERTAIN');
  assert.equal(await ctrl.issue(true),false);
  assert.equal(await ctrl.status(),true);
  ctrl.reset();
  await ctrl.signIn(token);
  assert.equal(ctrl.snapshot().canIssue,false);
  assert.equal(await ctrl.issue(true),false);
  assert.deepEqual(calls,['preflight','issue','status','preflight']);
});

test('server hold never makes issue button available',async()=>{
  const ctrl=createPrivateBuyerController({now:()=>NOW,
    request:async()=>({...noAccess,state:'APPROVAL_REQUIRED',amountBRL:'4.99'})});
  assert.equal(await ctrl.signIn(token),true);
  assert.equal(ctrl.snapshot().canIssue,false);
  assert.equal(await ctrl.issue(true),false);
});

test('expired QR is hidden even if the previous server reply was once valid',async()=>{
  let now=NOW;
  const ctrl=createPrivateBuyerController({now:()=>now,
    request:async action=>({preflight,issue:issued,checkout})[action]});
  await ctrl.signIn(token);await ctrl.issue(true);await ctrl.checkout();
  assert.equal(ctrl.pix(),checkout.qrCode);
  now=NOW+900001;
  assert.equal(ctrl.pix(),null);
});

test('buyer relay sends only an exact one-shot request body with no browser provider calls',async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{calls.push({url,opts});return {
    ok:true,headers:{get:()=> 'application/json'},
    text:async()=>JSON.stringify(issued)
  };};
  await privateBuyerRequest('issue',token,{fetchImpl});
  assert.equal(calls[0].url,BUYER_API+BUYER_RELAY);
  const req=calls[0].opts;
  assert.equal(req.method,'POST');
  assert.equal(req.credentials,'omit');
  assert.equal(req.referrerPolicy,'no-referrer');
  assert.equal(req.redirect,'error');
  assert.deepEqual(JSON.parse(req.body),{
    action:'issue',requestKey:BUYER_REQUEST_KEY,confirmedTermsVersion:BUYER_TERMS
  });
  await assert.rejects(()=>privateBuyerRequest('refund',token,{fetchImpl}));
  assert.equal(calls.length,1);
});
