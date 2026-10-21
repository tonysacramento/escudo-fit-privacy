import {test,expect} from '@playwright/test';
const ORDER='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const API='https://pilot-pay---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/buyer-checkout';
const sdk="window.__pay={};window.google={accounts:{id:{disableAutoSelect(){},initialize(o){window.__pay.options=o;},renderButton(slot){const b=document.createElement('button');b.textContent='Google comprador de teste';b.onclick=()=>window.__pay.options.callback({credential:'buyer.synthetic.signature'});slot.append(b);}}}};";
async function fixture(page,{invalid=false}={}){
 const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),url=r.url();
  if(url.startsWith('http://127.0.0.1:4173/'))return route.continue();
  if(url.startsWith('https://accounts.google.com/gsi/client'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url===API){
   const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST'};
   if(r.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   calls.push({body:r.postDataJSON(),authorization:r.headers().authorization});
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({state:'AWAITING_PAYMENT',orderId:ORDER,amountBRL:invalid?'49.90':'4.99',
    expiresAt:new Date(Date.now()+120000).toISOString(),qrCode:'000201'+'1'.repeat(50),qrCodeBase64:null,ticketUrl:null,paymentConfirmed:false,premiumGranted:false})});
  }
  return route.abort('blockedbyclient');
 });return {calls,errors};
}
test('buyer mobile page reads the existing order once, scrubs URL and shows manual Pix only',async({page})=>{
 await page.setViewportSize({width:320,height:740});const f=await fixture(page);
 await page.goto('http://127.0.0.1:4173/app/pilot-pix/pay/#o='+ORDER);
 await page.locator('#start').click();await page.getByRole('button',{name:'Google comprador de teste'}).click();
 await expect(page.getByRole('heading',{name:'Pix pronto para pagamento manual'})).toBeVisible();await expect(page.locator('#pix-code')).toHaveValue('000201'+'1'.repeat(50));
 expect(page.url()).not.toContain('#');expect(f.calls).toEqual([{body:{orderId:ORDER},authorization:'Bearer buyer.synthetic.signature'}]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
 await page.locator('#clear').click();await expect(page.locator('#pix-box')).toBeHidden();await expect(page.locator('#pix-code')).toHaveValue('');
 expect(f.errors).toEqual([]);await page.screenshot({path:'qa-output/pilot-payment-mobile.png',fullPage:true});
});
test('mismatched amount never displays QR or permits a payment link',async({page})=>{
 const f=await fixture(page,{invalid:true});await page.goto('http://127.0.0.1:4173/app/pilot-pix/pay/#o='+ORDER);
 await page.locator('#start').click();await page.getByRole('button',{name:'Google comprador de teste'}).click();
 await expect(page.getByRole('heading',{name:'Consulta não concluída'})).toBeVisible();await expect(page.locator('#pix-box')).toBeHidden();
 await expect(page.locator('#pix-code')).toHaveValue('');expect(f.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('without an order reference there is no Google callback or checkout request',async({page})=>{
 const f=await fixture(page);await page.goto('http://127.0.0.1:4173/app/pilot-pix/pay/');
 await expect(page.locator('#start')).toBeDisabled();expect(f.calls).toHaveLength(0);expect(f.errors).toEqual([]);
});
