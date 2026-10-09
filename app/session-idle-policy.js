(function(root,factory){
  const policy=factory();
  if(typeof module==='object'&&module.exports)module.exports=policy;
  root.EscudoSessionIdlePolicy=policy;
})(typeof window==='object'?window:globalThis,function(){
  const MAX_IDLE_MS=60*60*1000;
  function expired(lastActiveMs,now=Date.now()){
    const last=Number(lastActiveMs);
    if(!Number.isFinite(last)||last<=0)return false; // existing legacy session, migration-safe
    return now-last>=MAX_IDLE_MS;
  }
  return Object.freeze({MAX_IDLE_MS,expired});
});
