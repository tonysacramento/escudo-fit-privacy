import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MAX_IDLE_MS,expired}=require('../app/session-idle-policy.js');
test('sixty minutes without user interaction expires the Web session',()=>{
  const now=Date.UTC(2026,9,9,19,0);
  assert.equal(MAX_IDLE_MS,3_600_000);
  assert.equal(expired(now-MAX_IDLE_MS+1,now),false);
  assert.equal(expired(now-MAX_IDLE_MS,now),true);
  assert.equal(expired(now-MAX_IDLE_MS*2,now),true);
});
test('legacy missing activity key does not immediately force a user off the page',()=>{
  assert.equal(expired(null,Date.now()),false);
  assert.equal(expired('not-a-number',Date.now()),false);
  assert.equal(expired(0,Date.now()),false);
});
