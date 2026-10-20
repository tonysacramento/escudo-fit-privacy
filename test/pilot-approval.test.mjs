import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPilotApprovalInstallController,validateSignedApproval,APPROVAL_API} from '../app/pilot-pix/approval/approval.mjs';
import {approvalFile,approvalChallenge,approvalReceipt,NOW} from './helpers/pilot-approval-fixture.mjs';
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture({reply}={}){
  let now=NOW;const renders=[],calls=[],states=[],timers=new Map();let timerId=0;
  const controller=createPilotApprovalInstallController({now:()=>now,renderGoogle:p=>renders.push(p),onState:s=>states.push(s),
    entryNonce:()=> 'ef-install-entry-v1-synthetic',schedule:(fn,ms)=>{const k=++timerId;timers.set(k,{fn,ms});return k;},
    cancel:k=>timers.delete(k),fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});
      return response(reply?await reply(body,calls):body.action==='CHALLENGE'?approvalChallenge(now):approvalReceipt());}});
  const credential=role=>renders.findLast(p=>p.role===role).callback({credential:'synthetic.'+role+'.signature'});
  const load=()=>controller.loadFile(JSON.stringify(approvalFile()));
  const complete=async()=>{await load();controller.start();await credential('ENTRY');await credential('BUYER');return credential('OPERATOR');};
  return {controller,renders,calls,states,timers,credential,load,complete,setNow:n=>{now=n;}};
}
test('file validation checks exact scope/hash/expiry and does not claim cryptographic verification',async()=>{
  const value=await validateSignedApproval(JSON.stringify(approvalFile(NOW-600000)),NOW);
  assert.equal(value.record.maxAmountBRL,'4.99');assert.equal(value.signatureVerified,undefined);
  for(const patch of [{maxAmountBRL:'5.00'},{maxOrders:2},{receiverAccountId:'999'},{email:'private@example.invalid'},
    {operatorSignature:'bad'},{expiresAtMs:NOW},{issuedAtMs:NOW+60001},{requestKeyHash:'0'.repeat(64)}])
    await assert.rejects(validateSignedApproval(JSON.stringify({...approvalFile(),...patch}),NOW));
  await assert.rejects(validateSignedApproval(' '.repeat(8193),NOW));
  const unsigned=approvalFile();delete unsigned.operatorSignature;
  await assert.rejects(validateSignedApproval(JSON.stringify(unsigned),NOW));
});
test('three explicit callbacks send a signed scope to the fixed relay and clear transient data on success',async()=>{
  const f=fixture();assert.equal(await f.complete(),true);
  assert.equal(f.controller.snapshot().phase,'PASSED');
  assert.deepEqual(f.renders.map(r=>r.role),['ENTRY','BUYER','OPERATOR']);
  assert.match(f.renders[1].nonce,/^ef-install-buyer-v1-/);assert.match(f.renders[2].nonce,/^ef-install-operator-v1-/);
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].body,{action:'CHALLENGE',signedApproval:approvalFile()});
  assert.equal(f.calls[1].body.action,'INSTALL');assert.equal(f.calls[1].body.buyerIdToken,'synthetic.BUYER.signature');
  for(const c of f.calls){assert.equal(c.url,APPROVAL_API);assert.equal(c.options.credentials,'omit');
    assert.equal(c.options.cache,'no-store');assert.equal(c.options.redirect,'error');}
  assert.equal(f.controller.snapshot().hasCredentials,false);assert.equal(f.controller.snapshot().hasSignedFile,false);
  assert.equal(f.controller.snapshot().hasChallenge,false);assert.equal(f.controller.start(),false);
});
test('file is required and duplicate starts/callbacks cannot create repeated requests',async()=>{
  const f=fixture();assert.equal(f.controller.start(),false);await f.load();assert.equal(f.controller.start(),true);
  assert.equal(f.controller.start(),false);await f.credential('ENTRY');await f.credential('ENTRY');
  assert.equal(f.calls.length,1);f.controller.reset();await f.credential('BUYER');assert.equal(f.calls.length,1);
});
test('cancel or account reset invalidates a callback and discards its signed file',async()=>{
  const f=fixture();await f.load();f.controller.start();f.controller.reset('Conta mudou.');
  assert.equal(await f.credential('ENTRY'),false);assert.equal(f.calls.length,0);
  assert.deepEqual(f.controller.snapshot(),{phase:'READY',hasCredentials:false,hasChallenge:false,hasSignedFile:false});
});
test('unexpected financial flags, another scope digest or an extra private field reject the receipt',async()=>{
  for(const patch of [{financialGo:true},{orderCreated:true},{scopeDigest:'0'.repeat(64)},{email:'private@example.invalid'}]){
    const f=fixture({reply:body=>body.action==='CHALLENGE'?approvalChallenge():{...approvalReceipt(),...patch}});
    assert.equal(await f.complete(),false);assert.equal(f.controller.snapshot().phase,'FAILED');
    assert.equal(f.controller.snapshot().hasCredentials,false);assert.equal(f.controller.snapshot().hasSignedFile,false);
  }
});
test('expired signed file or challenge cannot resume the installation',async()=>{
  const f=fixture();await f.load();f.setNow(NOW+1800001);assert.equal(f.controller.start(),false);assert.equal(f.calls.length,0);
  const g=fixture();await g.load();g.controller.start();await g.credential('ENTRY');g.setNow(NOW+300001);
  assert.equal(await g.credential('BUYER'),false);assert.equal(g.calls.length,1);assert.equal(g.controller.snapshot().hasSignedFile,false);
});
test('reset during async file validation cannot restore a stale file',async()=>{
  const f=fixture();const pending=f.load();f.controller.reset();assert.equal(await pending,false);
  assert.equal(f.controller.snapshot().hasSignedFile,false);assert.equal(f.controller.start(),false);
});
test('wrong-purpose challenge fails closed before buyer callback; request outcome is never retried automatically',async()=>{
  const f=fixture({reply:()=>({...approvalChallenge(),purpose:'ESCUDO_FIT_NONFINANCIAL_APPROVAL_PREVIEW_V1'})});
  await f.load();f.controller.start();assert.equal(await f.credential('ENTRY'),false);assert.equal(f.renders.length,1);
  assert.equal(f.calls.length,1);assert.equal(f.controller.snapshot().hasCredentials,false);
});
test('restricted page has fixed CSP and file input; module has no storage, token decoding or logging',()=>{
  const html=readFileSync(new URL('../app/pilot-pix/approval/index.html',import.meta.url),'utf8');
  assert.match(html,/noindex,nofollow,noarchive/);assert.match(html,/form-action 'none'/);
  assert.match(html,/pilot-approval---escudo-fit-api-v38/);assert.match(html,/type="file"/);
  assert.equal(/type="password"|<textarea|type="submit"/.test(html),false);
  const source=readFileSync(new URL('../app/pilot-pix/approval/approval.mjs',import.meta.url),'utf8');
  assert.equal(/localStorage|sessionStorage|indexedDB|console\.|atob\(|sendBeacon|serviceWorker\.register/.test(source),false);
  assert.match(html,/autorizacao-piloto-pix/);
});
