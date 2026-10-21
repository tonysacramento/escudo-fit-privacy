import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPilotIssueController,validateIssueApproval,readIssueBuyerLink,validateIssueResult,ISSUE_API,ISSUE_PURPOSE} from '../app/pilot-pix/issue/issue.mjs';
import {approvalFile,NOW} from './helpers/pilot-approval-fixture.mjs';
const JWT='synthetic.synthetic.synthetic',OP='operator.operator.operator',BUY='buyer.buyer.buyer';
const C='C'.repeat(43),B='ef-issue-buyer-v1-'+'B'.repeat(43),O='ef-issue-operator-v1-'+'O'.repeat(43);
const challenge=()=>({state:'CHALLENGE',purpose:ISSUE_PURPOSE,challengeId:C,buyerNonce:B,operatorNonce:O,
 expiresAtMs:NOW+120000,financialGo:false,orderCreated:false,paymentConfirmed:false,premiumGranted:false});
const output=()=>({state:'ORDER_CREATED_FINANCIAL_CONTRACT_PENDING',orderId:'EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',orderCreated:true,paymentConfirmed:false,premiumGranted:false});
const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
function harness(opts={}){
 let ms=NOW;const prompts=[],calls=[],states=[];
 const h=createPilotIssueController({now:()=>ms,renderGoogle:p=>prompts.push(p),onState:s=>states.push(s),
  schedule:()=>1,cancel:()=>{},entryNonce:()=> 'ef-issue-entry-v1-'+'E'.repeat(43),
  fetchImpl:async(url,init)=>{
   const body=JSON.parse(init.body);calls.push({url,body,headers:init.headers,options:init});
   if(opts.fetch)return opts.fetch(url,init,body,calls);
   return response(body.action==='CHALLENGE'?challenge():url.endsWith('/buyer')?
    {state:'BUYER_CONFIRMED',challengeId:C,expiresAtMs:NOW+120000}:output());
  },...opts.controller});
 return {h,prompts,calls,states,advance:n=>{ms+=n;}};
}
async function operatorReady(opts={}){
 const x=harness(opts);assert.equal(await x.h.loadFile(JSON.stringify(approvalFile())),true);
 assert.equal(x.h.start(true),true);assert.equal(await x.prompts[0].callback({credential:JWT}),true);
 return x;
}
async function issue(x){
 assert.equal(x.h.confirmOperator(),true);
 return x.prompts.at(-1).callback({credential:OP});
}
test('client checks signed file encoding, scope, receiver and expiry; it never claims to verify the signature',async()=>{
 const valid=approvalFile();assert.equal((await validateIssueApproval(JSON.stringify(valid),NOW)).record.maxOrders,1);
 const changes={maxAmountBRL:'5.00',maxOrders:2,receiverAccountId:'other',currency:'USD',channel:'OTHER',termsVersion:'other',
  approvedBySubjectHash:'a'.repeat(64),subjectHash:valid.approvedBySubjectHash,expiresAtMs:NOW+1800001,
  requestKeyHash:'a'.repeat(64),operatorSignature:'x',unknown:true};
 for(const [key,value] of Object.entries(changes))await assert.rejects(validateIssueApproval(JSON.stringify({...valid,[key]:value}),NOW),key);
 await assert.rejects(validateIssueApproval(JSON.stringify(valid),valid.expiresAtMs));
 await assert.rejects(validateIssueApproval('x'.repeat(8193),NOW));
});
test('buyer fragment is bounded, role-specific, exact and contains no operator nonce or credentials',()=>{
 const share={a:approvalFile().approvalId,c:C,n:B,e:String(NOW+120000)},hash='#'+new URLSearchParams(share);
 assert.equal(readIssueBuyerLink(hash,NOW).buyerNonce,B);
 for(const bad of [hash+'&extra=1',hash+'&c='+C,hash.replace(B,O),'',hash.replace(String(NOW+120000),String(NOW)),hash.replace(C,'short')])
  assert.equal(readIssueBuyerLink(bad,NOW),null);
});
test('fixed gateway, no form or storage; terms and file are required before Google',async()=>{
 const {h,prompts}=harness();
 assert.equal(h.start(true),false);await h.loadFile(JSON.stringify(approvalFile()));
 assert.equal(h.start(false),false);assert.equal(h.start('true'),false);assert.equal(h.confirmOperator(),false);assert.equal(prompts.length,0);
 const html=readFileSync(new URL('../app/pilot-pix/issue/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app/pilot-pix/issue/issue.mjs',import.meta.url),'utf8');
 assert.match(html,/form-action 'none'/);assert.doesNotMatch(html,/<form\b/i);
 assert.match(html,/R\$ 4,99/);assert.match(html,/30 dias/);assert.match(html,/role="status"/);
 assert.doesNotMatch(js,/\b(localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|EventSource)\b/);
 assert.doesNotMatch(html,/escudo-fit-api-v38|h2off---/);
 assert.equal(new URL(ISSUE_API).origin,'https://escudo-fit-pilot-h3b-gateway-olb3tmj35q-uc.a.run.app');
});
test('dual-device flow delivers buyer credential only to buyer endpoint and sends one operator ISSUE',async()=>{
 const x=await operatorReady();
 const share=x.h.getShare();assert.equal(share.buyerNonce,B);assert.equal(share.approvalId,approvalFile().approvalId);
 assert.equal(x.prompts[0].role,'operator');
 const buyer=harness({controller:{role:'buyer',buyerLink:share}});
 assert.equal(buyer.h.start(true),true);assert.equal(buyer.prompts[0].nonce,B);assert.equal(buyer.prompts[0].role,'buyer');
 const own={credential:BUY};assert.equal(await buyer.prompts[0].callback(own),true);assert.equal(own.credential,undefined);
 assert.equal(buyer.calls.length,1);assert.equal(buyer.calls[0].url,ISSUE_API+'/buyer');
 assert.deepEqual(Object.keys(buyer.calls[0].body),['approvalId','challengeId','buyerNonce']);
 assert.equal(buyer.h.snapshot().phase,'BUYER_CONFIRMED');assert.equal(buyer.h.confirmOperator(),false);
 assert.equal(await issue(x),true);assert.equal(x.prompts[1].nonce,O);
 const sent=x.calls.find(c=>c.body.action==='ISSUE');
 assert.deepEqual(Object.keys(sent.body),['action','mode','approvalId','challengeId','operatorIdToken','requestKey','confirmedTermsVersion']);
 assert.equal(sent.body.operatorIdToken,OP);assert.equal(Object.hasOwn(sent.body,'buyerIdToken'),false);
 assert.equal(sent.headers.authorization,'Bearer '+JWT);assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.redirect,'error');
 assert.equal(x.calls.some(c=>JSON.stringify(c).includes(BUY)),false);
 assert.equal(x.h.snapshot().phase,'ORDER_CREATED');assert.equal(x.h.snapshot().hasCredentials,false);
 assert.deepEqual(x.h.getResult(),output());assert.equal(x.h.getShare(),null);
 assert.equal(x.h.start(true),false);assert.equal(x.h.confirmOperator(),false);assert.equal(x.h.reset(),false);
 assert.equal(await x.h.loadFile(JSON.stringify(approvalFile())),false);assert.equal(x.calls.filter(c=>c.body.action==='ISSUE').length,1);
});
test('duplicate or stale Google callback cannot race into a second POST',async()=>{
 const x=await operatorReady();x.h.confirmOperator();const cb=x.prompts.at(-1).callback;
 const first=cb({credential:OP}),second=cb({credential:OP});
 assert.equal(await second,false);assert.equal(await first,true);
 assert.equal(x.calls.filter(c=>c.body.action==='ISSUE').length,1);
 assert.equal(await cb({credential:OP}),false);
});
test('cancel before confirmation and expiry erase RAM and reject late callbacks',async()=>{
 const x=await operatorReady();x.h.confirmOperator();const cb=x.prompts.at(-1).callback;
 assert.equal(x.h.reset(),true);assert.equal(await cb({credential:OP}),false);
 assert.equal(x.h.snapshot().hasCredentials,false);assert.equal(x.calls.length,1);
 const y=await operatorReady();y.advance(120000);y.h.checkExpiry();
 assert.equal(y.h.snapshot().hasChallenge,false);assert.equal(y.h.confirmOperator(),false);assert.equal(y.calls.length,1);
});
test('503 at challenge never posts ISSUE or retries automatically',async()=>{
 const x=harness({fetch:()=>response({state:'DISABLED'},503)});
 await x.h.loadFile(JSON.stringify(approvalFile()));x.h.start(true);
 assert.equal(await x.prompts[0].callback({credential:JWT}),false);
 assert.equal(x.calls.length,1);assert.equal(x.h.snapshot().attempted,false);assert.equal(x.h.snapshot().hasCredentials,false);
});
test('ambiguous financial response permanently latches this page against resubmission',async()=>{
 const x=await operatorReady({fetch:(_u,_i,b)=>b.action==='CHALLENGE'?response(challenge()):Promise.reject(Error('raw-provider-secret-not-for-ui'))});
 assert.equal(await issue(x),false);
 assert.equal(x.h.snapshot().phase,'OUTCOME_UNCERTAIN');assert.equal(x.h.snapshot().attempted,true);
 assert.equal(x.h.start(true),false);assert.equal(x.h.confirmOperator(),false);x.h.reset();
 assert.equal(x.h.start(true),false);assert.equal(x.calls.filter(c=>c.body.action==='ISSUE').length,1);
 assert.equal(JSON.stringify(x.states).includes('raw-provider-secret'),false);
});
test('malformed 200 result is uncertain and cannot leak provider fields to UI',async()=>{
 const x=await operatorReady({fetch:(_u,_i,b)=>response(b.action==='CHALLENGE'?challenge():{...output(),qrCode:'private-extra'})});
 assert.equal(await issue(x),false);assert.equal(x.h.getResult(),null);assert.equal(x.h.snapshot().phase,'OUTCOME_UNCERTAIN');
 assert.equal(JSON.stringify(x.states).includes('private-extra'),false);assert.equal(x.h.start(true),false);
});
test('missing buyer confirmation cannot cause automatic retry after the final request fails',async()=>{
 const x=await operatorReady({fetch:(_u,_i,b)=>b.action==='CHALLENGE'?response(challenge()):response({code:'PILOT_H3B_BUYER_CONSUME_REJECTED'},409)});
 assert.equal(await issue(x),false);assert.equal(x.calls.filter(c=>c.body.action==='ISSUE').length,1);
 assert.equal(x.h.confirmOperator(),false);assert.equal(x.h.start(true),false);
});
test('invalid Google encoding, wrong challenge purpose and oversized body stop before final POST',async()=>{
 const x=harness();await x.h.loadFile(JSON.stringify(approvalFile()));x.h.start(true);
 assert.equal(await x.prompts[0].callback({credential:'invalid'}),false);assert.equal(x.calls.length,0);
 for(const value of [{...challenge(),purpose:'IDENTITY_QA_ONLY'},{...challenge(),buyerNonce:O},{...challenge(),token:'hidden'}]){
  const y=harness({fetch:()=>response(value)});await y.h.loadFile(JSON.stringify(approvalFile()));y.h.start(true);
  assert.equal(await y.prompts[0].callback({credential:JWT}),false);assert.equal(y.h.confirmOperator(),false);
 }
 const y=harness({fetch:()=>new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}})});
 await y.h.loadFile(JSON.stringify(approvalFile()));y.h.start(true);assert.equal(await y.prompts[0].callback({credential:JWT}),false);
});
test('only bounded finite issuance results are accepted; creation never confirms payment or Premium',()=>{
 assert.deepEqual(validateIssueResult(output()),output());
 for(const change of [{paymentConfirmed:true},{premiumGranted:true},{state:'PAID'},{orderId:'arbitrary-url'},
  {orderCreated:false},{reason:'unbounded lowercase'},{token:'secret'},{mode:'ISSUE'}])assert.throws(()=>validateIssueResult({...output(),...change}));
 const review={state:'PROVIDER_POST_OUTCOME_UNCERTAIN',orderId:null,orderCreated:false,paymentConfirmed:false,premiumGranted:false};
 assert.deepEqual(validateIssueResult(review),review);
});
