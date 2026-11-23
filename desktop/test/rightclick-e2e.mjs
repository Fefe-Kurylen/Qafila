// Vérification de bout en bout (lancée sur un vrai Windows par la CI) : un clic droit sur un favori de la barre,
// puis sur la zone vide de la barre, doit ouvrir le menu natif. Usage : node test/rightclick-e2e.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'qafila-e2e-'));
const port = 9400 + Math.floor(Math.random() * 400);
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  env: { ...process.env, QAFILA_E2E: '1' },
});
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => process.stderr.write(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('ÉCHEC :', msg); child.kill(); process.exit(1); };
try {
  let list = [];
  for (let i = 0; i < 40 && !list.some((t) => t.url.includes('renderer/index.html')); i++) {
    await sleep(500);
    list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
  }
  const t = list.find((x) => x.url.includes('renderer/index.html'));
  if (!t) fail('chrome introuvable');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await sleep(2500);
  await ev(`window.qafila.bookmarks.add('Wikipédia', 'https://fr.wikipedia.org')`);
  await sleep(1200);
  const rclick = async (p) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 }); };
  const bm = await ev(`(() => { const r = document.querySelector('#bmbar [data-bm]')?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!bm) fail('favori absent de la barre');
  await rclick(bm); await sleep(1500);
  if (!/contextMenu bookmark/.test(out)) fail('clic droit sur un favori : aucun menu demandé');
  if (process.platform === 'win32' && !/menu affiché/.test(out)) fail('clic droit sur un favori : menu natif non affiché');
  console.log('OK : clic droit sur un favori');
  child.kill(); process.exit(0);
} catch (e) { fail(e.stack || String(e)); }
