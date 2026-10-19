import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { previewChallenge,previewProof } from '../test/helpers/pilot-preview-fixture.mjs';
const base='http://127.0.0.1:4173/app/pilot-pix/';
async function setup(page,{off=false,hold=false}={}){
  const state={calls:[],release:null};
  await page.clock.install();
  await page.addInitScript(()=>{for(const method of ['getItem','setItem','removeItem'])
    Storage.prototype[method]=()=>{throw Error('PREVIEW_STORAGE_FORBIDDEN');};});
  // Every external request must match an explicit mock. No live Google/API calls.
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?
    route.continue():route.abort('blockedbyclient'));
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`
    let n=0,current;window.google={accounts:{id:{disableAutoSelect(){},initialize(c){current=c;n++;},
      renderButton(node){const config=current,index=n,b=document.createElement('button');b.textContent='Continuar com Google (simulado)';
        b.onclick=()=>config.callback({credential:'synthetic.step'+index+'.signature'});node.append(b);}}}};`}));
  await page.route('**/api/v38/**',async route=>{
    const request=route.request(),fill=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{
      'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization',
      'access-control-allow-methods':'POST,OPTIONS'},body:JSON.stringify(body)});
    if(request.method()==='OPTIONS')return fill({});
    state.calls.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});
    if(off)return fill({state:'DISABLED'},503);
    if(request.postDataJSON().action==='CHALLENGE')return fill(previewChallenge());
    if(hold)return new Promise(resolve=>{state.release=async()=>{await fill(previewProof());resolve();};});
    return fill(previewProof());
  });
  await page.setViewportSize({width:360,height:800});await page.goto(base,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#start')).toBeEnabled();return state;
}
const google=page=>page.getByRole('button',{name:'Continuar com Google (simulado)'}).click();
async function complete(page){await page.locator('#start').click();await google(page);
  await expect(page.locator('#step-title')).toContainText('comprador');await google(page);
  await expect(page.locator('#step-title')).toContainText('auditoria');await google(page);
  await expect(page.locator('#step-title')).toHaveText('Proposta pronta para baixar');}
test('mobile normal callbacks prepare an unsigned JSON download without storage, extra requests or overflow',async({page})=>{
  const s=await setup(page);expect(s.calls).toHaveLength(0);await complete(page);
  await expect(page.locator('#status')).toContainText('Nenhuma aprovação financeira');expect(s.calls).toHaveLength(2);
  expect(s.calls.every(c=>c.path==='/api/v38/pilot-pix/preview')).toBe(true);
  expect(s.calls[1].body.action).toBe('PREVIEW');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const downloadEvent=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/proposta-sem-assinatura.*\.json$/);
  const text=await readFile(await download.path(),'utf8'),file=JSON.parse(text);
  expect(file.record.maxAmountBRL).toBe('4.99');expect(file.record.maxOrders).toBe(1);
  expect(text).not.toContain('signature');expect(file.record.operatorSignature).toBeUndefined();expect(s.calls).toHaveLength(2);
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#step-title')).toHaveText('Tudo pronto para preparar');
  await expect(page.locator('#download')).toBeHidden();expect(s.calls).toHaveLength(2);
});
test('OFF shows a bounded failure and never offers a download',async({page})=>{
  const s=await setup(page,{off:true});await page.locator('#start').click();await google(page);
  await expect(page.locator('#step-title')).toHaveText('Prévia não concluída');await expect(page.locator('#download')).toBeHidden();expect(s.calls).toHaveLength(1);
});
test('cancel during canonical read suppresses a late proposal',async({page})=>{
  const s=await setup(page,{hold:true});await page.locator('#start').click();await google(page);await google(page);await google(page);
  await expect(page.locator('#step-title')).toHaveText('Aguarde a preparação');await page.locator('#cancel').click();
  if(s.release)await s.release().catch(()=>{});
  await expect(page.locator('#step-title')).toHaveText('Tudo pronto para preparar');await expect(page.locator('#download')).toBeHidden();
  await page.evaluate(()=>window.dispatchEvent(new Event('escudofit:accountChanged')));
  await expect(page.locator('#download')).toBeHidden();
});
test('expiry after successful preparation removes the download',async({page})=>{
  await setup(page);await complete(page);
  await page.clock.fastForward(1860001);
  await expect(page.locator('#step-title')).toHaveText('Prepare uma nova proposta');await expect(page.locator('#download')).toBeHidden();
});
test('account change removes an already prepared proposal',async({page})=>{
  const s=await setup(page);await complete(page);await expect(page.locator('#download')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('escudofit:accountChanged')));
  await expect(page.locator('#step-title')).toHaveText('Tudo pronto para preparar');await expect(page.locator('#download')).toBeHidden();
  expect(s.calls).toHaveLength(2);
});
