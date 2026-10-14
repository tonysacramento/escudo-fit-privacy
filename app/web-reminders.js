/* Escudo Fit Web: visible-page reminders only. Not a push subscription or Android scheduler. */
(function(root){
  'use strict';
  const PREFIX='escudofit_web_reminder_prefs_v1_';
  const defaults=()=>({
    hydration:{enabled:false,intervalHours:2,start:'07:00',end:'22:00'},
    application:{enabled:false,frequency:'WEEKLY',weekday:1,intervalDays:7,anchor:'',time:'09:00'},
    sent:{}
  });
  const dayKey=(date)=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const minutes=(value)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''))?Number(value.slice(0,2))*60+Number(value.slice(3,5)):null;
  const dueHydration=(setting,now)=>{
    if(!setting?.enabled)return null;
    const every=Number(setting.intervalHours);
    const start=minutes(setting.start),end=minutes(setting.end);
    if(![1,2,3].includes(every)||start===null||end===null||start>=end)return null;
    const at=now.getHours()*60+now.getMinutes();
    if(at<start||at>end)return null;
    const slots=Math.floor((at-start)/(every*60));
    const next=start+slots*every*60;
    if(at-next<0||at-next>2||next>end)return null;
    return dayKey(now)+':water:'+next;
  };
  const dueApplication=(setting,now)=>{
    if(!setting?.enabled)return null;
    const at=minutes(setting.time);
    if(at===null)return null;
    const nowMinutes=now.getHours()*60+now.getMinutes();
    if(nowMinutes<at||nowMinutes-at>2)return null;
    const today=dayKey(now);
    const anchor=String(setting.anchor||'');
    const anchorDate=/^\d{4}-\d{2}-\d{2}$/.test(anchor)?new Date(anchor+'T12:00:00'):null;
    if(!anchorDate||Number.isNaN(anchorDate.getTime()))return null;
    const todayNoon=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
    const delta=Math.round((todayNoon-anchorDate)/(24*60*60*1000));
    if(delta<0)return null;
    let scheduled=false;
    if(setting.frequency==='DAILY')scheduled=true;
    if(setting.frequency==='WEEKLY')scheduled=now.getDay()===Number(setting.weekday);
    if(setting.frequency==='OTHER'){
      const every=Number(setting.intervalDays);
      scheduled=Number.isInteger(every)&&every>=2&&every<=30&&delta%every===0;
    }
    return scheduled?today+':application:'+at:null;
  };
  function mount({getContext,onToast}){
    const get=id=>document.getElementById(id);
    let displayedAccount=null;
    const settingKey=id=>PREFIX+id;
    function load(id){
      try{
        const stored=JSON.parse(root.localStorage.getItem(settingKey(id))||'null');
        const seed=defaults();
        if(!stored||typeof stored!=='object')return seed;
        return {
          hydration:{...seed.hydration,...(stored.hydration||{})},
          application:{...seed.application,...(stored.application||{})},
          sent:stored.sent&&typeof stored.sent==='object'?stored.sent:{}
        };
      }catch{return defaults()}
    }
    function save(id,prefs){root.localStorage.setItem(settingKey(id),JSON.stringify(prefs))}
    const setText=(id,value)=>{const el=get(id);if(el)el.textContent=value};
    function showFrequency(){
      if(get('webApplicationWeekly'))get('webApplicationWeekly').hidden=get('webApplicationFrequency')?.value!=='WEEKLY';
      if(get('webApplicationEvery'))get('webApplicationEvery').hidden=get('webApplicationFrequency')?.value!=='OTHER';
    }
    function refresh(){
      const context=getContext();
      if(!context.authenticated||!context.userId){displayedAccount=null;return}
      if(displayedAccount===context.userId)return;
      displayedAccount=context.userId;
      const prefs=load(context.userId);
      if(get('webHydrationEnabled'))get('webHydrationEnabled').checked=Boolean(prefs.hydration.enabled);
      if(get('webHydrationInterval'))get('webHydrationInterval').value=String(prefs.hydration.intervalHours);
      if(get('webHydrationStart'))get('webHydrationStart').value=prefs.hydration.start;
      if(get('webHydrationEnd'))get('webHydrationEnd').value=prefs.hydration.end;
      if(get('webApplicationEnabled'))get('webApplicationEnabled').checked=Boolean(prefs.application.enabled);
      if(get('webApplicationFrequency'))get('webApplicationFrequency').value=prefs.application.frequency;
      if(get('webApplicationWeekday'))get('webApplicationWeekday').value=String(prefs.application.weekday);
      if(get('webApplicationEveryDays'))get('webApplicationEveryDays').value=String(prefs.application.intervalDays);
      if(get('webApplicationAnchor'))get('webApplicationAnchor').value=prefs.application.anchor||dayKey(new Date());
      if(get('webApplicationTime'))get('webApplicationTime').value=prefs.application.time;
      showFrequency();
      setText('webHydrationStatus',prefs.hydration.enabled?'Lembretes Web ativos enquanto a página estiver aberta.':'Lembretes Web desativados.');
      setText('webApplicationStatus',prefs.application.enabled?'Alerta Web de aplicação ativo enquanto a página estiver aberta.':'Alerta Web de aplicação desativado.');
    }
    async function browserPermissionIfNeeded(enabled){
      if(!enabled)return 'disabled';
      if(!('Notification' in root))return 'unsupported';
      if(root.Notification.permission==='granted')return 'granted';
      if(root.Notification.permission==='denied')return 'denied';
      try{return await root.Notification.requestPermission()}catch{return 'denied'}
    }
    function permissionMessage(p){
      return p==='granted'?' Permissão do navegador concedida.':
        p==='disabled'?'': ' Avisos na tela continuam disponíveis; notificações do sistema não foram autorizadas.';
    }
    get('webHydrationSave')?.addEventListener('click',async()=>{
      const context=getContext();if(!context.authenticated||!context.userId)return;
      const start=get('webHydrationStart').value,end=get('webHydrationEnd').value;
      const first=minutes(start),last=minutes(end);
      if(first===null||last===null||first>=last){
        setText('webHydrationStatus','Informe um início anterior ao fim do horário de lembretes.');return;
      }
      const prefs=load(context.userId);
      prefs.hydration={enabled:get('webHydrationEnabled').checked,intervalHours:Number(get('webHydrationInterval').value),start,end};
      save(context.userId,prefs);
      const permission=await browserPermissionIfNeeded(prefs.hydration.enabled);
      setText('webHydrationStatus',(prefs.hydration.enabled?'Lembretes de água ativados neste navegador.':'Lembretes de água desativados.')+permissionMessage(permission));
    });
    get('webApplicationFrequency')?.addEventListener('change',showFrequency);
    get('webApplicationSave')?.addEventListener('click',async()=>{
      const context=getContext();if(!context.authenticated||!context.userId)return;
      const frequency=get('webApplicationFrequency').value;
      const anchor=get('webApplicationAnchor').value;
      const time=get('webApplicationTime').value;
      const intervalDays=Number(get('webApplicationEveryDays').value);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||minutes(time)===null||
        (frequency==='OTHER'&&(!Number.isInteger(intervalDays)||intervalDays<2||intervalDays>30))){
        setText('webApplicationStatus','Revise a data, o horário e o intervalo (2 a 30 dias).');return;
      }
      const prefs=load(context.userId);
      prefs.application={
        enabled:get('webApplicationEnabled').checked,
        frequency,weekday:Number(get('webApplicationWeekday').value),
        intervalDays,anchor,time,
      };
      save(context.userId,prefs);
      const permission=await browserPermissionIfNeeded(prefs.application.enabled);
      setText('webApplicationStatus',(prefs.application.enabled?'Lembrete de aplicação ativado somente neste navegador.':'Lembrete de aplicação desativado.')+permissionMessage(permission));
    });
    async function showAlert(title,message,tag){
      onToast(message);
      if(!('Notification' in root)||root.Notification.permission!=='granted')return;
      try{
        const registration=await root.navigator.serviceWorker?.getRegistration?.();
        if(registration?.showNotification){
          await registration.showNotification(title,{body:message,tag,icon:'./icon-approved-v43.png'});
        }else{
          new root.Notification(title,{body:message,tag,icon:'./icon-approved-v43.png'});
        }
      }catch{ /* No false claim of background push support. */ }
    }
    function tick(now=new Date()){
      const ctx=getContext();if(!ctx.authenticated||!ctx.userId||root.document.visibilityState==='hidden')return;
      const prefs=load(ctx.userId);
      const waterDue=dueHydration(prefs.hydration,now);
      const achieved=Number(ctx.waterGoal)>0&&Number(ctx.water)>=Number(ctx.waterGoal);
      const hasAppliedToday=(Array.isArray(ctx.applications)?ctx.applications:[]).some(item=>
        (item.scheduledDateIso||dayKey(new Date(item.at)))===dayKey(now));
      const applicationDue=dueApplication(prefs.application,now);
      const expired=Object.keys(prefs.sent).filter(key=>key.slice(0,10)<dayKey(new Date(now.getTime()-8*86400000)));
      for(const old of expired)delete prefs.sent[old];
      const possible=[
        !achieved&&waterDue?{id:waterDue,title:'Escudo Fit • Água',body:'Hora de conferir sua hidratação de hoje.'}:null,
        !hasAppliedToday&&applicationDue?{id:applicationDue,title:'Escudo Fit • Aplicação',body:'Consulte o cronograma da sua próxima aplicação no Escudo Fit.'}:null,
      ].filter(Boolean);
      for(const message of possible){
        if(prefs.sent[message.id])continue;
        prefs.sent[message.id]=Date.now();save(ctx.userId,prefs);
        void showAlert(message.title,message.body,message.id);
      }
    }
    return {refresh,tick};
  }
  root.EscudoFitWebReminders={mount,dueHydration,dueApplication};
  if(typeof module!=='undefined'&&module.exports)module.exports={dueHydration,dueApplication};
})(typeof window!=='undefined'?window:globalThis);
