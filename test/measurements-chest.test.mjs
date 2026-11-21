import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');

test('measurements form asks for chest (Tórax) instead of abdomen', () => {
  assert.ok(!html.includes('id="mAbdomen"'));
  const order = ['mWaist', 'mChest', 'mHip', 'mArm', 'mThigh'].map(id => html.indexOf(`id="${id}"`));
  assert.ok(order.every(i => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, />Tórax <small class="muted">\(na altura do peito\)<\/small><input id="mChest"/);
  assert.ok(!app.includes("$('mAbdomen')"));
});

test('older abdomen records still have a label in the history', () => {
  assert.match(app, /\['abdomen','Abdômen'\]\];/);
});
