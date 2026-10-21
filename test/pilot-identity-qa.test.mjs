import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityQaController,validateIdentityReceipt,readBuyerLink,PURPOSE} from '../app/pilot-pix/identity/identity.mjs';
const id=Buffer.alloc(32,1).toString('base64url'),buyerNonce='ef-h3b-qa-buyer-v1-'+Buffer.alloc(32,2).toString('base64url'),operatorNonce='ef-h3b-qa-operator-v1-'+Buffer.alloc(32,3).toString('base64url');
const flags={financialGo:false,orderCreated:false,paymentConfirmed:false,premiumGranted:false};
const now=1900000000000;
const receipt=()=>({state:'IDENTITIES_VERIFIED_NO_ORDER',purpose:PURPOSE,challengeId:id,completedAtMs:now,receiptDigest:'a'.repeat(64),googleSignaturesVerified:true,noncesVerified:true,identitiesDistinct:true,operatorVerified:true,buyerVerified:true,...flags});
const scope=()=>({state:'CHALLENGE',purpose:PURPOSE,challengeId:id,buyerNonce,operatorNonce,expiresAtMs:now+120000,...flags});
function harness(options={}){
 let clock=now;const prompts=[],requests=[],states=[];
 const controller=createIdentityQaController({now:()=>clock,schedule:()=>1,cancel:()=>{},entryNonce:()=> 'ef-h3b-qa-entry-v1-'+Buffer.alloc(32,9).toString('base64url'),renderGoogle:p=>prompts.push(p),onState:s=>states.push(s),
  fetchImpl:async(url,request)=>{const body=JSON.parse(request.body);requests.push({url,body,authorization:request.headers.authorization,credentials:request.credentials});
   let result=body.action==='CHALLENGE'?scope():body.action==='BUYER_CONFIRM'?{state:'BUYER_CONFIRMED',purpose:PURPOSE,challengeId:id,expiresAtMs:now+120000,...flags}:body.action==='STATUS'?{state:'WAITING_OPERATOR',purpose:PURPOSE,challengeId:id,expiresAtMs:now+120000,...flags}:receipt();
   if(options.response)result=options.response(body,result);
   return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  },...options});
 return{controller,prompts,requests,states,advance:ms=>clock+=ms};
}
test('operator flow never receives buyer credentials and clears bootstrap on completion',async()=>{
 const h=harness();h.controller.start();assert.equal(h.prompts[0].role,'operator');
 await h.prompts[0].callback({credential:'entry.user.sig'});assert.equal(h.controller.snapshot().phase,'WAITING_BUYER');assert.ok(h.controller.getShare());
 await h.controller.status();assert.equal(h.prompts[1].nonce,operatorNonce);await h.prompts[1].callback({credential:'operator.user.sig'});
 assert.equal(h.controller.snapshot().phase,'PASSED');assert.equal(h.controller.snapshot().hasCredentials,false);assert.equal(h.controller.getReceipt().receiptDigest,'a'.repeat(64));
 assert.deepEqual(h.requests.map(r=>r.body.action),['CHALLENGE','STATUS','OPERATOR_CONFIRM']);
 assert.ok(h.requests.every(r=>r.credentials==='omit'));assert.doesNotMatch(JSON.stringify(h.requests),/buyerIdToken|buyer\.user\.sig|ISSUE|amount|receiver/);
});
test('buyer page sends only its own nonce-bound credential and cannot obtain operator proof',async()=>{
 const h=harness({role:'buyer',buyerLink:{challengeId:id,buyerNonce,expiresAtMs:now+120000}});h.controller.start();assert.equal(h.prompts[0].role,'buyer');assert.equal(h.prompts[0].nonce,buyerNonce);
 await h.prompts[0].callback({credential:'buyer.user.sig'});assert.equal(h.controller.snapshot().phase,'BUYER_PASSED');assert.equal(h.controller.snapshot().hasCredentials,false);assert.equal(h.controller.getReceipt(),null);assert.equal(h.controller.getShare(),null);
 assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].body,{action:'BUYER_CONFIRM',challengeId:id,buyerNonce});assert.equal(h.requests[0].authorization,'Bearer buyer.user.sig');
});
test('receipt rejects financial states, wrong purpose, identity confusion and extra fields',()=>{
 assert.equal(validateIdentityReceipt(receipt(),now).state,'IDENTITIES_VERIFIED_NO_ORDER');
 for(const delta of [{orderCreated:true},{premiumGranted:true},{purpose:'ESCUDO_FIT_FIRST_LIVE_ISSUE_OPERATOR_V1'},{noncesVerified:false},{identitiesDistinct:false},{token:'synthetic'},{completedAtMs:1}])assert.throws(()=>validateIdentityReceipt({...receipt(),...delta},now));
});
test('forged financial response fails closed and cannot be downloaded',async()=>{
 const h=harness({response:(b,r)=>b.action==='OPERATOR_CONFIRM'?{...r,orderCreated:true}:r});h.controller.start();await h.prompts[0].callback({credential:'entry.user.sig'});await h.controller.status();await h.prompts[1].callback({credential:'operator.user.sig'});
 assert.equal(h.controller.snapshot().phase,'FAILED');assert.equal(h.controller.getReceipt(),null);assert.equal(h.controller.snapshot().hasCredentials,false);
});
test('cancel, expiry and late Google callback discard all transient state',async()=>{
 const h=harness();h.controller.start();const late=h.prompts[0];h.controller.reset();await late.callback({credential:'entry.user.sig'});assert.equal(h.requests.length,0);assert.equal(h.controller.snapshot().hasCredentials,false);
 h.controller.start();await h.prompts[1].callback({credential:'entry.user.sig'});h.advance(120001);h.controller.checkExpiry();assert.equal(h.controller.snapshot().phase,'EXPIRED');assert.equal(h.controller.getShare(),null);assert.equal(h.controller.snapshot().hasCredentials,false);
});
test('duplicate clicks and callbacks do not create repeated server actions',async()=>{
 const h=harness();assert.equal(h.controller.start(),true);assert.equal(h.controller.start(),false);const cb=h.prompts[0].callback;await cb({credential:'entry.user.sig'});await cb({credential:'entry.user.sig'});assert.equal(h.requests.length,1);
 h.controller.reset();
});
test('buyer links contain only bounded session nonce, never a token or payment scope',()=>{
 const good=new URLSearchParams({c:id,n:buyerNonce,e:String(now+120000)}).toString();assert.equal(readBuyerLink('#'+good,now).challengeId,id);
 for(const bad of [good+'&token=entry.user.sig',good+'&c='+id,good.replace(buyerNonce,operatorNonce),good.replace(String(now+120000),'1')])assert.equal(readBuyerLink('#'+bad,now),null);
 const h=harness({role:'buyer',buyerLink:null});assert.equal(h.controller.start(),false);assert.equal(h.prompts.length,0);assert.equal(h.requests.length,0);
});
