import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../app/pilot-pix/issue/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/pilot-pix/issue/issue.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../app/pilot-pix/issue/issue.mjs',import.meta.url),'utf8');

test('pilot issuer page is disconnected from network, forms, and credential scripts',()=>{
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/form-action 'none'/);
 assert.match(html,/frame-src 'none'/);
 assert.doesNotMatch(html,/<form\b/i);
 assert.doesNotMatch(html,/https:\/\/accounts\.google\.com\/gsi\/client/);
 assert.doesNotMatch(html,/<script[^>]*src="https?:\/\//i);
 assert.doesNotMatch(html,/https?:\/\/[^"'\s]+\.run\.app/i);
 assert.doesNotMatch(js,/\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)\b/);
 assert.doesNotMatch(js,/location\s*=|\.submit\(/);
 assert.match(html,/Emissão desabilitada/);
 assert.match(html,/Nenhuma cobrança pode ser feita aqui/);
});
test('fixed isolated financial scope and accessible mobile layout',()=>{
 assert.match(html,/R\$ 4,99/);
 assert.match(html,/30 dias/);
 assert.match(html,/uma ordem Pix/i);
 assert.match(html,/Premium/);
 assert.match(html,/role="status"/);
 assert.match(html,/aria-controls="detail-text"/);
 assert.match(css,/@media\(max-width:720px\)/);
});
