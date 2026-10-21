import {test,expect} from '@playwright/test';
const PURPOSE='ESCUDO_FIT_H3B_IDENTITY_QA_ONLY_V1',id=Buffer.alloc(32,1).toString('base64url'),buyerNonce='ef-h3b-qa-buyer-v1-'+Buffer.alloc(32,2).toString('base64url'),operatorNonce='ef-h3b-qa-operator-v1-'+Buffer.alloc(32,3).toString('base64url');
const flags={financialGo:false,orderCreated:false,paymentConfirmed:false,premiumGranted:false};
const sdk=`window.__qaGoogle={};window.google={accounts:{id:{disableAutoSelect(){},initialize(options){window.__qaGoogle.options=options;},renderButton(slot){const b=document.createElement('button');b.textContent='Continuar com Google (teste)';b.onclick=()=>{const o=window.__qaGoogle.options;const role=o.nonce.includes('-entry-')?'entry':o.nonce.includes('-buyer-')?'buyer':'operator';o.callback({credential:role+'.user.sig'});};slot.append(b);}}}};`;
async function fixture(page,{financial=false}={}){
 const requests=[];
 await page.route('**/*',async route=>{
  const r=route.request(),url=r.url();
  if(url.startsWith('http://127.0.0.1:4173/'))return route.continue();
  if(url.startsWith('https://accounts.google.com/gsi/client'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url.includes('/api/v38/pilot-pix/identity')){
   const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'authorization,content-type,x-escudo-pilot-intent','access-control-allow-methods':'POST'};
   if(r.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   const body=r.postDataJSON();requests.push({body,authorization:r.headers().authorization});
   let response=body.action==='CHALLENGE'?{state:'CHALLENGE',purpose:PURPOSE,challengeId:id,buyerNonce,operatorNonce,expiresAtMs:Date.now()+120000,...flags}:
    body.action==='STATUS'?{state:'WAITING_OPERATOR',purpose:PURPOSE,challengeId:id,expiresAtMs:Date.now()+119000,...flags}:
    body.action==='BUYER_CONFIRM'?{state:'BUYER_CONFIRMED',purpose:PURPOSE,challengeId:id,expiresAtMs:Date.now()+119000,...flags}:
    {state:'IDENTITIES_VERIFIED_NO_ORDER',purpose:PURPOSE,challengeId:id,completedAtMs:Date.now(),receiptDigest:'a'.repeat(64),googleSignaturesVerified:true,noncesVerified:true,identitiesDistinct:true,operatorVerified:true,buyerVerified:true,...flags,...(financial?{orderCreated:true}:{})};
   return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(response)});
  }
  return route.abort('blockedbyclient');
 });
 return requests;
}
test('operator mobile flow has isolated buyer link and no financial action',async({page})=>{
 await page.setViewportSize({width:375,height:812});const requests=await fixture(page);await page.goto('http://127.0.0.1:4173/app/pilot-pix/identity/');
 await page.getByRole('button',{name:'Iniciar verificação',exact:true}).click();await page.getByRole('button',{name:'Continuar com Google (teste)'}).click();
 await expect(page.locator('#share-box')).toBeVisible();const share=await page.locator('#buyer-link').inputValue();expect(share).toContain('?role=buyer#');expect(share).not.toContain('.user.sig');
 await page.getByRole('button',{name:'Conferir confirmação do comprador'}).click();await page.getByRole('button',{name:'Continuar com Google (teste)'}).click();
 await expect(page.getByRole('heading',{name:'Duas contas verificadas'})).toBeVisible();await expect(page.locator('#receipt-digest')).toHaveText('a'.repeat(64));
 expect(requests.map(x=>x.body.action)).toEqual(['CHALLENGE','STATUS','OPERATOR_CONFIRM']);expect(JSON.stringify(requests)).not.toContain('buyer.user.sig');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('buyer page uses own nonce and exposes no operator receipt',async({page})=>{
 await page.setViewportSize({width:320,height:740});const requests=await fixture(page);const hash=new URLSearchParams({c:id,n:buyerNonce,e:String(Date.now()+120000)});
 await page.goto('http://127.0.0.1:4173/app/pilot-pix/identity/?role=buyer#'+hash);await page.getByRole('button',{name:'Iniciar verificação',exact:true}).click();await page.getByRole('button',{name:'Continuar com Google (teste)'}).click();
 await expect(page.getByRole('heading',{name:'Comprador confirmado'})).toBeVisible();await expect(page.locator('#receipt-box')).toBeHidden();expect(requests).toHaveLength(1);expect(requests[0].body.action).toBe('BUYER_CONFIRM');expect(requests[0].authorization).toBe('Bearer buyer.user.sig');expect(page.url()).not.toContain('#');
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('financial-looking response is rejected and credentials are discarded',async({page})=>{
 await fixture(page,{financial:true});await page.goto('http://127.0.0.1:4173/app/pilot-pix/identity/');await page.getByRole('button',{name:'Iniciar verificação',exact:true}).click();await page.getByRole('button',{name:'Continuar com Google (teste)'}).click();await page.getByRole('button',{name:'Conferir confirmação do comprador'}).click();await page.getByRole('button',{name:'Continuar com Google (teste)'}).click();
 await expect(page.getByRole('heading',{name:'Verificação não concluída'})).toBeVisible();await expect(page.locator('#receipt-box')).toBeHidden();await expect(page.locator('#buyer-link')).toHaveValue('');
});
test('cancel invalidates late Google callback without sending credentials',async({page})=>{
 const requests=await fixture(page);await page.goto('http://127.0.0.1:4173/app/pilot-pix/identity/');await page.getByRole('button',{name:'Iniciar verificação',exact:true}).click();await page.getByRole('button',{name:'Cancelar e limpar'}).click();await page.evaluate(()=>window.__qaGoogle.options.callback({credential:'entry.user.sig'}));expect(requests).toHaveLength(0);await expect(page.locator('#share-box')).toBeHidden();
});
test('missing buyer link never mounts a Google credential callback',async({page})=>{
 const requests=await fixture(page);await page.goto('http://127.0.0.1:4173/app/pilot-pix/identity/?role=buyer');await page.getByRole('button',{name:'Iniciar verificação',exact:true}).click();await expect(page.getByRole('heading',{name:'Verificação não concluída'})).toBeVisible();await expect(page.getByRole('button',{name:'Continuar com Google (teste)'})).toHaveCount(0);expect(requests).toHaveLength(0);
});
