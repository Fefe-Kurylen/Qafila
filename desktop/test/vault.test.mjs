// Coffre du PC : formats octet pour octet identiques aux vecteurs de shared/vectors (CRYPTO.md), cycle complet
// création → verrouillage → ouverture → import → export, et lecture des favoris des autres navigateurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { Vault, internals: I } = require('../main/vault.js');
const T = require('../main/transfer.js');
const V = (f) => JSON.parse(readFileSync(new URL(`../../shared/vectors/${f}`, import.meta.url), 'utf8'));
const unhex = (s) => Buffer.from(s, 'hex');

test('coffre : Argon2id identique au vecteur de référence', async () => {
  const p = V('argon2id.json').positive[0];
  const kek = await I.argon2id(p.passphrase, unhex(p.salt), p.params);
  assert.equal(kek.toString('hex'), p.kek);
});

test('coffre : emplacements identiques aux vecteurs (passphrase, device, recovery)', () => {
  const s = V('slots.json');
  for (const p of s.positive.filter((x) => x.slot)) {
    const slot = I.wrapSlot(unhex(p.key), unhex(s.vmk), s.vaultId, p.slotId, s.keyGeneration, unhex(p.nonce));
    assert.deepEqual(slot, p.slot, p.slotId);
    assert.equal(I.unwrapSlot(unhex(p.key), p.slot, s.vaultId, s.keyGeneration).toString('hex'), s.vmk);
  }
});

test('coffre : enveloppe d\'identifiant identique au vecteur', () => {
  const r = V('records.json');
  const p = r.positive.find((x) => x.content.type === 'login');
  const env = I.encryptRecord({ vaultId: r.vaultId, id: p.envelope.id, kg: p.envelope.kg, rev: p.envelope.rev, content: p.content, key: unhex(p.key), nonce: unhex(p.nonce) });
  assert.deepEqual(env, p.envelope);
  assert.deepEqual(I.decryptRecord(p.envelope, { vaultId: r.vaultId, key: unhex(p.key) }), p.content);
});

test('coffre : création, verrouillage, mauvais mot de passe, ouverture, import, export, annulation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-'));
  const v = new Vault({ dir });
  await assert.rejects(v.create('court', false), /E_WEAK/);
  await v.create('une phrase assez longue', false);
  const id = v.add({ url: 'https://aeon.co/login', username: 'lina', password: 'Zéphyr-2026!🔑' });
  v.lock();
  assert.equal(v.status().state, 'locked');
  await assert.rejects(v.unlock('mauvaise phrase !!'), /E_WRONG/);
  const v2 = new Vault({ dir });
  await v2.unlock('une phrase assez longue');
  assert.equal(v2.reveal(id), 'Zéphyr-2026!🔑');
  const P = await import('../../shared/import/parse.mjs');
  const csv = readFileSync(new URL('../../shared/fixtures/import/chrome-passwords.csv', import.meta.url), 'utf8');
  const counts = v2.importLogins(P.parseChromeCsv(csv), P.dedupeLogins, 'Chrome');
  assert.ok(counts.added > 0);
  const again = v2.importLogins(P.parseChromeCsv(csv), P.dedupeLogins, 'Chrome');
  assert.equal(again.added, 0, 'ré-import idempotent');
  const out = v2.exportCSV();
  assert.match(out, /^name,url,username,password,note\n/);
  assert.ok(P.parseChromeCsv(out).logins.length >= counts.added);
  assert.equal(await v2.verify('une phrase assez longue'), true);
  assert.equal(await v2.verify('autre chose encore'), false);
  const before = v2.list().length;
  v2.importLogins({ logins: [{ title: 'x', origins: ['https://x.example'], username: 'u', password: 'p', note: '' }] }, P.dedupeLogins, 'test');
  assert.equal(v2.undoImport(), 1);
  assert.equal(v2.list().length, before);
});

test('transfert : LZ4 de Firefox, dates Chromium, HTML Netscape relu par l\'analyseur partagé', async () => {
  assert.equal(T.lz4Block(Buffer.from([0x40, 0x61, 0x62, 0x63, 0x64]), 4).toString(), 'abcd');
  // « aaaaaaaa » : 1 littéral puis une copie de 7 (décalage 1).
  assert.equal(T.lz4Block(Buffer.from([0x13, 0x61, 0x01, 0x00]), 8).toString(), 'aaaaaaaa');
  assert.equal(T.chromiumDate('13345678901234567'), Math.round(13345678901234567 / 1000 - 11644473600000));
  const P = await import('../../shared/import/parse.mjs');
  const html = T.bookmarksHTML([{ title: 'A & <b>', url: 'https://a.example/?x="1"', addedAt: 1700000000000 }]);
  const parsed = P.parseNetscapeHtml(html);
  assert.equal(parsed.counts.bookmarks, 1);
  assert.equal(parsed.roots[0].title, 'A & <b>');
});

test('transfert : profil Chromium lu (barre de favoris, autres, dossiers)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qc-'));
  mkdirSync(join(dir, 'Default'));
  writeFileSync(join(dir, 'Default', 'Bookmarks'), JSON.stringify({ roots: {
    bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Aeon', url: 'https://aeon.co/', date_added: '13345678901234567' }, { type: 'folder', name: 'F', children: [{ type: 'url', name: 'X', url: 'https://x.example/' }] }] },
    other: { type: 'folder', children: [{ type: 'url', name: 'JS', url: 'javascript:alert(1)' }] },
  } }));
  const list = T.readChromium(dir);
  assert.deepEqual(list.map((b) => b.url), ['https://aeon.co/', 'https://x.example/']);
});

test('favoris : dossiers conservés à l\'import Chromium et à l\'aller-retour HTML', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qc-'));
  mkdirSync(join(dir, 'Default'));
  writeFileSync(join(dir, 'Default', 'Bookmarks'), JSON.stringify({ roots: {
    bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'A', url: 'https://a.example/' }, { type: 'folder', name: 'Travail', children: [{ type: 'folder', name: 'Outils', children: [{ type: 'url', name: 'B', url: 'https://b.example/' }] }] }] },
    other: { type: 'folder', children: [{ type: 'url', name: 'C', url: 'https://c.example/' }] },
  } }));
  const list = T.readChromium(dir, { other: 'Autres', synced: 'Mobile', menu: 'Menu' });
  assert.deepEqual(list.map((b) => b.folderPath), [[], ['Travail', 'Outils'], ['Autres']]);
  const P = await import('../../shared/import/parse.mjs');
  const folders = [{ id: 'f1', name: 'Travail', parent: null }, { id: 'f2', name: 'Outils', parent: 'f1' }];
  const html = T.bookmarksHTML([{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/', folder: 'f2' }], folders);
  const parsed = P.parseNetscapeHtml(html);
  assert.equal(parsed.counts.bookmarks, 2);
  const travail = parsed.roots.find((r) => r.type === 'folder');
  assert.equal(travail.name, 'Travail');
  assert.equal(travail.children[0].name, 'Outils');
  assert.equal(travail.children[0].children[0].url, 'https://b.example/');
});
