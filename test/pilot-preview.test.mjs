import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPilotPreviewController,validatePreviewResponse,PREVIEW_API } from '../app/pilot-pix/preview.mjs';
import { previewChallenge,previewProof } from './helpers/pilot-preview-fixture.mjs';
const NOW=Date.UTC(2026,9,19,20),response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(options={}){
  const calls=[],renders=[],states=[],timers=new Map();let next=0,now=NOW;
  const controller=createPilotPreviewController({now:()=>now,entryNonce:()=> 'synthetic-entry-nonce',
    renderGoogle:v=>renders.push(v),onState:s=>states.push(s),
    schedule:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),
    fetchImpl:async(url,options)=>{calls.push({url,options});return response(calls.length===1?previewChallenge(now):previewProof(now));},...options});
  const credential=(role,token='synthetic.'+role+'.signature')=>renders.findLast(x=>x.role===role).callback({credential:token});
  const complete=async()=>{controller.start();await credential('ENTRY');await credential('BUYER');return credential('OPERATOR');};
  return {controller,calls,renders,states,timers,credential,complete,setNow:v=>{now=v;}};
}
test('explicit three callbacks generate a verified unsigned file and erase all credentials',async()=>{
  const h=fixture();assert.equal(h.calls.length,0);assert.equal(h.controller.getDownload(),null);
  await h.complete();assert.deepEqual(h.controller.snapshot(),{phase:'PASSED',hasCredentials:false,hasChallenge:false,hasProposal:true});
  assert.equal(h.renders[1].nonce,previewChallenge(NOW).buyerNonce);assert.equal(h.renders[2].nonce,previewChallenge(NOW).operatorNonce);
  assert.equal(h.calls.length,2);for(const c of h.calls){assert.equal(c.url,PREVIEW_API);assert.equal(c.options.credentials,'omit');
    assert.equal(c.options.cache,'no-store');assert.equal(c.options.redirect,'error');}
  assert.equal(JSON.parse(h.calls[1].options.body).action,'PREVIEW');
  const file=h.controller.getDownload();assert.match(file.filename,/proposta-sem-assinatura.*\.json$/);
  assert.deepEqual(JSON.parse(file.contents),previewProof(NOW).proposal);
  assert.equal(file.contents.includes('synthetic.'),false);assert.equal(file.contents.includes('operatorSignature'),false);
  assert.equal(JSON.stringify(h.states).includes('signature'),false);assert.equal(JSON.stringify(h.states).includes('bindingDigest'),false);
});
test('client verifies canonical payload digest and refuses a substituted request key or financial scope',async()=>{
  const valid=previewProof(NOW);await validatePreviewResponse(valid,NOW);
  for(const patch of [{receiverAccountId:'999'},{maxAmountBRL:'5.00'},{maxOrders:2},{requestKeyHash:'a'.repeat(64)},
    {approvedBySubjectHash:'a'.repeat(64)},{termsVersion:'different'},{expiresAtMs:NOW+1800001},{operatorSignature:'fake'}])
    await assert.rejects(validatePreviewResponse({...valid,proposal:{...valid.proposal,record:{...valid.proposal.record,...patch}}},NOW));
  await assert.rejects(validatePreviewResponse({...valid,scopeDigest:'a'.repeat(64)},NOW));
});
test('OFF and malformed credential fail before download with no retry or private message',async()=>{
  const h=fixture();h.controller.start();await h.credential('ENTRY','invalid');assert.equal(h.calls.length,0);
  assert.equal(h.controller.snapshot().phase,'FAILED');assert.equal(h.controller.getDownload(),null);
  let calls=0;const off=fixture({fetchImpl:async()=>{calls++;return new Response('{"state":"DISABLED"}',{status:503});}});
  off.controller.start();await off.credential('ENTRY');assert.equal(calls,1);assert.equal(off.controller.getDownload(),null);
});
test('cancel suppresses a late challenge, old callbacks and a late final proposal',async()=>{
  let release;const h=fixture({fetchImpl:()=>new Promise(r=>{release=r;})});h.controller.start();const old=h.renders[0].callback;
  const pending=h.credential('ENTRY');h.controller.reset();release(response(previewChallenge(NOW)));await pending;
  assert.equal(h.controller.snapshot().phase,'READY');h.controller.start();assert.equal(await old({credential:'synthetic.old.signature'}),false);
  let count=0,finish;const f=fixture({fetchImpl:async()=>++count===1?response(previewChallenge(NOW)):new Promise(r=>{finish=r;})});
  f.controller.start();await f.credential('ENTRY');await f.credential('BUYER');const p=f.credential('OPERATOR');
  f.controller.reset();finish(response(previewProof(NOW)));await p;assert.equal(f.controller.getDownload(),null);
  assert.equal(f.states.some(s=>s.phase==='PASSED'),false);
});
test('expiry before Google proof and after proposal removes credentials and download material',async()=>{
  const h=fixture();h.controller.start();await h.credential('ENTRY');h.setNow(NOW+300001);h.controller.checkExpiry();
  assert.equal(h.controller.snapshot().phase,'EXPIRED');assert.equal(await h.credential('BUYER'),false);
  const f=fixture();await f.complete();f.setNow(NOW+1800001);assert.equal(f.controller.getDownload(),null);
  assert.deepEqual(f.controller.snapshot(),{phase:'EXPIRED',hasCredentials:false,hasChallenge:false,hasProposal:false});
});
test('reset and account change clear a completed proposal without reusing previous credentials',async()=>{
  const h=fixture();await h.complete();h.controller.reset('A conta mudou.');assert.equal(h.controller.getDownload(),null);
  assert.equal(h.controller.snapshot().hasProposal,false);assert.equal(h.calls.length,2);
  h.controller.start();assert.equal(h.controller.snapshot().hasCredentials,false);assert.equal(h.controller.snapshot().phase,'ENTRY');
});
test('private or financial output is rejected and never included in user-facing state',async()=>{
  for(const patch of [{financialGo:true},{approvalCreated:true},{premiumGranted:true},{secret:'PRIVATE_DETAIL'},
    {canonicalBuyerVerified:false},{proposal:{...previewProof(NOW).proposal,private:'PRIVATE_DETAIL'}}]){
    let count=0;const h=fixture({fetchImpl:async()=>response(++count===1?previewChallenge(NOW):{...previewProof(NOW),...patch})});
    await h.complete();assert.equal(h.controller.snapshot().phase,'FAILED');assert.equal(h.controller.getDownload(),null);
    assert.equal(JSON.stringify(h.states).includes('PRIVATE_DETAIL'),false);
  }
});
test('oversized and wrong media responses fail closed without a proposal',async()=>{
  for(const r of [new Response('x'.repeat(8193),{headers:{'content-type':'application/json'}}),
    new Response('{}',{headers:{'content-type':'text/plain'}}),new Response('{broken',{headers:{'content-type':'application/json'}})]){
    const h=fixture({fetchImpl:async()=>r});h.controller.start();await h.credential('ENTRY');assert.equal(h.controller.getDownload(),null);
    assert.equal(h.controller.snapshot().phase,'FAILED');
  }
});
test('scope file may be downloaded repeatedly only within validity; no new request is issued',async()=>{
  const h=fixture();await h.complete();assert.deepEqual(h.controller.getDownload(),h.controller.getDownload());assert.equal(h.calls.length,2);
});
test('restricted page has exact CSP, privacy notice, accessible status and only explicit JSON download',()=>{
  const html=readFileSync('app/pilot-pix/index.html','utf8'),js=readFileSync('app/pilot-pix/preview.mjs','utf8');
  assert.match(html,/Content-Security-Policy/);assert.match(html,/noindex,nofollow,noarchive/);assert.match(html,/aria-live="polite"/);
  assert.match(html,/Nenhuma cobrança/);assert.match(html,/30 minutos/);assert.match(html,/Sem renovação automática/);
  assert.match(html,/previa-piloto-pix/);assert.match(js,/URL\.createObjectURL/);assert.match(js,/URL\.revokeObjectURL/);
  assert.equal(/localStorage|sessionStorage|document\.cookie|atob\(|console\./.test(js),false);
  assert.equal(/\/auth\/google|\/payments\/commercial|action:'ISSUE'|action:'INSTALL'/.test(js),false);
  assert.equal(/app\.js|analytics|tagmanager/.test(html),false);
  assert.match(js,/pagehide/);assert.match(js,/visibilitychange/);assert.match(js,/escudofit:accountChanged/);
  assert.match(readFileSync('privacy.html','utf8'),/id="previa-piloto-pix"/);
});
test('service worker never caches or provides product fallback for preview routes and assets',()=>{
  const handlers={};let interceptions=0;
  vm.runInNewContext(readFileSync('app/sw.js','utf8'),{URL,self:{location:{origin:'https://escudofit.com.br',href:'https://escudofit.com.br/app/sw.js'},
    addEventListener:(key,fn)=>{handlers[key]=fn;}}});
  for(const path of ['/app/pilot-pix/','/app/pilot-pix/preview.mjs?v=proposal-preview-v1','/app/pilot-pix/preview.css'])
    handlers.fetch({request:{method:'GET',url:'https://escudofit.com.br'+path},respondWith(){interceptions++;}});
  assert.equal(interceptions,0);
});
