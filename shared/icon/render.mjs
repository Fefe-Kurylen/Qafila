#!/usr/bin/env node
// Rendu SVG -> PNG avec le Chromium préinstallé (Playwright).
// Usage :
//   node render.mjs png   <in.svg> <out.png> <taille> [--opaque=#ffffff]   (une image carrée)
//   node render.mjs sheet <out.png> <a.svg> [b.svg ...]                      (planche : 1024→16 px, fonds clair/sombre, écran d'accueil)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const [mode, ...rest] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const uri = (f) => 'data:image/svg+xml;base64,' + Buffer.from(readFileSync(f)).toString('base64');
if (mode === 'png') {
  const [inp, out, sizeS, ...opts] = rest; const size = +sizeS;
  const opaque = (opts.find((o) => o.startsWith('--opaque=')) || '').split('=')[1];
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${opaque || 'transparent'}"><img src="${uri(inp)}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: out, omitBackground: !opaque, clip: { x: 0, y: 0, width: size, height: size } });
} else if (mode === 'sheet') {
  const [out, ...svgs] = rest; const sizes = [256, 120, 64, 48, 32, 24, 16];
  const row = (f, bg, fg) => `<div style="display:flex;align-items:flex-end;gap:18px;padding:14px 18px;background:${bg};color:${fg};font:12px system-ui">
    <div style="width:150px;word-break:break-all">${f.split('/').pop()}</div>${sizes.map((s) => `<div style="text-align:center"><img src="${uri(f)}" width="${s}" height="${s}" style="display:block"><div>${s}</div></div>`).join('')}</div>`;
  const html = svgs.map((f) => row(f, '#f2f2f7', '#333') + row(f, '#1c1c1e', '#ccc') + row(f, 'linear-gradient(135deg,#5b7fa6,#c58fa8)', '#fff')).join('<div style="height:10px"></div>');
  await page.setViewportSize({ width: 1100, height: 400 });
  await page.setContent(`<html><body style="margin:0;background:#fff">${html}</body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: out, fullPage: true });
}
await browser.close();
console.log('ok', mode === 'png' ? rest[1] : rest[0]);
