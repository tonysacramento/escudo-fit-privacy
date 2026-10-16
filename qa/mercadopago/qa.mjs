// Escudo Fit — technical PIX sandbox only. NO credentials in source or storage.
// Every payment operation is authenticated independently by Google on the backend.
const API = 'https://escudo-fit-payments-sandbox-835029473980.us-central1.run.app/api/v38/payments/sandbox';
const GOOGLE_CLIENT_ID = '835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const QA_EMAIL = 'escudofit@gmail.com';
const TRUSTED_ORIGINS = new Set([
  'https://escudofit.com.br',
  'https://www.escudofit.com.br',
  'https://tonysacramento.github.io',
]);
const PLAN_PRICES = Object.freeze({ monthly: '4.99', yearly: '49.90' });
const MAX_SESSION_MS = 10 * 60_000;

export function isSafeQaOrigin(origin) {
  return TRUSTED_ORIGINS.has(origin);
}
export function sandboxPlanKey(plan) {
  if (!Object.hasOwn(PLAN_PRICES, plan)) throw new Error('INVALID_PLAN');
  return plan;
}
// The reference is not a credential: the backend checks the signed Google
// identity and ownership of the existing Firestore order before returning it.
export function normalizeSandboxReference(value) {
  const ref = String(value ?? '').trim();
  const match = /^EF-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref);
  if (!match) throw new Error('PAYMENT_ORDER_ID_INVALID');
  return 'EF-' + match[1].toLowerCase();
}
export function makeSandboxOrderRequest(plan, requestKey) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new Error('INVALID_REQUEST_KEY');
  }
  return { planKey: sandboxPlanKey(plan), requestKey };
}
export function isSandboxOrder(data) {
  return Boolean(
    data && data.environment === 'sandbox' && data.premiumActivated === false &&
    data.chargedAmount === '50.00' &&
    Object.hasOwn(PLAN_PRICES, data.planKey) &&
    data.commercialAmount === PLAN_PRICES[data.planKey] &&
    /^EF-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(data.orderId || '')) &&
    (data.providerOrderId == null || /^ORD[A-Z0-9]{12,60}$/i.test(String(data.providerOrderId)))
  );
}
// This response can never be treated as a real subscription or entitlement.
export function isSandboxDemoEntitlement(data, expectedOrderId) {
  if (!data || data.environment !== 'sandbox' || data.source !== 'MP_SANDBOX_ONLY' ||
      data.premiumActivated !== false || data.realAccessChanged !== false ||
      normalizeSandboxReference(data.orderId) !== expectedOrderId ||
      !Object.hasOwn(PLAN_PRICES, data.planKey) ||
      !['FREE_DEMO','PREMIUM_DEMO','EXPIRED_DEMO'].includes(data.mode) ||
      typeof data.isActive !== 'boolean' ||
      data.isActive !== (data.mode === 'PREMIUM_DEMO')) return false;
  if (data.mode === 'FREE_DEMO') return data.expiresAt === null;
  return typeof data.expiresAt === 'string' && !Number.isNaN(Date.parse(data.expiresAt));
}

// Differentiate creation from a read-only GET; never claim payment approval.
export function sandboxOrderFeedback(data, action) {
  if (!isSandboxOrder(data)) throw new Error('SANDBOX_RESPONSE_INVALID');
  const status = String(data.status || 'NÃO INFORMADO').slice(0, 80);
  if (action === 'created') {
    return `Pedido de teste criado. Status: ${status}. Nenhum valor real foi cobrado.`;
  }
  if (action === 'recovered') {
    return `Pedido anterior recuperado. Status: ${status}. Nenhum novo Pix foi criado.`;
  }
  if (action === 'checked') {
    return `Consulta concluída. Status do pedido: ${status}. Nenhum novo Pix foi criado.`;
  }
  throw new Error('SANDBOX_ACTION_INVALID');
}
export function extractGoogleIdentity(idToken) {
  if (typeof idToken !== 'string') return null;
  const p = idToken.split('.');
  if (p.length !== 3) return null;
  try {
    const decoded = JSON.parse(atob(p[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (decoded.email_verified !== true || !Number.isFinite(Number(decoded.exp))) return null;
    return { email: String(decoded.email || '').trim().toLowerCase(), expiresMs: Number(decoded.exp) * 1000 };
  } catch { return null; }
}
// Only for display/early UX filtering; the SERVER verifies Google's signature, audience and allowlist.

if (typeof document !== 'undefined') {
  const el = id => document.getElementById(id);
  const googleSlot = el('googleButton');
  const signout = el('signout');
  const loginState = el('loginState');
  const orderState = el('orderState');
  const planChoice = el('planChoice');
  const consent = el('confirmSimulation');
  const createOrder = el('createOrder');
  const checkOrder = el('checkOrder');
  const newOrder = el('newOrder');
  const recoverReference = el('recoverReference');
  const recoverOrder = el('recoverOrder');
  let session = null; // Google ID token only in volatile memory. Never log or persist.
  let requestKey = null;
  let selectedPlan = null;
  let orderId = null;
  let busy = false;
  let googleInitialized = false;
  let backgroundRefreshBusy = false;

  function setStatus(node, message, kind = '') {
    node.textContent = message;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }
  function validSession() {
    if (!session) return false;
    const valid = session.expiresMs > Date.now() + 60_000 && session.sinceMs + MAX_SESSION_MS > Date.now();
    if (!valid) clearSession('A sessão de teste expirou. Entre novamente com o Google.');
    return valid;
  }
  function controls() {
    const signed = validSession();
    signout.hidden = !signed;
    googleSlot.hidden = signed;
    planChoice.disabled = busy || !signed || Boolean(orderId || requestKey);
    consent.disabled = busy || !signed || Boolean(orderId || requestKey);
    createOrder.disabled = busy || !signed || Boolean(orderId) || (!requestKey && !consent.checked);
    checkOrder.disabled = busy || !signed || !orderId;
    newOrder.disabled = busy || !signed || !(orderId || requestKey);
    recoverReference.disabled = busy || !signed;
    let validReference = false;
    try { normalizeSandboxReference(recoverReference.value); validReference = true; } catch {}
    recoverOrder.disabled = busy || !signed || !validReference;
  }
  function resetView() {
    el('internalId').textContent = '—';
    el('providerId').textContent = '—';
    el('paymentStatus').textContent = 'Aguardando';
    el('environment').textContent = 'sandbox';
    el('premium').textContent = 'Não — bloqueado no QA';
    el('demoMode').textContent = 'Aguardando pedido';
    el('demoExpiry').textContent = '—';
    el('demoRealAccess').textContent = 'Não alterado';
    setStatus(el('demoState'), 'Recupere o pedido para verificar o acesso de demonstração.');
  }
  function clearSession(message) {
    session = null;
    requestKey = null;
    selectedPlan = null;
    orderId = null;
    consent.checked = false;
    resetView();
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch {}
    setStatus(loginState, message);
    setStatus(orderState, 'Entre novamente para criar ou consultar um cenário.');
    // Avoid recursion: controls() calls validSession().
    signout.hidden = true;
    googleSlot.hidden = false;
    planChoice.disabled = true;
    consent.disabled = true;
    createOrder.disabled = true;
    checkOrder.disabled = true;
    newOrder.disabled = true;
    recoverReference.disabled = true;
    recoverOrder.disabled = true;
  }
  function showOrder(data, action) {
    if (!isSandboxOrder(data)) throw new Error('SANDBOX_RESPONSE_INVALID');
    orderId = data.orderId;
    // Keep only a non-secret reference in the visible field; never store IDs or tokens.
    recoverReference.value = data.orderId;
    const planInput = document.querySelector('input[name="plan"][value="' + data.planKey + '"]');
    if (planInput) planInput.checked = true;
    el('internalId').textContent = data.orderId;
    el('providerId').textContent = data.providerOrderId || 'Aguardando provedor';
    el('paymentStatus').textContent = String(data.status || 'Não informado').slice(0, 100);
    el('environment').textContent = 'sandbox — R$ 50,00 fictícios';
    el('premium').textContent = 'Não — acesso Premium não é liberado em testes';
    setStatus(orderState, sandboxOrderFeedback(data, action), 'success');
  }
  function showDemoEntitlement(data, reference) {
    if (!isSandboxDemoEntitlement(data, reference)) throw new Error('SANDBOX_DEMO_RESPONSE_INVALID');
    el('demoMode').textContent = data.mode;
    el('demoExpiry').textContent = data.expiresAt
      ? new Date(data.expiresAt).toLocaleString('pt-BR') : '—';
    el('demoRealAccess').textContent = 'Não alterado — Premium de teste apenas';
    const detail = data.isActive
      ? 'PREMIUM_DEMO ativo somente nesta demonstração. O plano real permanece igual.'
      : 'Nenhuma ativação fictícia vigente. O plano real permanece igual.';
    setStatus(el('demoState'), detail, data.isActive ? 'success' : '');
  }
  async function fetchDemoEntitlement(reference) {
    try {
      const data = await apiFetch('/orders/' + encodeURIComponent(reference) + '/demo-entitlement', 'GET');
      if (orderId === reference && validSession()) showDemoEntitlement(data, reference);
    } catch {
      if (orderId === reference && validSession()) {
        setStatus(el('demoState'), 'Consulta de demonstração indisponível. Nenhum plano real foi alterado.', 'error');
      }
    }
  }
  async function refreshCurrentOrderSilently() {
    if (busy || backgroundRefreshBusy || !orderId || document.visibilityState === 'hidden' || !validSession()) return;
    const reference = orderId;
    backgroundRefreshBusy = true;
    try {
      const result = await apiFetch('/orders/' + encodeURIComponent(reference), 'GET');
      if (orderId !== reference || !validSession() || result.orderId !== reference || !isSandboxOrder(result)) return;
      if (el('paymentStatus').textContent !== result.status) showOrder(result, 'checked');
      await fetchDemoEntitlement(reference);
    } catch {
      if (orderId === reference && validSession()) {
        setStatus(el('demoState'), 'Falha temporária na atualização automática. Tentaremos novamente.', 'error');
      }
    } finally { backgroundRefreshBusy = false; }
  }
  function readableError(err) {
    const code = String(err?.code || err?.message || 'UNEXPECTED_ERROR');
    const safeCode = /^[A-Z][A-Z0-9_]{2,70}$/.test(code) ? code : 'NETWORK_OR_VALIDATION_ERROR';
    const map = {
      AUTH_REQUIRED: 'É necessário autenticar novamente com o Google.',
      AUTH_GOOGLE_TOKEN_INVALID: 'Credencial Google inválida ou expirada. Entre novamente.',
      PAYMENT_TESTER_NOT_ALLOWED: 'Esta conta Google não está autorizada no sandbox.',
      PAYMENT_SANDBOX_DISABLED: 'O sandbox está temporariamente desativado.',
      MP_SANDBOX_ORDER_REJECTED: 'O Mercado Pago não aceitou o pedido de simulação.',
      MP_TEST_SECRET_MISSING: 'Token de testes indisponível no servidor.',
      SANDBOX_RESPONSE_INVALID: 'A resposta não corresponde a um pedido seguro do sandbox.',
      PAYMENT_ORDER_ID_INVALID: 'Informe uma referência EF- válida do pedido existente.',
      PAYMENT_ORDER_NOT_FOUND: 'Pedido não encontrado para esta Conta Google de testes. Confira a referência EF-.',
      HTTP_404: 'Pedido não localizado ou não pertencente à conta conectada.',
    };
    return map[safeCode] || ('Não foi possível concluir a operação de testes (' + safeCode + ').');
  }
  async function apiFetch(path, method, body) {
    if (!validSession()) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    const token = session.token;
    const signal = AbortSignal.timeout(20_000);
    const response = await fetch(API + path, {
      method, signal, mode: 'cors', cache: 'no-store', credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Error code only; do not print provider payloads, tokens or responses to console.
      const code = typeof data.code === 'string' && /^[A-Z][A-Z0-9_]{2,70}$/.test(data.code)
        ? data.code : 'HTTP_' + response.status;
      throw Object.assign(new Error(code), { code });
    }
    return data;
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    controls();
    try { await fn(); }
    catch (error) { setStatus(orderState, readableError(error), 'error'); }
    finally { busy = false; controls(); }
  }
  function googleCallback(result) {
    const credential = typeof result?.credential === 'string' ? result.credential : '';
    const identity = extractGoogleIdentity(credential);
    if (!identity || identity.expiresMs <= Date.now() + 60_000) {
      clearSession('O Google não forneceu uma credencial válida. Tente novamente.');
      return;
    }
    if (identity.email !== QA_EMAIL) {
      clearSession('A conta selecionada não é a conta autorizada para QA. Escolha escudofit@gmail.com.');
      return;
    }
    session = { token: credential, expiresMs: identity.expiresMs, sinceMs: Date.now() };
    consent.checked = false;
    setStatus(loginState, 'Conta de teste selecionada: ' + identity.email + '. O backend verificará a assinatura Google ao enviar o pedido.', 'success');
    setStatus(orderState, 'Para consultar um pedido anterior, informe sua referência EF- no campo de recuperação. Não é preciso criar outro pedido.');
    controls();
  }
  function initializeGoogle() {
    if (googleInitialized || !window.google?.accounts?.id) return false;
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: googleCallback,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.renderButton(googleSlot, {
        type: 'standard', theme: 'outline', size: 'large',
        shape: 'pill', text: 'signin_with', width: 270,
      });
      googleInitialized = true;
      setStatus(loginState, 'Escolha escudofit@gmail.com no botão de login Google.');
      controls();
      return true;
    } catch {
      setStatus(loginState, 'Não foi possível iniciar o Google. Verifique a origem autorizada do domínio.', 'error');
      return false;
    }
  }

  if (!isSafeQaOrigin(window.location.origin)) {
    clearSession('Esta página só funciona no domínio oficial do Escudo Fit ou no domínio GitHub Pages autorizado.');
    setStatus(loginState, 'Origem não autorizada para login Google.', 'error');
  } else {
    let attempts = 0;
    const loader = setInterval(() => {
      attempts++;
      if (initializeGoogle() || attempts > 60) {
        clearInterval(loader);
        if (!googleInitialized) setStatus(loginState, 'Serviço Google indisponível. Recarregue a página e tente novamente.', 'error');
      }
    }, 250);
  }
  consent.addEventListener('change', controls);
  signout.addEventListener('click', () => clearSession('Sessão de QA encerrada. Nenhuma credencial foi armazenada.'));
  newOrder.addEventListener('click', () => {
    if (!validSession()) return;
    requestKey = null;
    selectedPlan = null;
    orderId = null;
    recoverReference.value = '';
    consent.checked = false;
    resetView();
    setStatus(orderState, 'Novo cenário preparado. Confirme novamente antes de criar o pedido.');
    controls();
  });
  createOrder.addEventListener('click', () => run(async () => {
    if (!validSession() || (!requestKey && !consent.checked)) throw new Error('AUTH_REQUIRED');
    if (!requestKey) {
      selectedPlan = sandboxPlanKey(document.querySelector('input[name="plan"]:checked')?.value);
      requestKey = crypto.randomUUID();
    }
    setStatus(orderState, 'Criando pedido somente no sandbox do Mercado Pago…');
    const result = await apiFetch('/orders', 'POST', makeSandboxOrderRequest(selectedPlan, requestKey));
    showOrder(result, 'created');
    await fetchDemoEntitlement(result.orderId);
  }));
  recoverReference.addEventListener('input', controls);
  recoverReference.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !recoverOrder.disabled) {
      event.preventDefault();
      recoverOrder.click();
    }
  });
  recoverOrder.addEventListener('click', () => run(async () => {
    if (!validSession()) throw new Error('AUTH_REQUIRED');
    const requestedReference = normalizeSandboxReference(recoverReference.value);
    setStatus(orderState, 'Consultando o pedido existente, sem criar outra cobrança…');
    // Authenticated GET only. The backend also verifies order ownership.
    const result = await apiFetch('/orders/' + encodeURIComponent(requestedReference), 'GET');
    if (normalizeSandboxReference(result?.orderId) !== requestedReference) {
      throw new Error('SANDBOX_RESPONSE_INVALID');
    }
    showOrder(result, 'recovered');
    await fetchDemoEntitlement(result.orderId);
  }));
  checkOrder.addEventListener('click', () => run(async () => {
    if (!orderId) return;
    setStatus(orderState, 'Consultando somente o pedido desta sessão de teste…');
    const result = await apiFetch('/orders/' + encodeURIComponent(orderId), 'GET');
    if (result.orderId !== orderId) throw new Error('SANDBOX_RESPONSE_INVALID');
    showOrder(result, 'checked');
    await fetchDemoEntitlement(result.orderId);
  }));
  // Drop short-lived credentials from memory on tab closure; do not persist.
  window.addEventListener('pagehide', () => { session = null; });
  // Background reads only. No payment creation, no entitlement writes or user interaction.
  window.addEventListener('focus', () => { void refreshCurrentOrderSilently(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshCurrentOrderSilently(); });
  setInterval(() => { void refreshCurrentOrderSilently(); }, 15_000);
  setInterval(() => { if (session) controls(); }, 30_000);
}
