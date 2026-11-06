import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUYER_API,BUYER_RELAY} from '../app/comprar/v2/buyer.mjs';
import {V2_API} from '../app/comprar/v2/approval.mjs';

test('private buyer and KMS approval use separate zero-traffic tags',()=>{
  assert.equal(BUYER_API,'https://v2buyer---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app');
  assert.equal(V2_API,'https://v2approval---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app');
  assert.notEqual(BUYER_API,V2_API);
  assert.equal(BUYER_RELAY,'/api/v38/private-pilot-v2');
  const html=readFileSync(new URL('../app/comprar/v2/buyer.html',import.meta.url),'utf8');
  assert.match(html,/connect-src https:\/\/v2buyer---escudo-fit-api-v38-olb3tmj35q-uc\.a\.run\.app/);
  assert.doesNotMatch(html,/v2approval---/);
  assert.match(html,/id="buy" disabled/);
});