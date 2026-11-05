import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2ApprovalController,APPROVAL_URL,CHALLENGE_URL} from '../app/pilot-pix/v2-approval/approval.mjs';
const token=x=>[x,x,x].join('.');
const nonce=x=>'ef-v2-'+x+'-'+'a'.repeat(43);
const challenge={state:'V2_GOOGLE_CHALLENGE',challengeId:'602f096e-8f80-4039-9d79-f8b5a0c24920',
  buyerNonce:nonce('buyer'),operatorNonce:nonce('operator'),expiresAtMs:1300000};
test('server challenge binds Google buyer and operator; no approval without explicit confirmation',async()=>{
  let phase,credentials,requests=0;
  const ctrl=createV2ApprovalController({renderGoogle:p=>{phase=p.role;credentials=p;},now:()=>1000000,
    fetchImpl:async(u,o)=>{
      requests++;
      if(u===CHALLENGE_URL){assert.equal(o.headers.authorization,'Bearer '+token('bootstrap'));
        return {ok:true,headers:{get:()=> 'application/json'},json:async()=>challenge};}
      assert.equal(u,APPROVAL_URL);
      assert.equal(o.headers.authorization,'Bearer '+token('operator'));
      assert.equal(o.headers['x-escudo-buyer-authorization'],'Bearer '+token('buyer'));
      assert.equal(o.headers['x-escudo-challenge-id'],challenge.challengeId);
      assert.equal(o.credentials,'omit');
      return {ok:true,headers:{get:()=> 'application/json'},
        json:async()=>({state:'APPROVED_V2_SINGLE_PILOT',
          approvalId:'602f096e-8f80-4039-9d79-f8b5a0c24920',ordersCreated:0,premiumGranted:false})};
    }});
  assert.equal(await ctrl.confirm(),false);assert.equal(requests,0);
  ctrl.start();assert.equal(phase,'BOOTSTRAP');
  await credentials.callback({credential:token('bootstrap')});
  assert.equal(phase,'BUYER');assert.equal(credentials.nonce,challenge.buyerNonce);
  await credentials.callback({credential:token('buyer')});
  assert.equal(phase,'OPERATOR');assert.equal(credentials.nonce,challenge.operatorNonce);
  await credentials.callback({credential:token('operator')});
  assert.equal(ctrl.state().step,'CONFIRM');assert.equal(requests,1);
  assert.equal(await ctrl.confirm(),true);assert.equal(requests,2);
  assert.equal(ctrl.state().hasTokens,false);
});
test('cancel and timeout erase tokens without approval call',async()=>{
  let cb,requests=0,now=1000000;
  const ctrl=createV2ApprovalController({renderGoogle:x=>{cb=x.callback;},now:()=>now,
    fetchImpl:async()=>{requests++;throw Error('CHALLENGE_NOT_EXPECTED');}});
  ctrl.start();ctrl.reset();assert.equal(ctrl.state().hasTokens,false);
  assert.equal(await ctrl.confirm(),false);assert.equal(requests,0);
  ctrl.start();now+=300001;ctrl.checkExpiry();
  assert.equal(ctrl.state().step,'READY');assert.equal(ctrl.state().hasTokens,false);
});
test('challenge OFF never appears as approval success',async()=>{
  let cb,approveCalls=0;
  const ctrl=createV2ApprovalController({renderGoogle:x=>cb=x.callback,now:()=>1000000,
    fetchImpl:async()=>{approveCalls++;return {ok:false,status:503,
      headers:{get:()=> 'application/json'}};}});
  ctrl.start();await cb({credential:token('bootstrap')});
  assert.equal(approveCalls,1);assert.equal(ctrl.state().step,'HELD');
  assert.equal(ctrl.state().hasTokens,false);
  assert.equal(await ctrl.confirm(),false);
});
