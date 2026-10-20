import {test,expect} from '@playwright/test';
import {approvalFile,approvalChallenge,approvalReceipt} from '../test/helpers/pilot-approval-fixture.mjs';
const ORIGIN='http://127.0.0.1:4173';
async function setup(page,{badReceipt=false}={}){
  const record=approvalFile(Date.now());const calls=[];
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(ORIGIN+'/'))return route.continue();
    if(url==='https://accounts.google.com/gsi/client')return route.fulfill({contentType:'application/javascript',body:`
      let config,n=0;window.google={accounts:{id:{disableAutoSelect(){},initialize(v){config=v;},
      renderButton(slot){const c=config,button=document.createElement('button');button.textContent='Google de teste';
        button.type='button';button.onclick=()=>c.callback({credential:'synthetic.'+(++n)+'.signature'});slot.append(button);}}}};`});
    if(url==='https://pilot-approval---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/approval'){
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{
        'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'POST, OPTIONS',
        'access-control-allow-headers':'Content-Type, Authorization'}});
      const body=route.request().postDataJSON();calls.push(body);
      const value=body.action==='CHALLENGE'?approvalChallenge(Date.now()):
        {...approvalReceipt(record),...(badReceipt?{financialGo:true}:{})};
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':ORIGIN},
        body:JSON.stringify(value)});
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(ORIGIN+'/app/pilot-pix/approval/');
  const file=()=>page.locator('#signed-file').setInputFiles({name:'synthetic-approval.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(record))});
  const complete=async()=>{await file();await expect(page.getByRole('button',{name:'Conferir e registrar aprovação'})).toBeEnabled();
    await page.getByRole('button',{name:'Conferir e registrar aprovação'}).click();
    for(let i=0;i<3;i++){await page.getByRole('button',{name:'Google de teste'}).click();
      if(i<2)await expect(page.locator('#step-count')).toHaveText((i+2)+' DE 3');}};
  return {record,calls,file,complete};
}
for(const width of [320,375]){
  test('mobile '+width+' confirms only signed approval registration using explicit API/Google mocks',async({page})=>{
    await page.setViewportSize({width,height:850});const f=await setup(page);await f.complete();
    await expect(page.getByRole('heading',{name:'Aprovação registrada',exact:true})).toBeVisible();
    expect(f.calls).toHaveLength(2);expect(f.calls[0]).toEqual({action:'CHALLENGE',signedApproval:f.record});
    expect(f.calls[1].action).toBe('INSTALL');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/pilot-approval-'+width+'.png',fullPage:true});
  });
}
test('unexpected financial response cannot display a successful registration',async({page})=>{
  const f=await setup(page,{badReceipt:true});await f.complete();
  await expect(page.getByRole('heading',{name:'Registro não confirmado'})).toBeVisible();expect(f.calls).toHaveLength(2);
});
test('invalid file cannot start Google or issue any API request',async({page})=>{
  const f=await setup(page);
  await page.locator('#signed-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"maxOrders":2}')});
  await expect(page.getByRole('heading',{name:'Registro não confirmado'})).toBeVisible();expect(f.calls).toHaveLength(0);
});
test('cancel discards the file and callbacks without storing a product session',async({page})=>{
  const f=await setup(page);await f.file();
  await page.getByRole('button',{name:'Conferir e registrar aprovação'}).click();
  await page.getByRole('button',{name:'Cancelar e limpar'}).click();
  await expect(page.getByRole('button',{name:'Conferir e registrar aprovação'})).toBeDisabled();
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  expect(f.calls).toHaveLength(0);
});
