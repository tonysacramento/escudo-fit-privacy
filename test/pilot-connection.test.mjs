import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectionCheck,CONNECTION_API} from '../app/pilot-pix/connection/connection.mjs';
const base=Date.UTC(2026,9,22,0,0,0);
const challenge=()=>({state:'CHALLENGE',purpose:'ESCUDO_FIT_FIRST_LIVE_ISSUE_OPERATOR_V1',
 challengeId:'C'.repeat(43),buyerNonce:'ef-issue-buyer-v1-'+'B'.repeat(43),
 operatorNonce:'ef-issue-operator-v1-'+'O'.repeat(43),expiresAtMs:base+119000,
 financialGo:false,orderCreated:false,paymentConfirmed:false,premiumGranted:false});
function fixture(fetcher=async()=>Response.json(challenge())){
 let options,clock=base;const calls=[],states=[];
 const controller=createConnectionCheck({now:()=>clock,
  newId:()=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',nonce:()=>'ef-issue-entry-v1-'+'E'.repeat(43),
  schedule:()=>1,cancel:()=>{},renderGoogle:o=>{options=o},onState:s=>states.push(s),
  fetchImpl:async(...args)=>{calls.push(args);return fetcher(...args)}});
 return {controller,calls,states,login:response=>options.callback(response||{credential:'private.synthetic.signature'}),
  advance:ms=>{clock+=ms}};
}
test('connection check requires explicit Google confirmation and only sends CHALLENGE',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.controller.start(),true);
 assert.equal(f.calls.length,0);const credential={credential:'private.synthetic.signature'};
 assert.equal(await f.login(credential),true);assert.equal(credential.credential,undefined);
 assert.equal(f.calls.length,1);const [url,options]=f.calls[0];
 assert.equal(url,CONNECTION_API);assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');
 assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
 assert.deepEqual(JSON.parse(options.body),{action:'CHALLENGE',approvalId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
 assert.equal(options.headers.authorization,'Bearer private.synthetic.signature');
 assert.equal(f.states.at(-1).phase,'PASSED');
 assert.doesNotMatch(JSON.stringify(f.states),/signature|buyerNonce|operatorNonce|challengeId/);
 assert.equal(await f.login(),false);assert.equal(f.controller.start(),false);assert.equal(f.calls.length,1);
});
test('HTTP error exposes only its numeric category and never reads or displays a server body',async()=>{
 let bodyRead=false;const f=fixture(async()=>({ok:false,status:400,
  get body(){bodyRead=true;throw Error('PRIVATE_CANARY_DO_NOT_LOG')}}));
 f.controller.start();assert.equal(await f.login(),false);
 assert.equal(f.states.at(-1).code,'HTTP_400');assert.equal(bodyRead,false);
 assert.equal(f.controller.start(),false);assert.equal(f.calls.length,1);
 assert.doesNotMatch(JSON.stringify(f.states),/PRIVATE_CANARY/);
});
test('financial authority, unexpected fields and expired challenge responses fail closed',async()=>{
 for(const patch of [{financialGo:true},{orderCreated:true},{premiumGranted:true},
  {operatorIdToken:'PRIVATE_CANARY_DO_NOT_LOG'},{expiresAtMs:base-1},{expiresAtMs:base+120001}]){
  const f=fixture(async()=>Response.json({...challenge(),...patch}));
  f.controller.start();assert.equal(await f.login(),false);assert.equal(f.states.at(-1).phase,'FAILED');
  assert.equal(f.calls.length,1);assert.equal(f.controller.start(),false);
  assert.doesNotMatch(JSON.stringify(f.states),/PRIVATE_CANARY/);
 }
});
test('network error details and credentials are discarded without automatic retry',async()=>{
 const f=fixture(async()=>{throw Error('Bearer PRIVATE_CANARY_DO_NOT_LOG')});
 f.controller.start();assert.equal(await f.login(),false);
 assert.equal(f.states.at(-1).code,'CONNECTION_UNAVAILABLE');assert.equal(f.calls.length,1);
 assert.doesNotMatch(JSON.stringify(f.states),/PRIVATE_CANARY|Bearer/);
});
test('cancelling before the Google callback prevents any network call',async()=>{
 const f=fixture();f.controller.start();f.controller.cancel();
 assert.equal(await f.login(),false);assert.equal(f.calls.length,0);
 assert.equal(f.states.at(-1).phase,'CANCELLED');
});
test('cancelling a pending fetch prevents a late success from changing the result',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve}));
 f.controller.start();const pending=f.login();f.controller.cancel();finish(Response.json(challenge()));
 assert.equal(await pending,false);assert.equal(f.states.at(-1).phase,'CANCELLED');
 assert.equal(f.calls[0][1].signal.aborted,true);assert.equal(f.calls.length,1);
});
test('expired login cannot contact the gateway',async()=>{
 const f=fixture();f.controller.start();f.advance(120001);
 assert.equal(await f.login(),false);assert.equal(f.calls.length,0);
 assert.equal(f.states.at(-1).code,'CONNECTION_SESSION_EXPIRED');
});
test('bounded response and invalid credential are rejected before exposing data or reaching a financial route',async()=>{
 const f=fixture(async()=>new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}));
 f.controller.start();assert.equal(await f.login(),false);
 assert.equal(f.states.at(-1).code,'CONNECTION_RESPONSE_REJECTED');assert.equal(f.calls.length,1);
 const invalid=fixture();invalid.controller.start();assert.equal(await invalid.login({credential:'invalid'}),false);
 assert.equal(invalid.calls.length,0);assert.equal(invalid.states.at(-1).code,'CONNECTION_CREDENTIAL_REJECTED');
});
