import { test,expect } from '@playwright/test';

const user={id:'synthetic-checkout-user',email:'buyer@example.invalid',name:'Compra sintética'};
const id='EF-00000000-0000-4000-8000-000000000001',key='11111111-1111-4111-8111-111111111111';
const free={mode:'FREE',source:'SYSTEM_DEFAULT',isActive:true,expiresAt:null,revalidateAfter:null};
const health={mode:'CONFIGURED',termsVersion:'prepaid-v1-2026-10-16',intakeEnabled:true,checkoutEnabled:true,
  webhookEnabled:true,workerEnabled:true,deliveryEnabled:true,grantsEnabled:true,canonicalEntitlementEnabled:true,
  plans:{monthly:{amount:'4.99'},yearly:{amount:'49.90'}}};
const pending=()=>({orderId:id,requestKey:key,planKey:'monthly',amountBRL:'4.99',currency:'BRL',status:'AWAITING_PAYMENT',
  qrCode:'000201SYNTHETIC_COMMERCIAL_QR_ONLY',qrCodeBase64:null,premiumActivated:true,
  checkoutExpiresAt:new Date(Date.now()+1800000).toISOString(),estimatedExpiresAt:new Date(Date.now()+30*86400000).toISOString()});

async function setup(page,{enabled=true,holdPost=false}={}){
  const state={paid:false,entitled:false,posts:[],release:null};
  await page.addInitScript(({user,free})=>{
    localStorage.setItem('escudofit_web_auth_v1',JSON.stringify({user,entitlement:free,
      access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token'}));
  },{user,free});
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({
    contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}};'}));
  const fill=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',
    headers:{'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, Authorization',
      'access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
  await page.route('**/api/v38/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(route.request().method()==='OPTIONS')return fill(route,{},200);
    if(path.endsWith('/auth/logout'))return fill(route,{logged_out:true});
    if(path.endsWith('/me')&&!path.includes('/entitlement/'))return fill(route,{user});
    if(path.endsWith('/entitlement/me'))return fill(route,state.entitled?
      {mode:'PREMIUM',source:'PIX_PAYMENT',isActive:true,expiresAt:new Date(Date.now()+30*86400000).toISOString()}:free);
    if(path.endsWith('/payments/commercial/health'))return fill(route,enabled?health:{...health,mode:'OFF',checkoutEnabled:false});
    if(path.endsWith('/orders/current'))return fill(route,{order:null});
    if(path.endsWith('/orders')&&route.request().method()==='POST'){
      state.posts.push(route.request().postDataJSON());
      if(holdPost)return new Promise(resolve=>{state.release=async()=>{await fill(route,pending(),201);resolve();};});
      return fill(route,pending(),201);
    }
    if(path.endsWith('/orders/'+id))return fill(route,state.paid?
      {...pending(),status:'COMMITTED',qrCode:null,expiresAt:new Date(Date.now()+30*86400000).toISOString()}:pending());
    if(path.endsWith('/history/backup'))return fill(route,{revision:0,entries:[],updatedAt:null});
    if(path.endsWith('/history'))return fill(route,{weights:[],measurements:[],applications:[],water:[],movement:[],nutrition:[]});
    return fill(route,{});
  });
  await page.goto('http://127.0.0.1:4173/app/',{waitUntil:'networkidle'});
  await expect(page.locator('#webAccessGate')).toBeVisible();
  return state;
}

test('OFF checkout is visible as unavailable, with no Pix request and no entitlement upgrade',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const state=await setup(page,{enabled:false});await page.locator('#webPremiumPurchase').click();
  await expect(page.locator('#premiumCheckoutDialog')).toBeVisible();
  await expect(page.locator('#premiumCheckoutMessage')).toContainText('ainda não está disponível');
  await expect(page.locator('#premiumCheckoutCreate')).toBeHidden();
  await expect(page.locator('#premiumCheckoutPayment')).toBeHidden();
  expect(state.posts).toHaveLength(0);await expect(page.locator('#appExperience')).toBeHidden();
});

test('prepaid purchase needs explicit terms and confirms access only through fresh entitlement',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const state=await setup(page);await page.locator('#webPremiumPurchase').click();
  await expect(page.locator('#premiumCheckoutCreate')).toBeDisabled();
  await expect(page.locator('#premiumCheckoutTitle')).toContainText('30 dias — R$ 4,99');
  await expect(page.locator('#premiumCheckoutDialog')).toContainText('Não há renovação nem cobrança automática');
  await page.locator('#premiumCheckoutTerms').check();await page.locator('#premiumCheckoutCreate').click();
  await expect(page.locator('#premiumCheckoutQr')).toHaveValue('000201SYNTHETIC_COMMERCIAL_QR_ONLY');
  expect(state.posts).toHaveLength(1);expect(Object.keys(state.posts[0]).sort()).toEqual(['acceptedTermsVersion','channel','planKey','requestKey']);
  await expect(page.locator('#appExperience')).toBeHidden();
  state.paid=true;await page.locator('#premiumCheckoutRefresh').click();
  await expect(page.locator('#premiumCheckoutMessage')).toContainText('Seu acesso está sendo atualizado');
  await expect(page.locator('#appExperience')).toBeHidden();
  state.entitled=true;await page.locator('#premiumCheckoutRefresh').click();
  await expect(page.locator('#premiumCheckoutMessage')).toContainText('acesso atualizado');
  await expect(page.locator('#appExperience')).toBeVisible();expect(state.posts).toHaveLength(1);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  expect(overflow).toBe(false);
});

test('logout clears private checkout and a late response cannot show a prior account payment',async({page})=>{
  const state=await setup(page,{holdPost:true});await page.locator('#webPremiumPurchase').click();
  await page.locator('#premiumCheckoutTerms').check();await page.locator('#premiumCheckoutCreate').click();
  await expect.poll(()=>Boolean(state.release)).toBe(true);
  await page.locator('#premiumCheckoutClose').click();await page.locator('#webAccessLogout').click();
  await expect(page.locator('#marketingExperience')).toBeVisible();
  await state.release();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
  await expect(page.locator('#premiumCheckoutDialog')).toBeHidden();
  await expect(page.locator('#premiumCheckoutQr')).toHaveValue('');
  expect(await page.evaluate(()=>localStorage.getItem('escudofit_web_auth_v1'))).toBeNull();
});
