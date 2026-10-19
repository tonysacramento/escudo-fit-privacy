import { test,expect } from '@playwright/test';
const base='http://127.0.0.1:4173/app/pilot-audit/';
const purpose='ESCUDO_FIT_NONFINANCIAL_IDENTITY_V1';
async function setup(page,{off=false,hold=false}={}) {
  const state={calls:[],release:null};
  await page.addInitScript(()=>{
    // The audit page must never touch existing account/session storage.
    for(const method of ['getItem','setItem','removeItem'])Storage.prototype[method]=()=>{throw Error('AUDIT_STORAGE_FORBIDDEN');};
  });
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`
    let count=0,current;
    window.google={accounts:{id:{disableAutoSelect(){},initialize(config){current=config;count++;},
      renderButton(node){const config=current,index=count,b=document.createElement('button');
        b.textContent='Continuar com Google (simulado)';b.onclick=()=>config.callback({credential:'synthetic.step'+index+'.signature'});node.append(b);}}}};
  `}));
  await page.route('**/api/v38/**',async route=>{
    const request=route.request();
    const fill=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{
      'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization',
      'access-control-allow-methods':'POST,OPTIONS'},body:JSON.stringify(body)});
    if(request.method()==='OPTIONS')return fill({},200);
    state.calls.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});
    if(off)return fill({state:'DISABLED'},503);
    if(request.postDataJSON().action==='CHALLENGE')return fill({state:'CHALLENGE',purpose,
      challengeId:'a'.repeat(43),buyerNonce:'ef-audit-buyer-v1-'+'b'.repeat(43),operatorNonce:'ef-audit-operator-v1-'+'c'.repeat(43),
      expiresAtMs:Date.now()+240000,financialGo:false,orderCreated:false,premiumGranted:false});
    const result={state:'PASS_NONFINANCIAL_IDENTITIES',purpose,buyerEmailHash:'a'.repeat(64),operatorSubjectHash:'b'.repeat(64),
      buyerSubjectHash:'c'.repeat(64),googleSignaturesVerified:true,noncesVerified:true,identitiesDistinct:true,
      freshIdentitiesVerified:true,challengeConsumed:true,financialGo:false,orderCreated:false,premiumGranted:false};
    if(hold)return new Promise(resolve=>{state.release=async()=>{await fill(result);resolve();};});
    return fill(result);
  });
  await page.setViewportSize({width:360,height:800});
  await page.goto(base);await expect(page.locator('#start')).toBeEnabled();return state;
}
const google=page=>page.getByRole('button',{name:'Continuar com Google (simulado)'}).click();
test('mobile three-account-callback flow succeeds with no storage or financial route and no overflow',async({page})=>{
  const state=await setup(page);expect(state.calls).toHaveLength(0);await page.locator('#start').click();
  await google(page);await expect(page.locator('#step-title')).toContainText('comprador');
  await google(page);await expect(page.locator('#step-title')).toContainText('auditoria');
  await google(page);await expect(page.locator('#step-title')).toHaveText('Duas identidades verificadas');
  await expect(page.locator('#status')).toContainText('Nenhuma cobrança');
  expect(state.calls).toHaveLength(2);expect(state.calls.every(c=>c.path==='/api/v38/pilot-audit/identity')).toBe(true);
  expect(state.calls[1].body).toEqual({action:'VERIFY',challengeId:'a'.repeat(43),
    buyerIdToken:'synthetic.step2.signature',operatorIdToken:'synthetic.step3.signature'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.locator('#step-title')).toHaveText('Tudo pronto para começar');expect(state.calls).toHaveLength(2);
});
test('OFF deployment ends with a safe retry and no extra request',async({page})=>{
  const state=await setup(page,{off:true});await page.locator('#start').click();await google(page);
  await expect(page.locator('#step-title')).toHaveText('Verificação não concluída');
  expect(state.calls).toHaveLength(1);await expect(page.locator('#google-slot')).toBeEmpty();
});
test('account change clears pending state; cancellation suppresses a late result',async({page})=>{
  const state=await setup(page,{hold:true});await page.locator('#start').click();await google(page);await google(page);await google(page);
  await expect(page.locator('#step-title')).toHaveText('Aguarde a confirmação');
  await page.locator('#cancel').click();await expect(page.locator('#step-title')).toHaveText('Tudo pronto para começar');
  if(state.release)await state.release().catch(()=>{});
  await expect(page.locator('#step-title')).toHaveText('Tudo pronto para começar');
  await page.locator('#start').click();await page.evaluate(()=>window.dispatchEvent(new Event('escudofit:accountChanged')));
  await expect(page.locator('#step-title')).toHaveText('Tudo pronto para começar');
});
