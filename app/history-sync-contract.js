(function(root){
  'use strict';
  const DATE=/^\d{4}-\d{2}-\d{2}$/;
  const MEALS=new Set(['BREAKFAST','LUNCH','DINNER','SNACK']);
  const MEDICATIONS=new Set(['OZEMPIC','WEGOVY','MOUNJARO','SAXENDA','OTHER','NONE']);

  function countHistory(data){
    const arr=key=>Array.isArray(data?.[key])?data[key]:[];
    return {
      weights:arr('weights').length,
      measurements:arr('measurements').length,
      applications:arr('applications').length,
      movement:arr('movement').reduce((n,day)=>n+(Array.isArray(day?.records)?day.records.length:0),0),
      nutrition:arr('nutrition').reduce((n,day)=>n+(Array.isArray(day?.meals)?day.meals.length:0),0),
      treatment:data?.treatment&&typeof data.treatment==='object'?1:0,
      water:arr('water').length,
    };
  }

  function validDate(date){
    if(typeof date!=='string'||!DATE.test(date))return false;
    const d=new Date(date+'T00:00:00.000Z');
    return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
  }

  function asMeasurement(item){
    if(!validDate(item?.date))return null;
    const value=(key,alt)=> {
      const raw=item?.[key]??item?.[alt];
      return raw==null||raw===''||!Number.isFinite(Number(raw))?null:Number(raw);
    };
    return {
      date:item.date,
      waist:value('waist'),
      abdomen:value('abdomen'),
      hips:value('hips','hip'),
      chest:value('chest'),
      arm:value('arm'),
      thigh:value('thigh'),
    };
  }

  function mergeNutritionDays(localDays,remoteDays){
    const byDate=new Map();
    // Historical nutrition records represent individual meals, not an
    // authoritative snapshot of all meals in the account. A newer Android
    // day must not remove meals that were registered independently on Web.
    for(const source of [remoteDays,localDays]){
      for(const item of Array.isArray(source)?source:[]){
        if(!validDate(item?.date))continue;
        const updatedAtMs=Number(item?.updatedAtMs||0);
        const incoming=Array.isArray(item.meals)?item.meals:[];
        const existing=byDate.get(item.date);
        const deletedIds=[...new Set([
          ...(Array.isArray(existing?.deletedIds)?existing.deletedIds:[]),
          ...(Array.isArray(item?.deletedIds)?item.deletedIds:[]),
        ])];
        const removed=new Set(deletedIds);
        if(!existing){
          byDate.set(item.date,{date:item.date,updatedAtMs,
            meals:incoming.filter(meal=>!removed.has(meal?.id)),
            ...(deletedIds.length?{deletedIds}:{})});
          continue;
        }
        const joined=new Map();
        const order=updatedAtMs>=Number(existing.updatedAtMs||0)
          ? [existing.meals,incoming] : [incoming,existing.meals];
        for(const collection of order){
          for(const meal of collection){
            if(meal&&typeof meal.id==='string'&&meal.id)joined.set(meal.id,meal);
          }
        }
        for(const id of removed)joined.delete(id);
        // Backend limits 100 meals/day. Never silently truncate personal data.
        if(joined.size>100)throw new Error('HISTORY_NUTRITION_LIMIT_EXCEEDED');
        byDate.set(item.date,{
          date:item.date,updatedAtMs:Math.max(existing.updatedAtMs,updatedAtMs),
          ...(deletedIds.length?{deletedIds}:{}),
          meals:[...joined.values()].sort((a,b)=>{
            const ta=Number(a.timestampMs||Date.parse(a.at)||0);
            const tb=Number(b.timestampMs||Date.parse(b.at)||0);
            return ta-tb||String(a.id).localeCompare(String(b.id));
          })
        });
      }
    }
    return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,365);
  }

  function nutritionPatch(day){
    if(!validDate(day?.date))throw new Error('INVALID_DATE');
    const updatedAtMs=Number(day.updatedAtMs);
    if(!Number.isFinite(updatedAtMs)||updatedAtMs<=0)throw new Error('INVALID_TIMESTAMP');
    const meals=(Array.isArray(day.meals)?day.meals:[]).map(meal=>{
      const mealType=String(meal.mealType||'');
      const proteinG=Number(meal.proteinG);
      const timestampMs=Number(meal.timestampMs??new Date(meal.at).getTime());
      if(!meal.id||!MEALS.has(mealType)||!Number.isFinite(proteinG)||proteinG<=0||proteinG>1000||
        !Number.isFinite(timestampMs)||timestampMs<=0)throw new Error('INVALID_MEAL');
      const description=typeof meal.description==='string'?meal.description.slice(0,240):'';
      return {
        id:String(meal.id),mealType,proteinG,timestampMs,
        ...(description?{description}:{})
      };
    });
    if(meals.length>100)throw new Error('TOO_MANY_MEALS');
    const deletedIds=Array.isArray(day.deletedIds)?day.deletedIds.filter(id=>typeof id==='string'&&id.trim()&&id.length<=120):[];
    if(deletedIds.length>200)throw new Error('TOO_MANY_DELETIONS');
    return {date:day.date,updatedAtMs,meals,...(deletedIds.length?{deletedIds}:{})};
  }

  function treatmentPatch(raw){
    const medication=String(raw?.medication||'NONE').toUpperCase();
    const updatedAtMs=Number(raw?.updatedAtMs);
    if(!MEDICATIONS.has(medication)||!Number.isFinite(updatedAtMs)||updatedAtMs<=0)throw new Error('INVALID_TREATMENT');
    const start=String(raw?.treatmentStartDateIso||'');
    if(start&&!validDate(start))throw new Error('INVALID_TREATMENT_DATE');
    return {
      medication,updatedAtMs,
      ...(raw.medicationDoseLabel?{medicationDoseLabel:String(raw.medicationDoseLabel).slice(0,80)}:{}),
      ...(start?{treatmentStartDateIso:start}:{}),
      history:Array.isArray(raw.history)?raw.history.slice(0,200):[],
    };
  }

  const contract=Object.freeze({countHistory,validDate,asMeasurement,mergeNutritionDays,nutritionPatch,treatmentPatch});
  if(typeof module!=='undefined'&&module.exports)module.exports=contract;
  root.EscudoHistoryContract=contract;
})(typeof window!=='undefined'?window:globalThis);
