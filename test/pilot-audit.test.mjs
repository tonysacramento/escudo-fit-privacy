import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPilotAuditController,AUDIT_API } from '../app/pilot-audit/audit.mjs';

const NOW=1792411200000,purpose='ESCUDO_FIT_NONFINANCIAL_IDENTITY_V1';
const challenge=()=>({state:'CHALLENGE',purpose,challengeId:'a'.repeat(43),buyerNonce:'ef-audit-buyer-v1-'+'b'.repeat(43),
  operatorNonce:'ef-audit-operator-v1-'+'c'.repeat(43),expiresAtMs:NOW+299000,
  financialGo:false,orderCreated:false,premiumGranted:false});
const proof=()=>({state:'PASS_NONFINANCIAL_IDENTITIES',purpose,buyerEmailHash:'a'.repeat(64),
  operatorSubjectHash:'b'.repeat(64),buyerSubjectHash:'c'.repeat(64),googleSignaturesVerified:true,
  noncesVerified:true,identitiesDistinct:true,freshIdentitiesVerified:true,challengeConsumed:true,
  financialGo:false,orderCreated:false,premiumGranted:false});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(options={}){
  const calls=[],renders=[],states=[],timers=new Map();let next=0,now=NOW;
  const controller=createPilotAuditController({now:()=>now,entryNonce:()=> 'synthetic-entry-nonce',
    renderGoogle:options=>renders.push(options),onState:s=>states.push(s),
    schedule:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),
    fetchImpl:async(url,options)=>{calls.push({url,options});return response(calls.length===1?challenge():proof());},...options});
  const credential=(role,token='synthetic.'+role+'.signature')=>renders.findLast(x=>x.role===role).callback({credential:token});
  return {controller,calls,renders,states,timers,credential,setNow:value=>{now=value;}};
}

test('no requests before explicit start; three normal callbacks use role-specific nonces and fixed destination',async()=>{
  const h=fixture();assert.equal(h.calls.length,0);h.controller.start();
  assert.equal(h.renders[0].role,'ENTRY');assert.equal(h.renders[0].nonce,'synthetic-entry-nonce');
  await h.credential('ENTRY');assert.equal(h.renders[1].nonce,challenge().buyerNonce);
  await h.credential('BUYER');assert.equal(h.renders[2].nonce,challenge().operatorNonce);
  await h.credential('OPERATOR');assert.equal(h.controller.snapshot().phase,'PASSED');
  assert.deepEqual(h.controller.snapshot(),{phase:'PASSED',hasCredentials:false,hasChallenge:false});
  assert.equal(h.timers.size,0);assert.equal(h.calls.length,2);
  for(const c of h.calls){assert.equal(c.url,AUDIT_API);assert.equal(c.options.credentials,'omit');
    assert.equal(c.options.redirect,'error');assert.equal(c.options.cache,'no-store');
    assert.equal(c.options.headers.authorization,'Bearer synthetic.ENTRY.signature');}
  const input=JSON.parse(h.calls[1].options.body);
  assert.deepEqual(Object.keys(input).sort(),['action','buyerIdToken','challengeId','operatorIdToken'].sort());
  assert.equal(input.action,'VERIFY');assert.equal(input.buyerIdToken,'synthetic.BUYER.signature');
  assert.equal(JSON.stringify(h.states).includes('signature'),false);
});

test('malformed credentials and OFF server fail safely, clear memory and never retry',async()=>{
  const invalid=fixture();invalid.controller.start();await invalid.credential('ENTRY','not-a-token');
  assert.equal(invalid.calls.length,0);assert.equal(invalid.controller.snapshot().phase,'FAILED');
  let count=0;const off=fixture({fetchImpl:async()=>{count++;return new Response('{"state":"DISABLED"}',{status:503});}});
  off.controller.start();await off.credential('ENTRY');assert.equal(count,1);
  assert.equal(off.controller.snapshot().hasCredentials,false);assert.equal(off.controller.snapshot().phase,'FAILED');
});

test('cancel and a new flow discard old Google callbacks and late challenge responses',async()=>{
  let release;const h=fixture({fetchImpl:()=>new Promise(r=>{release=r;})});h.controller.start();
  const old=h.renders[0].callback,pending=h.credential('ENTRY');h.controller.reset();release(response(challenge()));await pending;
  assert.equal(h.controller.snapshot().phase,'READY');assert.equal(h.controller.snapshot().hasCredentials,false);
  h.controller.start();assert.equal(await old({credential:'synthetic.old.signature'}),false);
  assert.equal(h.controller.snapshot().phase,'ENTRY');
});

test('cancel during final submission discards a late success and clears both credentials',async()=>{
  let count=0,release;const h=fixture({fetchImpl:async()=>++count===1?response(challenge()):new Promise(r=>{release=r;})});
  h.controller.start();await h.credential('ENTRY');await h.credential('BUYER');
  const pending=h.credential('OPERATOR');h.controller.reset();release(response(proof()));await pending;
  assert.deepEqual(h.controller.snapshot(),{phase:'READY',hasCredentials:false,hasChallenge:false});
  assert.equal(h.states.some(x=>x.phase==='PASSED'),false);assert.equal(count,2);
});

test('expiry, account reset and duplicate callbacks fail closed without an extra request',async()=>{
  const h=fixture();h.controller.start();const entry=h.renders[0].callback;
  await h.credential('ENTRY');assert.equal(await entry({credential:'synthetic.old.signature'}),false);
  h.setNow(NOW+300001);h.controller.checkExpiry();
  assert.equal(h.controller.snapshot().phase,'EXPIRED');assert.equal(h.controller.snapshot().hasCredentials,false);
  assert.equal(await h.credential('BUYER'),false);assert.equal(h.calls.length,1);
  h.controller.reset('A conta mudou.');assert.equal(h.controller.snapshot().phase,'READY');
});

test('uncertain, oversized, malformed, private or financial upstream output cannot show success',async()=>{
  for(const bad of [{...challenge(),paymentConfirmed:true},{...challenge(),expiresAtMs:NOW-1},
    {...challenge(),financialGo:true},{state:'DISABLED'}, {token:'PRIVATE_DETAIL'}]){
    const h=fixture({fetchImpl:async()=>response(bad)});h.controller.start();await h.credential('ENTRY');
    assert.equal(h.controller.snapshot().phase,'FAILED');assert.equal(JSON.stringify(h.states).includes('PRIVATE_DETAIL'),false);
  }
  for(const bad of [new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}),
    new Response('broken',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/plain'}})]){
    const h=fixture({fetchImpl:async()=>bad});h.controller.start();await h.credential('ENTRY');
    assert.equal(h.controller.snapshot().phase,'FAILED');
  }
  const h=fixture({fetchImpl:async(_url,o)=>JSON.parse(o.body).action==='CHALLENGE'?response(challenge()):response({...proof(),premiumGranted:true})});
  h.controller.start();await h.credential('ENTRY');await h.credential('BUYER');await h.credential('OPERATOR');
  assert.equal(h.controller.snapshot().phase,'FAILED');
});

test('audit page has restrictive policy, accessible status, no product scripts/storage/analytics/payment route',()=>{
  const html=readFileSync('app/pilot-audit/index.html','utf8'),js=readFileSync('app/pilot-audit/audit.mjs','utf8');
  assert.match(html,/Content-Security-Policy/);assert.match(html,/noindex,nofollow,noarchive/);
  assert.match(html,/aria-live="polite"/);assert.match(html,/não gera cobrança/);
  assert.equal(/app\.js|payment-checkout|analytics|tagmanager/.test(html),false);
  assert.equal(/localStorage|sessionStorage|document\.cookie|atob\(|console\./.test(js),false);
  assert.equal(/\/auth\/google|\/payments\/commercial|ISSUE|INSPECT/.test(js),false);
  assert.match(js,/pagehide/);assert.match(js,/visibilitychange/);assert.match(js,/escudofit:accountChanged/);
  const policy=readFileSync('privacy.html','utf8');assert.match(policy,/id="auditoria-piloto"/);
  assert.match(policy,/Registros técnicos de hospedagem/);
});

test('service worker leaves audit pages and assets to the network without cache or product fallback',()=>{
  const handlers={};let intercepted=0;
  const sandbox={self:{location:{origin:'https://escudofit.com.br',href:'https://escudofit.com.br/app/sw.js'},
    addEventListener:(name,fn)=>{handlers[name]=fn;}},URL};
  vm.runInNewContext(readFileSync('app/sw.js','utf8'),sandbox);
  for(const path of ['/app/pilot-audit/','/app/pilot-audit/audit.mjs?v=identity-v1','/app/pilot-audit/audit.css'])
    handlers.fetch({request:{method:'GET',url:'https://escudofit.com.br'+path},respondWith(){intercepted++;}});
  assert.equal(intercepted,0);
});
