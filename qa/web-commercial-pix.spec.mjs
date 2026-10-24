import {test,expect} from '@playwright/test';
const root='http://127.0.0.1:4173',api='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38';
const ID='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockGoogle=`
window.google={accounts:{id:{
 disableAutoSelect(){},
 initialize(config){window.__escudoGoogle=config.callback;},
 renderButton(slot){const b=document.createElement('button');
   b.textContent='Google de teste';b.type='button';
   b.onclick=()=>window.__escudoGoogle({credential:'id.synthetic.jwt'});
   slot.append(b);}
}}};`;
const liveOrder=()=>({orderId:ID,requestKey:ID,planKey:'monthly',amountBRL:'4.99',
 currency:'BRL',status:'AWAITING_PAYMENT',
 checkoutExpiresAt:new Date(Date.now()+120000).toISOString(),
 qrCode:'000201'+'1'.repeat(60),premiumActivated:false});
async function fixtures(page,{enabled=false,pending=null}={}){
 const requests=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=request.url(),method=request.method();
  if(url.startsWith(root+'/'))return route.continue();
  if(url==='https://accounts.google.com/gsi/client')
    return route.fulfill({contentType:'text/javascript',body:mockGoogle});
  if(url.startsWith(api+'/')){
    if(method==='OPTIONS')return route.fulfill({status:204,headers:{
     'access-control-allow-origin':root,'access-control-allow-methods':'GET,POST,OPTIONS',
     'access-control-allow-headers':'authorization,content-type'}});
    requests.push({method,url,body:request.postDataJSON?.()||null});
    let data,status=200;
    if(url.endsWith('/auth/google'))data={user:{id:'synthetic',email:'buyer@example.invalid'},
      access_token:'access.synthetic.jwt'};
    else if(url.endsWith('/payments/commercial/health'))data={
      mode:enabled?'CONFIGURED':'OFF',sitePurchaseEnabled:enabled,
      buyerReconciliationReadEnabled:true,automaticRenewal:false,
      termsVersion:'prepaid-v1-2026-10-16',
      plans:{monthly:{amount:'4.99'},yearly:{amount:'49.90'}}};
    else if(url.endsWith('/orders/current'))data={order:pending};
    else if(url.endsWith('/orders/'+ID+'/reconciliation'))data={
      orderId:ID,canonicalStatus:'PENDING',
      providerState:'EXPIRED_RECONCILIATION_REQUIRED',method:'AUTHENTICATED_GET_ONLY',
      premiumActivated:false,reconciliationWritten:false};
    else if(url.endsWith('/orders/'+ID))data=liveOrder();
    else if(url.endsWith('/payments/commercial/orders')&&method==='POST'){
      data=liveOrder();status=201;
    }else return route.abort('blockedbyclient');
    return route.fulfill({status,headers:{'access-control-allow-origin':root},
      contentType:'application/json',body:JSON.stringify(data)});
  }
  return route.abort('blockedbyclient');
 });
 return {requests,errors};
}
async function enter(page){
 await page.goto(root+'/app/comprar/');
 await page.getByRole('button',{name:'Google de teste'}).click();
 await expect(page.locator('#account')).toContainText('buyer@example.invalid');
}
test('monthly site remains OFF and cannot create a Pix from disabled API flags',async({page})=>{
 const h=await fixtures(page);
 await page.setViewportSize({width:375,height:800});await enter(page);
 await expect(page.locator('#buy')).toBeDisabled();
 await expect(page.locator('#availability')).toContainText('não liberado');
 expect(h.requests.filter(x=>x.url.endsWith('/orders')&&x.method==='POST')).toHaveLength(0);
 expect(h.errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('existing order gets GET-only reconciliation; no second POST',async({page})=>{
 const h=await fixtures(page,{enabled:true,pending:liveOrder()});await enter(page);
 await expect(page.locator('#buy')).toBeDisabled();
 await expect(page.locator('#order-ref')).toHaveText(ID);
 await page.locator('#refresh').click();
 await expect(page.locator('#provider')).toHaveText('EXPIRED_RECONCILIATION_REQUIRED');
 expect(h.requests.filter(x=>x.url.endsWith('/reconciliation')).map(x=>x.method)).toEqual(['GET']);
 expect(h.requests.filter(x=>x.url.endsWith('/orders')&&x.method==='POST')).toHaveLength(0);
 expect(h.errors).toEqual([]);
});
test('explicit terms + click create exactly one order, second click cannot create again',async({page})=>{
 const h=await fixtures(page,{enabled:true,pending:null});await enter(page);
 await expect(page.locator('#buy')).toBeDisabled();
 await page.locator('#terms').check();
 await page.locator('#buy').click();
 await expect(page.locator('#order-ref')).toHaveText(ID);
 await expect(page.locator('#buy')).toBeDisabled();
 expect(h.requests.filter(x=>x.url.endsWith('/orders')&&x.method==='POST')).toHaveLength(1);
 expect(h.errors).toEqual([]);
});
