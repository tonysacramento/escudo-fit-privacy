import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const chart=require('../app/weight-chart.js');

const at=(day,hour=12)=>new Date(2026,9,day,hour).toISOString();
test('renders an accessible, chronological weight chart without mutating source',()=>{
  const weights=[
    {id:'last',value:100.7,at:at(8)},
    {id:'first',value:106.7,at:at(1)},
    {id:'middle',value:104.5,at:at(4)},
  ];
  const copy=JSON.stringify(weights);
  const graph=chart.build(weights);
  assert.match(graph, /<svg[^>]+role="img"/);
  assert.match(graph, /-6,0 kg no período/);
  assert.match(graph, /106,7 kg/);
  assert.match(graph, /100,7 kg/);
  assert.match(graph,/aria-label="Evolução dos últimos 3 registros/);
  assert.equal(JSON.stringify(weights),copy,'chart must not rewrite account weight records');
  assert.deepEqual(chart.pointsFrom(weights).map(p=>p.value),[106.7,104.5,100.7]);
});
test('single entry and empty history have accessible explanation',()=>{
  assert.match(chart.build([]),/Registre seu peso/);
  assert.match(chart.build([{id:'a',value:87,at:at(1)}]),/Primeiro registro/);
});
test('rejects invalid weight/time and caps drawing cost while preserving complete source',()=>{
  const weights=[{value:Infinity,at:at(3)},{value:0,at:at(4)},{value:98,at:'bad'},...Array.from({length:30},(_,i)=>({value:90+i/10,at:new Date(2026,8,i+1).toISOString()}))];
  assert.equal(chart.pointsFrom(weights).length,24);
  assert.match(chart.build(weights),/últimos 24 registros/);
  assert.equal(weights.length,33);
});
