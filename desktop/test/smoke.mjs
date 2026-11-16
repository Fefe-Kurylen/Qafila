#!/usr/bin/env node
// Test de fumée : lance Qafila sous xvfb avec --smoke=<dossier> (onglets de démonstration, captures d'écran de la
// fenêtre : page, menu, onglets, réglages, sombre), vérifie le code de sortie 0 et la présence des PNG.
// Usage : node test/smoke.mjs [dossier]   (défaut : /tmp/qafila-smoke)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || '/tmp/qafila-smoke');
rmSync(out, { recursive: true, force: true });

const expected = ['01-page', '02-menu', '03-tabs', '04-settings', '05-dark', '06-dark-menu', '07-chrome-strip'];
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const electronArgs = ['electron', '.', '--no-sandbox', `--smoke=${out}`];
const [cmd, args] = useXvfb ? ['xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', 'npx', ...electronArgs]] : ['npx', electronArgs];

const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
const timer = setTimeout(() => { console.error('Smoke : délai dépassé (120 s)'); child.kill('SIGKILL'); }, 120_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  const missing = expected.filter((n) => { const f = join(out, `${n}.png`); return !existsSync(f) || statSync(f).size < 2000; });
  let report = null;
  try { report = JSON.parse(readFileSync(join(out, 'smoke.json'), 'utf8')); } catch { /* absent */ }
  if (code !== 0 || missing.length || !report || report.errors.length) {
    console.error(`Smoke ÉCHEC : code ${code}, captures manquantes : ${missing.join(', ') || 'aucune'}, erreurs : ${report ? report.errors.join(' | ') || 'aucune' : 'pas de rapport'}`);
    process.exit(1);
  }
  console.log(`Smoke OK : ${expected.length} captures dans ${out} (${report.state.tabs.length} onglets).`);
});
