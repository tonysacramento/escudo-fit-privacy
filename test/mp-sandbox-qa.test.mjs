import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  QA_EMAIL, isSafeQaOrigin, sandboxPlanKey, makeSandboxOrderRequest,
  isSandboxOrder, extractGoogleIdentity, normalizeSandboxReference, sandboxOrderFeedback, isSandboxDemoEntitlement,
} from '../qa/mercadopago/qa.mjs';

const html = readFileSync('qa/mercadopago/index.html', 'utf8');
const src = readFileSync('qa/mercadopago/qa.mjs', 'utf8');
const css = readFileSync('qa/mercadopago/qa.css', 'utf8');
const requestKey = 'af19fce3-56e7-4522-af38-93c6ce12b793';
const baseOrder = {
  environment: 'sandbox', premiumActivated: false,
  planKey: 'monthly', commercialAmount: '4.99', chargedAmount: '50.00',
  orderId: 'EF-00000000-0000-4000-8000-000000000001',
  providerOrderId: 'ORD01HRYFWNYRE1MR1E60MW3X0T2P',
  status: 'PENDING',
};

test('QA always requests versioned assets after a status-display update', () => {
  assert.match(html, /src="\.\/qa\.mjs\?v=20261016-4"/);
  assert.match(html, /href="\.\/qa\.css\?v=20261016-4"/);
  assert.doesNotMatch(html, /src="\.\/qa\.mjs"/);
});

test('QA page is unlinked from public homepage, noindex and scoped to sandbox only', () => {
  const homepage = readFileSync('index.html', 'utf8');
  assert.doesNotMatch(homepage, /qa\/mercadopago/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /escudo-fit-payments-sandbox-835029473980\.us-central1\.run\.app/);
  assert.doesNotMatch(src, /escudo-fit-api-v38-[a-z0-9-]+\.run\.app/);
  assert.doesNotMatch(src, /\/api\/v38\/auth\/google/);
  assert.ok(existsSync('app/icon-approved-v43.png'));
  assert.match(html, /icon-approved-v43\.png/);
  assert.match(css, /\.plan/);
});

test('only expected origins are accepted for the Google test flow', () => {
  assert.equal(isSafeQaOrigin('https://escudofit.com.br'), true);
  assert.equal(isSafeQaOrigin('https://www.escudofit.com.br'), true);
  assert.equal(isSafeQaOrigin('https://tonysacramento.github.io'), true);
  assert.equal(isSafeQaOrigin('http://localhost:8000'), false);
  assert.equal(isSafeQaOrigin('https://attacker.example'), false);
  assert.equal(QA_EMAIL, 'escudofit@gmail.com');
  assert.match(src, /google\.accounts\.id\.initialize/);
});

test('sandbox checkout uses commercial plan references and unique idempotency keys only', () => {
  assert.deepEqual(makeSandboxOrderRequest('monthly', requestKey), {planKey:'monthly',requestKey});
  assert.deepEqual(makeSandboxOrderRequest('yearly', requestKey), {planKey:'yearly',requestKey});
  assert.throws(() => makeSandboxOrderRequest('VIP', requestKey), /INVALID_PLAN/);
  assert.throws(() => makeSandboxOrderRequest('monthly', 'duplicated'), /INVALID_REQUEST_KEY/);
  assert.equal(sandboxPlanKey('yearly'), 'yearly');
  assert.match(html, /R\$ 4,99/);
  assert.match(html, /R\$ 49,90/);
  assert.match(html, /R\$ 50,00/);
});

test('client refuses any response claiming real payment or Premium activation', () => {
  assert.equal(isSandboxOrder(baseOrder), true);
  assert.equal(isSandboxOrder({...baseOrder,commercialAmount:'49.90'}), false);
  assert.equal(isSandboxOrder({...baseOrder,chargedAmount:'4.99'}), false);
  assert.equal(isSandboxOrder({...baseOrder,premiumActivated:true}), false);
  assert.equal(isSandboxOrder({...baseOrder,environment:'production'}), false);
  assert.equal(isSandboxOrder({...baseOrder,orderId:'bad'}), false);
  assert.equal(isSandboxOrder({...baseOrder,providerOrderId:'123'}), false);
});

test('Google credential is client parsed only for UX, while backend verifies it', () => {
  const fake = payload => ['header',Buffer.from(JSON.stringify(payload)).toString('base64url'),'signature'].join('.');
  const identity = extractGoogleIdentity(fake({ email:'ESCUDOFIT@GMAIL.COM',email_verified:true,exp:1893456000 }));
  assert.deepEqual(identity,{ email:'escudofit@gmail.com',expiresMs:1893456000000 });
  assert.equal(extractGoogleIdentity('broken'),null);
  assert.equal(extractGoogleIdentity(fake({email:'escudofit@gmail.com',email_verified:false,exp:1893456000})),null);
  assert.match(src,/const token = session\.token/);
  assert.match(src,/Authorization': 'Bearer ' \+ token/);
  assert.doesNotMatch(src,/localStorage|sessionStorage|document\.cookie|console\.log|console\.error/);
});

test('no QR display, no call to entitlement grant, no real-world payments', () => {
  assert.doesNotMatch(html, /<img[^>]+(?:qr|qrcode)/i);
  assert.doesNotMatch(src, /qrCodeBase64|qrCode|ticketUrl/);
  assert.doesNotMatch(src, /premium\/activate|entitlement\/|access\/grant|\/auth\/refresh/);
  assert.match(src, /consent\.checked/);
  assert.match(src, /credentials: 'omit'/);
  assert.match(src, /redirect: 'error'/);
  assert.match(src, /referrerPolicy: 'no-referrer'/);
});

test('recovery accepts only canonical EF references, never Mercado Pago order IDs', () => {
  const existing = 'EF-54b455b2-7856-423f-b7ca-da1dc95fdc86';
  assert.equal(normalizeSandboxReference(existing), existing);
  assert.equal(normalizeSandboxReference(' ef-54B455B2-7856-423F-B7CA-DA1DC95FDC86 '), existing);
  assert.throws(() => normalizeSandboxReference('ORDTST01M519EVWYKRHHZA68YTK09EWV'), /PAYMENT_ORDER_ID_INVALID/);
  assert.throws(() => normalizeSandboxReference('EF-1234'), /PAYMENT_ORDER_ID_INVALID/);
  assert.throws(() => normalizeSandboxReference('../auth/google'), /PAYMENT_ORDER_ID_INVALID/);
  assert.throws(() => normalizeSandboxReference('EF-54b455b2-7856-423f-b7ca-da1dc95fdc86?any=1'), /PAYMENT_ORDER_ID_INVALID/);
  assert.throws(() => normalizeSandboxReference(''), /PAYMENT_ORDER_ID_INVALID/);
});

test('recovery UI is login-gated, read-only, and never saves ID tokens or orders in browser', () => {
  assert.match(html, /id="recoverReference"[^>]*disabled/);
  assert.match(html, /id="recoverOrder"[^>]*disabled/);
  assert.match(html, /Recuperar pedido existente/);
  assert.match(html, /não cria novo Pix/);
  assert.match(src, /recoverOrder\.disabled = busy \|\| !signed \|\| !validReference/);
  assert.match(src, /const requestedReference = normalizeSandboxReference\(recoverReference\.value\)/);
  assert.match(src, /apiFetch\('\/orders\/' \+ encodeURIComponent\(requestedReference\), 'GET'\)/);
  assert.match(src, /normalizeSandboxReference\(result\?\.orderId\) !== requestedReference/);
  assert.match(src, /showOrder\(result, 'recovered'\)/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(src, /premium\/activate|entitlement\/|access\/grant/);
  assert.match(css, /\.recovery-controls/);
});

test('status messages distinguish creation, read-only consultation, and recovery', () => {
  assert.equal(
    sandboxOrderFeedback(baseOrder, 'created'),
    'Pedido de teste criado. Status: PENDING. Nenhum valor real foi cobrado.',
  );
  assert.equal(
    sandboxOrderFeedback(baseOrder, 'checked'),
    'Consulta concluída. Status do pedido: PENDING. Nenhum novo Pix foi criado.',
  );
  assert.equal(
    sandboxOrderFeedback(baseOrder, 'recovered'),
    'Pedido anterior recuperado. Status: PENDING. Nenhum novo Pix foi criado.',
  );
  assert.match(sandboxOrderFeedback({...baseOrder,status:'PAID_VERIFIED_SANDBOX'},'checked'), /PAID_VERIFIED_SANDBOX/);
  assert.throws(() => sandboxOrderFeedback({...baseOrder,premiumActivated:true},'checked'), /SANDBOX_RESPONSE_INVALID/);
  assert.throws(() => sandboxOrderFeedback(baseOrder, 'unrecognized'), /SANDBOX_ACTION_INVALID/);
  assert.match(src, /showOrder\(result, 'checked'\)/);
  assert.match(src, /showOrder\(result, 'recovered'\)/);
  assert.match(src, /showOrder\(result, 'created'\)/);
  assert.doesNotMatch(src, /Pedido de simulação registrado/);
});

test('isolated Premium demo validates the order, forbids real plan changes and safely ignores invalid payloads', () => {
  const ref='EF-54b455b2-7856-423f-b7ca-da1dc95fdc86';
  const sample={
    environment:'sandbox',source:'MP_SANDBOX_ONLY',orderId:ref,planKey:'monthly',
    mode:'PREMIUM_DEMO',isActive:true,expiresAt:'2026-11-15T10:00:00.000Z',
    premiumActivated:false,realAccessChanged:false,
  };
  assert.equal(isSandboxDemoEntitlement(sample,ref),true);
  assert.equal(isSandboxDemoEntitlement({...sample,mode:'FREE_DEMO',isActive:false,expiresAt:null},ref),true);
  assert.equal(isSandboxDemoEntitlement({...sample,mode:'EXPIRED_DEMO',isActive:false},ref),true);
  for (const modified of [
    {premiumActivated:true},{realAccessChanged:true},{environment:'production'},
    {source:'LEGACY_ACCESS_CONTROL'},{orderId:'invalid'},{mode:'PREMIUM'},
    {mode:'PREMIUM_DEMO',isActive:false},{mode:'FREE_DEMO',isActive:true},
    {expiresAt:'invalid'},{planKey:'VIP'},
  ]) {
    assert.equal(isSandboxDemoEntitlement({...sample,...modified},ref),false);
  }
  assert.equal(isSandboxDemoEntitlement(sample,'EF-00000000-0000-4000-8000-000000000001'),false);
});

test('QA demonstration only makes authenticated read-only GETs and automatically refreshes on interval and focus', () => {
  assert.match(html,/id="demoMode"/);
  assert.match(html,/id="demoExpiry"/);
  assert.match(html,/id="demoRealAccess"/);
  assert.match(html,/somente sandbox/i);
  assert.match(html,/não altera/);
  assert.match(src,/function refreshCurrentOrderSilently/);
  assert.match(src,/function fetchDemoEntitlement/);
  assert.match(src,/\+ '\/demo-entitlement', 'GET'/);
  assert.match(src,/addEventListener\('focus'/);
  assert.match(src,/addEventListener\('visibilitychange'/);
  assert.match(src,/refreshCurrentOrderSilently\(\); \}, 15_000\)/);
  assert.match(src,/backgroundRefreshBusy/);
  assert.doesNotMatch(src,/apiFetch\([^\n]*demo-entitlement[^\n]*'POST'/);
  assert.doesNotMatch(src,/localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(src,/premium\/activate|access\/grant/);
});
