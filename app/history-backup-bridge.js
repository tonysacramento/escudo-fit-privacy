(function(root){
  'use strict';
  const DATE=/^\d{4}-\d{2}-\d{2}$/;
  const MEDICATIONS=new Set(['NONE','OZEMPIC','WEGOVY','MOUNJARO','SAXENDA','OTHER']);
  const validDate=date=>{
    if(typeof date!=='string'||!DATE.test(date))return false;
    const d=new Date(date+'T00:00:00.000Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date;
  };
  const list=value=>Array.isArray(value)?value:[];
  const ts=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;
  const isObj=x=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x);
  const blank=()=>({weights:[],measurements:[],applications:[],movement:[],nutrition:[],water:[],treatment:null});
  const validWeight=x=>isObj(x)&&typeof x.id==='string'&&x.id.length>0&&ts(x.timestampMs)>0&&
    Number.isFinite(Number(x.weightKg))&&Number(x.weightKg)>=20&&Number(x.weightKg)<=400;

  function unpackBackup(snapshot){
    const data=blank();
    let validEntries=0;
    if(!isObj(snapshot)||!Array.isArray(snapshot.entries))return {data,validEntries,revision:0};
    const entries=snapshot.entries.slice(0,2500);
    for(const entry of entries){
      if(!isObj(entry)||typeof entry.key!=='string'||typeof entry.value!=='string'||entry.value.length>120000)continue;
      let value;
      try{value=JSON.parse(entry.value)}catch{continue}
      if(entry.key==='weight_history'&&Array.isArray(value)){
        data.weights=list(value).filter(validWeight).slice(0,200);
        validEntries++;
      }else if(entry.key==='body_measurements_v1'&&Array.isArray(value)){
        data.measurements=list(value).filter(x=>isObj(x)&&validDate(x.date))
          .map(x=>({date:x.date,...Object.fromEntries(['waist','abdomen','hips','chest','arm','thigh']
            .filter(k=>x[k]!=null&&Number.isFinite(Number(x[k]))&&Number(x[k])>=20&&Number(x[k])<=250)
            .map(k=>[k,Number(x[k])]))})).filter(x=>Object.keys(x).length>1).slice(0,200);
        validEntries++;
      }else if(entry.key==='dose_records_history'&&Array.isArray(value)){
        data.applications=list(value).filter(x=>isObj(x)&&typeof x.id==='string'&&x.id&&ts(x.appliedAtMs))
          .map(x=>({
            id:x.id,appliedAtMs:Number(x.appliedAtMs),
            applicationSite:String(x.applicationSite||'UNSPECIFIED').slice(0,80),
            ...(validDate(x.scheduledDateIso)?{scheduledDateIso:x.scheduledDateIso}:{})
          })).slice(0,200);
        validEntries++;
      }else if(entry.key==='profile'&&isObj(value)){
        const medication=String(value.medication||'NONE');
        if(ts(value.updatedAtMs)&&MEDICATIONS.has(medication)){
          data.treatment={
            medication,updatedAtMs:Number(value.updatedAtMs),
            ...(typeof value.medicationDoseLabel==='string'?{medicationDoseLabel:value.medicationDoseLabel}:{}),
            ...(validDate(value.treatmentStartDateIso)?{treatmentStartDateIso:value.treatmentStartDateIso}:{}),
            history:list(value.medicationHistory).slice(0,200)
          };
        }
        validEntries++;
      }else{
        const match=/^(water|nutrition|movement):(\d{4}-\d{2}-\d{2})$/.exec(entry.key);
        if(!match||!validDate(match[2])||!isObj(value)||!ts(value.updatedAtMs))continue;
        const [,kind,date]=match;
        if(kind==='water'&&Number.isInteger(value.consumedMl)&&value.consumedMl>=0&&value.consumedMl<=20000){
          data.water.push({date,consumedMl:value.consumedMl,updatedAtMs:Number(value.updatedAtMs)});
          validEntries++;
        }else if(kind==='movement'&&Array.isArray(value.records)){
          data.movement.push({date,updatedAtMs:Number(value.updatedAtMs),records:value.records.slice(0,100)});
          validEntries++;
        }else if(kind==='nutrition'&&Array.isArray(value.meals)){
          data.nutrition.push({date,updatedAtMs:Number(value.updatedAtMs),meals:value.meals.slice(0,100)});
          validEntries++;
        }
      }
    }
    return {data,validEntries,revision:Number(snapshot.revision)||0};
  }

  function mergeByKey(primary,backup,key){
    const map=new Map();
    for(const item of list(primary)){
      if(isObj(item)&&typeof item[key]==='string'&&item[key])map.set(item[key],item);
    }
    for(const item of list(backup)){
      if(isObj(item)&&typeof item[key]==='string'&&item[key]&&!map.has(item[key]))map.set(item[key],item);
    }
    return [...map.values()];
  }
  function mergeDays(primary,backup){
    const map=new Map();
    for(const item of [...list(backup),...list(primary)]){
      if(!isObj(item)||!validDate(item.date))continue;
      const prev=map.get(item.date);
      if(!prev||Number(item.updatedAtMs||0)>=Number(prev.updatedAtMs||0)){
        map.set(item.date,item);
      }
    }
    return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date));
  }
  function mergeHistorySources(primary,backup){
    const a=isObj(primary)?primary:blank();
    const b=isObj(backup)?backup:blank();
    const primaryTreatment=isObj(a.treatment)?a.treatment:null;
    const backupTreatment=isObj(b.treatment)?b.treatment:null;
    return {
      weights:mergeByKey(a.weights,b.weights,'id'),
      measurements:mergeByKey(a.measurements,b.measurements,'date'),
      applications:mergeByKey(a.applications,b.applications,'id'),
      movement:mergeDays(a.movement,b.movement),
      nutrition:mergeDays(a.nutrition,b.nutrition),
      water:mergeDays(a.water,b.water),
      treatment:primaryTreatment&&backupTreatment
        ? (Number(primaryTreatment.updatedAtMs||0)>=Number(backupTreatment.updatedAtMs||0)
          ? primaryTreatment:backupTreatment)
        : primaryTreatment||backupTreatment,
    };
  }
  const api=Object.freeze({unpackBackup,mergeHistorySources});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.EscudoBackupBridge=api;
})(typeof window!=='undefined'?window:globalThis);
