import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const home=readFileSync('index.html','utf8');
const app=readFileSync('app/index.html','utf8');

test('public homepage is a real brand landing, not an automatic redirect into the PWA',()=>{
  assert.match(home,/<html lang="pt-BR">/);
  assert.match(home,/<h1 id="hero-title">/);
  assert.doesNotMatch(home,/<meta http-equiv="refresh"/);
  assert.doesNotMatch(home,/location\.replace\(/);
  assert.match(home,/Escudo Fit/);
});

test('published home uses original approved app logo and working legal routes',()=>{
  assert.match(home,/\.\/app\/icon-approved-v43\.png/);
  assert.ok(existsSync('app/icon-approved-v43.png'));
  for(const page of ['privacy.html','terms.html','support.html']){
    assert.match(home,new RegExp('\\./'+page.replace('.','\\.')+'["]'));
    assert.ok(existsSync(page));
  }
});

test('homepage keeps app and Android access, without changing the PWA',()=>{
  assert.match(home,/href="\.\/app\/"/);
  assert.match(home,/href="\.\/app\/#trialSection"/);
  assert.match(home,/play\.google\.com\/store\/apps\/details\?id=com\.escudofit\.app/);
  assert.match(app,/id="appExperience"/);
  assert.match(app,/id="webAccessGate"/);
});

test('website prices are only displayed; no unsupported checkout or health claim is present',()=>{
  assert.match(home,/R\$ 4,99/);
  assert.match(app,/R\$ 4,99/);
  assert.match(home,/R\$ 49,90/);
  assert.match(app,/R\$ 49,90/);
  assert.doesNotMatch(home,/R\$ (?:2,90|29,90)/);
  assert.doesNotMatch(app,/R\$ (?:2,90|29,90)/);
  assert.match(home,/contratação depende da disponibilidade dos meios de pagamento/);
  assert.doesNotMatch(home,/(?:href|action)="https?:\/\/(?:www\.)?abacatepay\.com/);
  assert.match(home,/não substitui orientação médica/i);
});
