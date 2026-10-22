import {test,expect} from '@playwright/test';
const origin=process.env.ESCUDO_CONNECTION_TEST_ORIGIN||'http://127.0.0.1:4173';
const api='https://h3bobserve---escudo-fit-pilot-h3b-gateway-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/gateway';
const sdk="window.__connectionGoogle={};window.google={accounts:{id:{disableAutoSelect(){},initialize(o){window.__connectionGoogle.options=o},renderButton(slot){const b=document.createElement('button');b.textContent='Google de teste';b.onclick=()=>window.__connectionGoogle.options.callback({credential:'operator.synthetic.signature'});slot.append(b)}}}};";
async function fixture(page,{status=200,networkFailure=false}={}){
 const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),url=r.url();
  if(url.startsWith(origin+'/'))return route.continue();
  if(url.startsWith('https://accounts.google.com/gsi/client'))
   return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url===api){
   const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST',
    'access-control-allow-headers':'authorization,content-type,x-escudo-pilot-intent'};
   if(r.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   calls.push({url,body:r.postDataJSON()});
   if(networkFailure)return route.abort('failed');
   const value={state:'CHALLENGE',purpose:'ESCUDO_FIT_FIRST_LIVE_ISSUE_OPERATOR_V1',
    challengeId:'C'.repeat(43),buyerNonce:'ef-issue-buyer-v1-'+'B'.repeat(43),
    operatorNonce:'ef-issue-operator-v1-'+'O'.repeat(43),expiresAtMs:Date.now()+119000,
    financialGo:false,orderCreated:false,paymentConfirmed:false,premiumGranted:false};
   return route.fulfill({status,headers,contentType:'application/json',
    body:status===200?JSON.stringify(value):'{"PRIVATE_CANARY_DO_NOT_LOG":"server detail"}'});
  }
  return route.abort('blockedbyclient');
 });
 await page.goto(origin+'/app/pilot-pix/connection/');
 return {calls,errors};
}
for(const viewport of [{width:320,height:740},{width:1366,height:900}]){
 test('connection succeeds with no issuance or stored credentials at '+viewport.width,async({page})=>{
  await page.setViewportSize(viewport);const f=await fixture(page);
  await page.getByRole('button',{name:'Verificar conexão'}).click();
  await page.getByRole('button',{name:'Google de teste'}).click();
  await expect(page.locator('#result-code')).toHaveText('CONNECTION_CONFIRMED_NO_ISSUANCE');
  expect(f.calls).toHaveLength(1);expect(f.calls[0].body.action).toBe('CHALLENGE');
  expect(Object.keys(f.calls[0].body).sort()).toEqual(['action','approvalId']);
  expect(await page.evaluate(()=>window.__connectionGoogle.options.login_hint)).toBe('escudofit.revisao@gmail.com');
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  expect(await page.locator('input[type=file],textarea,a[href*="/pay/"]').count()).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('body').textContent()).not.toContain('operator.synthetic.signature');
  expect(f.errors).toEqual([]);
  await page.screenshot({path:'qa-output/pilot-connection-'+viewport.width+'.png',fullPage:true});
 });
}
test('HTTP400 has a safe visible category without raw response or repeat',async({page})=>{
 const f=await fixture(page,{status:400});
 await page.getByRole('button',{name:'Verificar conexão'}).click();
 await page.getByRole('button',{name:'Google de teste'}).click();
 await expect(page.locator('#result-code')).toHaveText('HTTP_400');
 await expect(page.locator('#start')).toBeHidden();expect(f.calls).toHaveLength(1);
 expect(await page.locator('body').textContent()).not.toContain('PRIVATE_CANARY_DO_NOT_LOG');
 expect(f.errors).toEqual([]);
});
test('network or CORS failure is reported without retry',async({page})=>{
 const f=await fixture(page,{networkFailure:true});
 await page.getByRole('button',{name:'Verificar conexão'}).click();
 await page.getByRole('button',{name:'Google de teste'}).click();
 await expect(page.locator('#result-code')).toHaveText('CONNECTION_UNAVAILABLE');
 expect(f.calls).toHaveLength(1);await expect(page.locator('#start')).toBeHidden();
 expect(f.errors).toEqual([]);
});
test('cancelled login rejects a late Google callback before any request',async({page})=>{
 const f=await fixture(page);await page.getByRole('button',{name:'Verificar conexão'}).click();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.evaluate(()=>window.__connectionGoogle.options.callback({credential:'late.synthetic.signature'}));
 expect(f.calls).toHaveLength(0);await expect(page.locator('#result-code')).toHaveText('CONNECTION_CANCELLED');
 expect(f.errors).toEqual([]);
});
