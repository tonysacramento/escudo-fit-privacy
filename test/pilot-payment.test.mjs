import test from 'node:test';
import assert from 'node:assert/strict';
import {createPilotPaymentController,readPaymentOrder,validatePilotPix,BUYER_CHECKOUT_API} from '../app/pilot-pix/pay/pay.mjs';
const NOW=Date.UTC(2026,9,21,18),ORDER='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',JWT='buyer.synthetic.signature';
const pix=()=>({state:'AWAITING_PAYMENT',orderId:ORDER,amountBRL:'4.99',expiresAt:new Date(NOW+120000).toISOString(),
 qrCode:'000201'+'1'.repeat(50),qrCodeBase64:null,ticketUrl:null,paymentConfirmed:false,premiumGranted:false});
function fixture(fetcher=async()=>new Response(JSON.stringify(pix()),{headers:{'content-type':'application/json'}})){
 let ms=NOW;const callbacks=[],calls=[],states=[];
 const c=createPilotPaymentController({orderId:ORDER,now:()=>ms,schedule:()=>1,cancel:()=>{},entryNonce:()=> 'synthetic-nonce',
 renderGoogle:v=>callbacks.push(v.callback),onState:v=>states.push(v),fetchImpl:async(u,o)=>{calls.push({u,o});return fetcher(u,o);}});
 return {c,callbacks,calls,states,advance:n=>{ms+=n;}};
}
test('payment fragment accepts one bounded order reference and no additional identifiers',()=>{
 assert.equal(readPaymentOrder('#o='+ORDER),ORDER);
 for(const value of ['', '#o='+ORDER+'&o='+ORDER,'#o='+ORDER+'&token=x','#o=https://invalid','#a='+ORDER])assert.equal(readPaymentOrder(value),null);
});
test('buyer payment view requires an existing owned order; finite response never claims paid or Premium',()=>{
 assert.deepEqual(validatePilotPix(pix(),ORDER,NOW),pix());
 for(const change of [{amountBRL:'49.90'},{orderId:ORDER.replace('aaaaaaaa','bbbbbbbb')},{premiumGranted:true},{paymentConfirmed:true},
 {state:'PAID'},{qrCode:'bad'},{expiresAt:new Date(NOW).toISOString()},{expiresAt:new Date(NOW+1800001).toISOString()},
 {qrCodeBase64:'<svg>'},{arbitrary:'private'}])assert.throws(()=>validatePilotPix({...pix(),...change},ORDER,NOW));
});
test('external ticket URL is never forwarded to the payment UI',()=>{
 const v=validatePilotPix({...pix(),ticketUrl:'https://untrusted.invalid/'},ORDER,NOW);
 assert.equal(v.ticketUrl,null);
});
test('fresh buyer callback sends only orderId to fixed read-only checkout and exposes no credentials in state',async()=>{
 const h=fixture();assert.equal(h.c.start(),true);const r={credential:JWT};
 assert.equal(await h.callbacks[0](r),true);assert.equal(r.credential,undefined);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].u,BUYER_CHECKOUT_API);
 assert.deepEqual(JSON.parse(h.calls[0].o.body),{orderId:ORDER});assert.equal(h.calls[0].o.credentials,'omit');assert.equal(h.calls[0].o.redirect,'error');
 assert.equal(h.c.snapshot().phase,'AWAITING_PAYMENT');assert.equal(h.c.getPix().amountBRL,'4.99');assert.equal(JSON.stringify(h.states).includes(JWT),false);
 assert.equal(await h.callbacks[0]({credential:JWT}),false);assert.equal(h.calls.length,1);
});
test('cancellation, expiry and late Google responses erase QR and cannot restore it',async()=>{
 const h=fixture();h.c.start();const cb=h.callbacks[0];h.c.reset();assert.equal(await cb({credential:JWT}),false);assert.equal(h.calls.length,0);
 h.c.start();await h.callbacks.at(-1)({credential:JWT});h.advance(120000);h.c.checkExpiry();assert.equal(h.c.getPix(),null);assert.equal(h.c.snapshot().hasPix,false);
});
test('expired or review-required provider states never contain a payable QR',async()=>{
 for(const state of ['EXPIRED','REVIEW_REQUIRED']){
  const v={state,qrCode:null,qrCodeBase64:null,ticketUrl:null,paymentConfirmed:false,premiumGranted:false};
  const h=fixture(async()=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}}));h.c.start();
  assert.equal(await h.callbacks[0]({credential:JWT}),true);assert.equal(h.c.getPix(),null);assert.equal(h.c.snapshot().phase,state);
 }
});
test('provider errors and oversized responses are bounded, sanitized and never retried automatically',async()=>{
 for(const fetcher of [async()=>{throw Error('private-provider-body');},async()=>new Response('x'.repeat(200001),{headers:{'content-type':'application/json'}})]){
  const h=fixture(fetcher);h.c.start();assert.equal(await h.callbacks[0]({credential:JWT}),false);
  assert.equal(h.calls.length,1);assert.equal(h.c.getPix(),null);assert.equal(JSON.stringify(h.states).includes('private-provider-body'),false);
 }
});
