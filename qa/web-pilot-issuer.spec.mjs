import {test,expect} from '@playwright/test';
import {approvalFile} from '../test/helpers/pilot-approval-fixture.mjs';
const origin='http://127.0.0.1:4173',api='https://escudo-fit-pilot-h3b-gateway-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/gateway';
const C='C'.repeat(43),B='ef-issue-buyer-v1-'+'B'.repeat(43),O='ef-issue-operator-v1-'+'O'.repeat(43);
const sdk="window.__issueGoogle={};window.google={accounts:{id:{disableAutoSelect(){},initialize(o){window.__issueGoogle.options=o;},renderButton(slot){const b=document.createElement('button');b.textContent='Google de teste';b.onclick=()=>{const o=window.__issueGoogle.options;const role=o.nonce.includes('-buyer-')?'buyer':o.nonce.includes('-operator-')?'operator':'entry';o.callback({credential:role+'.synthetic.sig'});};slot.append(b);}}}};";
async function fixture(page,{uncertain=false}={}){
 const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),u=r.url();
  if(u.startsWith(origin+'/'))return route.continue();
  if(u.startsWith('https://accounts.google.com/gsi/client'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(u===api||u===api+'/buyer'){
   const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type,x-escudo-pilot-intent','access-control-allow-methods':'POST'};
   if(r.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   const body=r.postDataJSON();requests.push({url:u,body,authorization:r.headers().authorization});
   if(body.action==='ISSUE'&&uncertain)return route.fulfill({status:503,headers,contentType:'application/json',body:'{"code":"PILOT_H3B_PRIVATE_OUTCOME_UNCERTAIN"}'});
   const value=body.action==='CHALLENGE'?{state:'CHALLENGE',purpose:'ESCUDO_FIT_FIRST_LIVE_ISSUE_OPERATOR_V1',
    challengeId:C,buyerNonce:B,operatorNonce:O,expiresAtMs:Date.now()+119000,financialGo:false,orderCreated:false,paymentConfirmed:false,premiumGranted:false}:
    u.endsWith('/buyer')?{state:'BUYER_CONFIRMED',challengeId:C,expiresAtMs:Date.now()+110000}:
    {state:'ORDER_CREATED_FINANCIAL_CONTRACT_PENDING',orderId:'EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',orderCreated:true,paymentConfirmed:false,premiumGranted:false};
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(value)});
  }
  return route.abort('blockedbyclient');
 });return {requests,errors};
}
async function startOperator(page){
 await page.goto(origin+'/app/pilot-pix/issue/');
 await page.locator('#signed-file').setInputFiles({name:'aprovacao-teste.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(approvalFile(Date.now())))});
 await page.locator('#terms').check();await page.locator('#start').click();await page.getByRole('button',{name:'Google de teste'}).click();
 await expect(page.locator('#share-box')).toBeVisible();
}
test('operator mobile route keeps buyer token on the buyer page and sends exactly one ISSUE',async({page})=>{
 await page.setViewportSize({width:375,height:812});const f=await fixture(page);await startOperator(page);
 const link=await page.locator('#buyer-link').inputValue();expect(link).toContain('?role=buyer#');expect(link).not.toContain('.synthetic.sig');expect(link).not.toContain(O);
 await page.locator('#continue').click();await page.getByRole('button',{name:'Google de teste'}).click();
 await expect(page.getByRole('heading',{name:'Ordem criada · pagamento pendente'})).toBeVisible();
 await expect(page.locator('#order-id')).toHaveText('EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 expect(f.requests.map(r=>r.body.action)).toEqual(['CHALLENGE','ISSUE']);expect(JSON.stringify(f.requests)).not.toContain('buyer.synthetic.sig');
 await expect(page.locator('#start')).toBeHidden();await expect(page.locator('#continue')).toBeHidden();await expect(page.locator('#share-box')).toBeHidden();
 expect(f.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
 await page.screenshot({path:'qa-output/pilot-issuer-operator-mobile.png',fullPage:true});
});
test('buyer confirms directly with its own nonce, clears fragment and has no ISSUE action',async({page})=>{
 await page.setViewportSize({width:320,height:740});const f=await fixture(page);
 const hash=new URLSearchParams({a:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',c:C,n:B,e:String(Date.now()+119000)});
 await page.goto(origin+'/app/pilot-pix/issue/?role=buyer#'+hash);
 await expect(page.locator('#file-area')).toBeHidden();await page.locator('#terms').check();await page.locator('#start').click();
 await page.getByRole('button',{name:'Google de teste'}).click();await expect(page.getByRole('heading',{name:'Comprador confirmado'})).toBeVisible();
 expect(page.url()).not.toContain('#');expect(f.requests).toHaveLength(1);expect(f.requests[0].url).toBe(api+'/buyer');
 expect(f.requests[0].authorization).toBe('Bearer buyer.synthetic.sig');expect(f.requests[0].body.buyerNonce).toBe(B);
 await expect(page.locator('#continue')).toBeHidden();await expect(page.locator('#result-box')).toBeHidden();
 expect(f.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'qa-output/pilot-issuer-buyer-mobile.png',fullPage:true});
});
test('uncertain final response offers no repeat and hides transient credentials',async({page})=>{
 const f=await fixture(page,{uncertain:true});await startOperator(page);await page.locator('#continue').click();
 await page.getByRole('button',{name:'Google de teste'}).click();
 await expect(page.getByRole('heading',{name:'Resultado a conferir · não repetir'})).toBeVisible();
 await expect(page.locator('#start')).toBeHidden();await expect(page.locator('#continue')).toBeHidden();await expect(page.locator('#cancel')).toBeHidden();
 await expect(page.locator('#buyer-link')).toHaveValue('');expect(f.requests.filter(r=>r.body.action==='ISSUE')).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('cancel rejects late Google callback before any network request',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/app/pilot-pix/issue/');
 await page.locator('#signed-file').setInputFiles({name:'teste.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(approvalFile(Date.now())))});
 await page.locator('#terms').check();await page.locator('#start').click();await page.locator('#cancel').click();
 await page.evaluate(()=>window.__issueGoogle.options.callback({credential:'late.synthetic.sig'}));
 expect(f.requests).toHaveLength(0);await expect(page.locator('#share-box')).toBeHidden();expect(f.errors).toEqual([]);
});
test('missing or expired buyer link cannot render a Google callback or send a request',async({page})=>{
 const f=await fixture(page);await page.goto(origin+'/app/pilot-pix/issue/?role=buyer');await page.locator('#terms').check();
 await expect(page.locator('#start')).toBeDisabled();await expect(page.getByRole('button',{name:'Google de teste'})).toHaveCount(0);
 expect(f.requests).toHaveLength(0);expect(f.errors).toEqual([]);
});
