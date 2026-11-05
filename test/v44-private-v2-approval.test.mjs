import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V2_API,CHALLENGE_PATH,APPROVE_PATH,validateV2Challenge,validateV2Approval,
  createV2ApprovalController,v2Request,looksLikeGoogleIdToken
} from '../app/comprar/v2/approval.mjs';

const NOW=1793916000000;
const goodId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const goodChallenge={
  state:'V2_GOOGLE_CHALLENGE',challengeId:goodId,
  buyerNonce:'ef-v2-buyer-'+'B'.repeat(43),
  operatorNonce:'ef-v2-operator-'+'O'.repeat(43),
  expiresAtMs:NOW+120000
};
const receipt={state:'APPROVED_V2_SINGLE_PILOT',
  approvalId:'dfda7ddd-b458-4588-9235-14f44b5a5c76',
  ordersCreated:0,premiumGranted:false};
const token='aaa.bbb.ccc';

test('challenge accepts only exact scoped nonce response and a short live window',()=>{
  assert.equal(validateV2Challenge(goodChallenge,NOW).challengeId,goodId);
  for(const item of [
    {...goodChallenge,state:'OK'}, {...goodChallenge,challengeId:'bad'},
    {...goodChallenge,expiresAtMs:NOW+300001},
    {...goodChallenge,expiresAtMs:NOW},
    {...goodChallenge,buyerNonce:goodChallenge.operatorNonce},
    {...goodChallenge,operatorNonce:'ef-v2-buyer-'+'X'.repeat(43)}
  ])assert.throws(()=>validateV2Challenge(item,NOW));
});
test('approval response cannot imply an order or Premium activation',()=>{
  assert.equal(validateV2Approval(receipt).ordersCreated,0);
  for(const patch of [
    {ordersCreated:1},{premiumGranted:true},{approvalId:'bad'},{state:'PAID'}
  ])assert.throws(()=>validateV2Approval({...receipt,...patch}));
});

test('operator, operator nonce and buyer nonce are three distinct explicit steps; one approval call',async()=>{
  const calls=[],events=[];
  const ctrl=createV2ApprovalController({
    now:()=>NOW,
    request:async(path,headers)=>{calls.push({path,headers});return path===CHALLENGE_PATH?goodChallenge:receipt;},
    onState:(s,message)=>events.push([s.phase,message])
  });
  assert.equal(ctrl.snapshot().phase,'OPERATOR_INITIAL');
  assert.equal(await ctrl.approve(true),false);
  assert.equal(await ctrl.beginChallenge(token),true);
  assert.equal(ctrl.snapshot().phase,'OPERATOR_NONCE');
  assert.equal(ctrl.nonceForGoogle(),goodChallenge.operatorNonce);
  assert.equal(ctrl.acceptNonceCredential('buyer',token),false);
  assert.equal(ctrl.acceptNonceCredential('operator',token),true);
  assert.equal(ctrl.snapshot().phase,'BUYER_NONCE');
  assert.equal(ctrl.nonceForGoogle(),goodChallenge.buyerNonce);
  assert.equal(ctrl.acceptNonceCredential('buyer',token),true);
  assert.equal(ctrl.snapshot().phase,'READY');
  assert.equal(await ctrl.approve(false),false);
  assert.equal(await ctrl.approve(true),true);
  assert.equal(ctrl.snapshot().phase,'APPROVED');
  assert.equal(ctrl.snapshot().approvalId,receipt.approvalId);
  assert.equal(await ctrl.approve(true),false);
  assert.equal(ctrl.reset(),false);
  assert.deepEqual(calls.map(x=>x.path),[CHALLENGE_PATH,APPROVE_PATH]);
  assert.equal(calls[0].headers.authorization,'Bearer '+token);
  assert.deepEqual(Object.keys(calls[0].headers),['authorization']);
  assert.deepEqual(Object.keys(calls[1].headers).sort(),
    ['authorization','x-escudo-buyer-authorization','x-escudo-challenge-id'].sort());
  assert.equal(calls[1].headers['x-escudo-challenge-id'],goodId);
  assert(!JSON.stringify(ctrl.snapshot()).includes(token));
  assert(!events.some(([p])=>p==='OUTCOME_UNCERTAIN'));
});

test('lost signed approval response becomes terminal; never retry POST',async()=>{
  const calls=[];
  const ctrl=createV2ApprovalController({now:()=>NOW,
    request:async path=>{calls.push(path);if(path===CHALLENGE_PATH)return goodChallenge;throw Error('CONNECTION_LOST');}
  });
  assert.equal(await ctrl.beginChallenge(token),true);
  assert(ctrl.acceptNonceCredential('operator',token));
  assert(ctrl.acceptNonceCredential('buyer',token));
  assert.equal(await ctrl.approve(true),false);
  assert.equal(ctrl.snapshot().phase,'UNKNOWN');
  assert.equal(await ctrl.approve(true),false);
  assert.equal(ctrl.reset(),false);
  assert.equal(calls.filter(x=>x===APPROVE_PATH).length,1);
});

test('expired nonce prevents signed approval and erases in-memory tokens',async()=>{
  let now=NOW;
  const calls=[];
  const ctrl=createV2ApprovalController({
    now:()=>now,
    request:async path=>{calls.push(path);return path===CHALLENGE_PATH?goodChallenge:receipt;}
  });
  await ctrl.beginChallenge(token);
  ctrl.acceptNonceCredential('operator',token);
  now=NOW+120001;
  assert.equal(ctrl.acceptNonceCredential('buyer',token),false);
  assert.equal(ctrl.snapshot().phase,'EXPIRED');
  assert.equal(await ctrl.approve(true),false);
  assert.equal(calls.length,1);
  assert(ctrl.reset());
  assert.equal(ctrl.snapshot().phase,'OPERATOR_INITIAL');
});

test('malformed challenge never proceeds to a nonce or KMS request',async()=>{
  const ctrl=createV2ApprovalController({now:()=>NOW,
    request:async()=>({...goodChallenge,operatorNonce:'BAD'})});
  assert.equal(await ctrl.beginChallenge(token),false);
  assert.equal(ctrl.snapshot().phase,'ERROR');
  assert.equal(ctrl.acceptNonceCredential('operator',token),false);
  assert.equal(await ctrl.approve(true),false);
});

test('transport enforces POST with no body, no cookie and rejects arbitrary paths',async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts});
    return {ok:true,headers:{get:()=> 'application/json; charset=utf-8'},
      text:async()=>JSON.stringify(goodChallenge)};
  };
  const reply=await v2Request(CHALLENGE_PATH,{authorization:'Bearer '+token},{fetchImpl});
  assert.equal(reply.challengeId,goodId);
  assert.equal(calls[0].url,V2_API+CHALLENGE_PATH);
  assert.equal(calls[0].opts.method,'POST');
  assert.equal(calls[0].opts.credentials,'omit');
  assert.equal(calls[0].opts.cache,'no-store');
  assert.equal(calls[0].opts.redirect,'error');
  assert.equal(calls[0].opts.referrerPolicy,'no-referrer');
  assert.equal('body' in calls[0].opts,false);
  assert.equal('content-type' in calls[0].opts.headers,false);
  await assert.rejects(()=>v2Request('https://host.invalid',{authorization:'Bearer '+token},{fetchImpl}));
  assert.equal(calls.length,1);
  assert(looksLikeGoogleIdToken(token));
  assert(!looksLikeGoogleIdToken('bad jwt'));
});
