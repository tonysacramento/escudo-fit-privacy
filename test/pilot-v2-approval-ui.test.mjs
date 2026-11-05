import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2ApprovalController,APPROVAL_URL} from '../app/pilot-pix/v2-approval/approval.mjs';
const token=x=>[x,x,x].join('.');
test('v2 requires operator and buyer Google sign-in and explicit confirmation',async()=>{
  let phase,credentials,requests=0;
  const controller=createV2ApprovalController({renderGoogle:p=>{phase=p.role;credentials=p;},
    now:()=>1000000,
    fetchImpl:async(u,o)=>{requests++;assert.equal(u,APPROVAL_URL);
      assert.equal(o.headers.authorization,'Bearer '+token('operator'));
      assert.equal(o.headers['x-escudo-buyer-authorization'],'Bearer '+token('buyer'));
      assert.equal(o.credentials,'omit');return {ok:true,headers:{get:()=> 'application/json'},
        json:async()=>({state:'APPROVED_V2_SINGLE_PILOT',approvalId:'602f096e-8f80-4039-9d79-f8b5a0c24920',ordersCreated:0,premiumGranted:false})};
    }});
  assert.equal(await controller.confirm(),false);assert.equal(requests,0);
  controller.start();assert.equal(phase,'OPERATOR');assert.equal(requests,0);
  credentials.callback({credential:token('operator')});
  assert.equal(phase,'BUYER');assert.equal(requests,0);
  credentials.callback({credential:token('buyer')});
  assert.equal(controller.state().step,'CONFIRM');assert.equal(requests,0);
  assert.equal(await controller.confirm(),true);assert.equal(requests,1);
  assert.equal(controller.state().hasTokens,false);
});
test('cancel and timeout erase tokens without calling backend',async()=>{
  let callback,requests=0,now=1000000;
  const controller=createV2ApprovalController({renderGoogle:x=>{callback=x.callback;},
    now:()=>now,fetchImpl:async()=>{requests++;throw Error('UNEXPECTED');}});
  controller.start();callback({credential:token('operator')});
  assert.equal(controller.state().hasTokens,true);
  controller.reset();assert.equal(controller.state().hasTokens,false);
  assert.equal(await controller.confirm(),false);assert.equal(requests,0);
  controller.start();now+=120001;controller.checkExpiry();
  assert.equal(controller.state().hasTokens,false);
});
test('backend OFF never appears as approval success',async()=>{
  let callback;
  const controller=createV2ApprovalController({
    renderGoogle:x=>callback=x.callback,now:()=>1000000,
    fetchImpl:async()=>({ok:false,status:503,headers:{get:()=> 'application/json'}})});
  controller.start();callback({credential:token('operator')});callback({credential:token('buyer')});
  assert.equal(await controller.confirm(),false);assert.equal(controller.state().hasTokens,false);
  assert.equal(controller.state().step,'HELD');
});
