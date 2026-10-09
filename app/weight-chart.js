/* Historical trend only; no prediction or health inference. */
(function(root,factory){
  const chart=factory();
  if(typeof module==='object'&&module.exports)module.exports=chart;
  root.EscudoWeightChart=chart;
})(typeof window==='object'?window:globalThis,function(){
  const formatKg=n=>n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' kg';
  const pointsFrom=records=>(Array.isArray(records)?records:[])
    .map(w=>({value:Number(w?.value),at:Date.parse(w?.at||'')}))
    .filter(w=>Number.isFinite(w.value)&&w.value>=20&&w.value<=400&&Number.isFinite(w.at))
    .sort((a,b)=>a.at-b.at)
    .slice(-24);
  function build(records){
    const points=pointsFrom(records);
    if(!points.length)return '<p class="muted">Registre seu peso para acompanhar a evolução no gráfico.</p>';
    const latest=points[points.length-1],first=points[0];
    const delta=latest.value-first.value;
    const deltaLabel=points.length<2?'Primeiro registro':(delta>0?'+':'')+
      delta.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' kg no período';
    const single=points.length===1;
    const width=640,height=226,left=56,right=18,top=23,bottom=40;
    const values=points.map(x=>x.value);
    const low=Math.min(...values),high=Math.max(...values);
    const margin=Math.max(0.8,(high-low)*0.14);
    const yMin=low-margin,yMax=high+margin;
    const xAt=i=>single?(left+width-right)/2:left+(i/(points.length-1))*(width-left-right);
    const yAt=val=>top+(yMax-val)/(yMax-yMin)*(height-top-bottom);
    const coord=n=>Number(n.toFixed(1));
    const xs=points.map((p,i)=>coord(xAt(i)));
    const ys=points.map(p=>coord(yAt(p.value)));
    const grid=[0,0.5,1].map(f=>{
      const y=coord(top+f*(height-top-bottom));
      return '<line x1="'+left+'" y1="'+y+'" x2="'+(width-right)+'" y2="'+y+'" stroke="#31565B" stroke-width="1"/>'+
        '<text x="'+(left-10)+'" y="'+(y+4)+'" fill="#A3C4C8" text-anchor="end" font-size="13">'+
        formatKg(yMax-f*(yMax-yMin)).replace(' kg','')+'</text>';
    }).join('');
    const path=points.map((_,i)=>(i?'L':'M')+xs[i]+' '+ys[i]).join(' ');
    const dots=points.map((p,i)=>'<circle cx="'+xs[i]+'" cy="'+ys[i]+
      '" r="'+(i===points.length-1?6:4)+'" fill="#FFD17B" stroke="#08282D" stroke-width="2">'+
      '<title>'+new Date(p.at).toLocaleDateString('pt-BR')+': '+formatKg(p.value)+'</title></circle>').join('');
    const labels=[0,points.length-1].filter((x,i,a)=>a.indexOf(x)===i)
      .map(i=>'<text x="'+xs[i]+'" y="'+(height-10)+'" fill="#A3C4C8" text-anchor="'+
        (i===0?'start':'end')+'" font-size="13">'+
        new Date(points[i].at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+'</text>').join('');
    return '<div class="weight-chart-head"><strong>'+formatKg(latest.value)+
      '</strong><span>'+deltaLabel+'</span></div>'+
      '<svg class="weight-trend-svg" viewBox="0 0 '+width+' '+height+
      '" role="img" aria-label="Evolução dos últimos '+points.length+' registros de peso. '+deltaLabel+'.">'+
      grid+(single?'':'<path d="'+path+'" fill="none" stroke="#56DDE2" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>')+
      dots+labels+'</svg>'+
      '<small class="muted">Registros confirmados ou preservados localmente, em ordem cronológica. O gráfico não altera o histórico.</small>';
  }
  return Object.freeze({build,pointsFrom});
});
