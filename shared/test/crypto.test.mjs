// Re-dérive chaque vecteur de shared/vectors/*.json à partir des primitives de gen.mjs
// et vérifie que les vecteurs négatifs échouent avec le code d'erreur annoncé.
// Aucun réseau, aucun aléa : tout est injecté.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hkdfSync, createCipheriv } from 'node:crypto';
import * as C from '../vectors/gen.mjs';

const VEC = join(C.SHARED_DIR, 'vectors');
const load = (name) => JSON.parse(readFileSync(join(VEC, name), 'utf8'));
const { hex, unhex, utf8, b64u, unb64u } = C;

function assertFails(fn, code, label) {
  let caught = null;
  try { fn(); } catch (err) { caught = err; }
  assert.ok(caught, `${label} : aurait dû échouer`);
  assert.ok(caught instanceof C.ContractError, `${label} : erreur de contrat attendue, reçu ${caught}`);
  if (code) assert.equal(caught.code, code, `${label} : code ${caught.code} au lieu de ${code}`);
}

// ---------------------------------------------------------------------------

describe('vecteurs figés', () => {
  test('gen.mjs reproduit exactement les JSON commités', async () => {
    const all = await C.generateVectors();
    for (const [name, data] of Object.entries(all)) {
      const onDisk = load(name);
      delete onDisk.$comment;
      assert.deepEqual(onDisk, JSON.parse(JSON.stringify(data)), `${name} dérive du script`);
    }
    const files = readdirSync(VEC).filter((f) => f.endsWith('.json')).sort();
    assert.deepEqual(files, Object.keys(all).sort(), 'aucun JSON orphelin dans vectors/');
  });
});

describe('standard.json — primitives contre les vecteurs publiés', () => {
  const s = load('standard.json');
  test('HKDF-SHA256 RFC 5869 A.1', () => {
    const v = s.hkdfSha256[0];
    // sel non vide ici : on passe par hkdfSync directement via la primitive publique
    const okm = C.hkdf(unhex(v.ikm), '', v.length, unhex(v.salt));
    // la primitive hkdf() prend info en chaîne UTF-8 ; le vecteur RFC a un info binaire → recalcul explicite
    assert.equal(hex(hkdfSync('sha256', unhex(v.ikm), unhex(v.salt), unhex(v.info), v.length)), v.okm);
    assert.equal(v.okm, '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
    assert.equal(okm.length, v.length);
  });
  test('HMAC-SHA256 RFC 4231 cas 2', () => {
    const v = s.hmacSha256[0];
    assert.equal(hex(C.hmacSha256(unhex(v.key), unhex(v.data))), v.mac);
    assert.equal(v.mac, '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
  test('AES-256-GCM NIST cas 16', () => {
    const v = s.aes256Gcm[0];
    const c = createCipheriv('aes-256-gcm', unhex(v.key), unhex(v.iv)); c.setAAD(unhex(v.aad));
    const ct = Buffer.concat([c.update(unhex(v.plaintext)), c.final()]);
    assert.equal(hex(ct), v.ciphertext);
    assert.equal(hex(c.getAuthTag()), v.tag);
    assert.equal(v.tag, '76fc6ece0f4e1768cddf8853bb2d551b');
  });
  test('X25519 RFC 7748 §6.1', () => {
    const v = s.x25519[0];
    assert.equal(hex(C.x25519PublicKey(unhex(v.alicePrivate))), v.alicePublic);
    assert.equal(hex(C.x25519PublicKey(unhex(v.bobPrivate))), v.bobPublic);
    assert.equal(hex(C.x25519(unhex(v.alicePrivate), unhex(v.bobPublic))), v.shared);
    assert.equal(hex(C.x25519(unhex(v.bobPrivate), unhex(v.alicePublic))), v.shared);
    assert.equal(v.shared, '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  });
  test('SHA-256 "abc"', () => {
    assert.equal(s.sha256[0].digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('canonical-json.json', () => {
  const v = load('canonical-json.json');
  test('positifs', () => {
    for (const p of v.positive) {
      assert.equal(C.canonicalJson(p.input), p.canonical);
      assert.deepEqual(JSON.parse(p.canonical), p.input, 'le canonique se ré-analyse en la même valeur');
    }
  });
  test('ordre UTF-16 : "a😀" avant "a\\uFFFF"', () => {
    assert.equal(C.canonicalJson({ 'a￿': 2, 'a\u{1F600}': 1 }), '{"a😀":1,"a￿":2}');
  });
  test('négatifs', () => {
    for (const n of v.negative) assertFails(() => C.canonicalJson(JSON.parse(n.inputJson)), n.error, n.name);
    assertFails(() => C.canonicalJson({ x: 'a\ud800b' }), 'E_CANONICAL', 'substitut isolé');
  });
});

describe('padding.json', () => {
  const v = load('padding.json');
  test('positifs : bourrage et débourrage', () => {
    for (const p of v.positive) {
      const padded = C.pad(unhex(p.inputHex));
      assert.equal(hex(padded), p.paddedHex, p.name);
      assert.equal(padded.length, p.paddedLength);
      assert.equal(padded.length % 256, 0);
      assert.equal(hex(C.unpad(padded)), p.inputHex);
    }
  });
  test('négatifs', () => {
    for (const n of v.negative) assertFails(() => C.unpad(unhex(n.paddedHex)), n.error, n.name);
  });
});

describe('argon2id.json', () => {
  const v = load('argon2id.json');
  test('positifs : NFC et NFD donnent la même clé', async () => {
    for (const p of v.positive) {
      assert.deepEqual(p.params, C.KDF_PARAMS);
      assert.equal(hex(utf8(p.passphrase.normalize('NFC'))), p.passphraseNfcUtf8Hex);
      assert.equal(hex(await C.argon2id(p.passphrase, unhex(p.salt))), p.kek, p.name);
      assert.equal(hex(await C.argon2id(p.passphraseNfd, unhex(p.salt))), p.kek, `${p.name} (entrée NFD)`);
    }
  });
  test('négatif : octets NFD bruts (sans normalisation) donnent une autre clé', async () => {
    const n = v.negative[0];
    const raw = await C.argon2idRaw(unhex(n.passwordUtf8Hex), unhex(n.salt));
    assert.equal(hex(raw), n.kekWithoutNfc);
    assert.notEqual(hex(raw), n.mustDifferFrom);
  });
  test('paramètres plus faibles refusés', async () => {
    await assert.rejects(C.argon2id('x', Buffer.alloc(16), { alg: 'argon2id', m: 32768, t: 3, p: 1 }), /E_KDF/);
    await assert.rejects(C.argon2id('x', Buffer.alloc(16), { alg: 'argon2id', m: 65536, t: 2, p: 1 }), /E_KDF/);
    await assert.rejects(C.argon2id('x', Buffer.alloc(16), { alg: 'argon2id', m: 65536, t: 3, p: 2 }), /E_KDF/);
    await assert.rejects(C.argon2id('x', Buffer.alloc(15)), /E_KDF/);
  });
});

describe('hkdf.json — hiérarchie des clés', () => {
  const v = load('hkdf.json');
  test('sous-clés', () => {
    const vmk = unhex(v.vmk); const rk = unhex(v.rk);
    const keys = C.deriveTierKeys(vmk);
    const byName = Object.fromEntries(v.derived.map((d) => [d.name, d]));
    assert.equal(hex(keys.secrets), byName.K_secrets.okm);
    assert.equal(hex(keys.data), byName.K_data.okm);
    assert.equal(hex(keys.sync), byName.K_sync.okm);
    assert.equal(hex(keys.export), byName.K_export.okm);
    assert.equal(hex(keys.previousKeys), byName.K_previous.okm);
    assert.equal(keys.vaultId, byName.vaultId.okm);
    assert.equal(byName.vaultId.ikmHex, hex(keys.sync));
    assert.equal(hex(C.recoveryKey(rk)), byName.K_recovery.okm);
    assert.equal(C.recoveryToken(rk), byName.recoveryToken.okm);
    for (const d of v.derived) {
      const ikm = d.ikm === 'vmk' ? vmk : d.ikm === 'rk' ? rk : unhex(d.ikmHex);
      assert.equal(hex(C.hkdf(ikm, d.info, d.length)), d.okm, d.name);
      assert.match(d.info, /^qafila\/v1\/[a-z0-9-]+$/);
    }
    assert.equal(new Set(v.derived.map((d) => d.okm)).size, v.derived.length, 'toutes les sous-clés distinctes');
  });
});

describe('slots.json — emplacements', () => {
  const v = load('slots.json');
  test('enveloppement et désenveloppement', () => {
    const vmk = unhex(v.vmk);
    for (const p of v.positive) {
      if (p.entry) {
        const entry = C.wrapPreviousKey({ currentVmk: vmk, oldVmk: unhex(p.plaintext), vaultId: v.vaultId, kgOld: 2, kgCurrent: v.keyGeneration, nonce: unhex(p.nonce) });
        assert.deepEqual(entry, p.entry);
        assert.equal(C.previousKeyAad(v.vaultId, 2, v.keyGeneration), p.aad);
        assert.equal(hex(C.unwrapPreviousKey({ currentVmk: vmk, entry, vaultId: v.vaultId, kgCurrent: v.keyGeneration })), p.plaintext);
        continue;
      }
      const slot = C.wrapSlot({ key: unhex(p.key), vmk, vaultId: v.vaultId, slotId: p.slotId, kg: v.keyGeneration, nonce: unhex(p.nonce) });
      assert.deepEqual(slot, p.slot, p.slotId);
      assert.equal(C.slotAad(v.vaultId, p.slotId, v.keyGeneration), p.aad);
      assert.equal(hex(C.unwrapSlot({ key: unhex(p.key), slot, vaultId: v.vaultId, kg: v.keyGeneration })), v.vmk);
      assert.equal(unb64u(slot.ct).length, 48);
    }
  });
  test('KEK du vecteur = Argon2id de la phrase de référence', async () => {
    const p = v.positive[0];
    assert.equal(hex(await C.argon2id('qafila-vecteur-test', unhex(p.salt))), p.key);
  });
  test('clé recovery = HKDF(RK)', () => {
    const p = v.positive.find((x) => x.slotId === 'recovery');
    assert.equal(hex(C.recoveryKey(unhex(p.rk))), p.key);
  });
  test('négatifs', () => {
    for (const n of v.negative) {
      assertFails(() => C.unwrapSlot({ key: unhex(n.key), slot: n.slot, vaultId: n.vaultId, kg: n.keyGeneration }), n.error, n.name);
    }
    assertFails(() => C.unwrapPreviousKey({ currentVmk: unhex(v.vmk), entry: { ...v.positive[3].entry, kg: 3 }, vaultId: v.vaultId, kgCurrent: 3 }), 'E_KEYGEN', 'previousKeys : kg ≥ courant');
  });
});

describe('header.json — en-tête local et public', () => {
  const v = load('header.json');
  test('reconstruction', () => {
    const slots = load('slots.json');
    const h = C.buildLocalHeader({
      vaultId: slots.vaultId, createdAt: v.inputs.createdAt, keyGeneration: slots.keyGeneration, salt: unhex(v.inputs.salt),
      slots: slots.positive.filter((p) => p.slot).map((p) => p.slot), previousKeys: [slots.positive[3].entry],
    });
    assert.deepEqual(h, v.header);
    assert.equal(C.canonicalJson(h), v.headerCanonical);
    assert.deepEqual(C.publicHeader(h), v.publicHeader);
    assert.deepEqual(Object.keys(v.publicHeader).sort(), ['createdAt', 'keyGeneration', 'slots', 'v', 'vaultId']);
    assert.deepEqual(v.publicHeader.slots.map((s) => s.id), ['recovery']);
    assert.equal(C.deriveTierKeys(unhex(v.inputs.vmk)).vaultId, v.header.vaultId, 'vaultId dérivé de la VMK');
    assert.equal(C.vaultCode(v.header.vaultId), v.vaultCode);
    assert.equal(C.recoveryUrl({ server: 'https://sync.qafila.fr', vaultId: v.header.vaultId, rk: unhex(v.inputs.rk) }), v.recoveryUrl);
  });
  test('tous les emplacements s\'ouvrent sur la même VMK', async () => {
    const h = v.header; const vmk = v.inputs.vmk;
    const open = (id, key) => hex(C.unwrapSlot({ key, slot: h.slots.find((s) => s.id === id), vaultId: h.vaultId, kg: h.keyGeneration }));
    assert.equal(open('passphrase', await C.argon2id(v.inputs.passphrase, unb64u(h.kdf.salt))), vmk);
    assert.equal(open('device', unhex(v.inputs.duk)), vmk);
    assert.equal(open('recovery', C.recoveryKey(unhex(v.inputs.rk))), vmk);
    assert.equal(hex(C.unwrapPreviousKey({ currentVmk: unhex(vmk), entry: h.previousKeys[0], vaultId: h.vaultId, kgCurrent: h.keyGeneration })), v.inputs.vmkPrevious.vmk);
  });
});

describe('records.json — enveloppes', () => {
  const v = load('records.json');
  const keys = { secrets: unhex(v.keys.secrets), data: unhex(v.keys.data) };
  const keys2 = { secrets: unhex(v.keysPrevious.secrets), data: unhex(v.keysPrevious.data) };
  const keyForKg = (kg) => (kg === v.keyGeneration ? keys : kg === v.keysPrevious.kg ? keys2 : null);
  test('chiffrement reproduit les enveloppes', () => {
    for (const p of v.positive) {
      const e = p.envelope;
      assert.equal(C.canonicalJson(p.content), p.contentCanonical, p.name);
      assert.equal(hex(C.pad(utf8(p.contentCanonical))), p.paddedHex);
      assert.equal(C.recordAad(v.vaultId, e.id, e.tier, e.kg, e.rev), p.aad);
      const env = C.encryptRecord({ vaultId: v.vaultId, id: e.id, tier: e.tier, kg: e.kg, rev: e.rev, nonce: unhex(p.nonce), content: p.content, key: unhex(p.key) });
      assert.deepEqual(env, e, p.name);
      assert.equal(C.canonicalJson(env), p.envelopeCanonical);
      assert.equal(e.del, p.content.deleted);
      assert.equal((unb64u(e.ct).length - 16) % 256, 0, 'ct = multiple de 256 + tag');
    }
  });
  test('déchiffrement et validation', () => {
    for (const p of v.positive) {
      const content = C.decryptRecord(p.envelope, { vaultId: v.vaultId, keyForKg });
      assert.deepEqual(content, p.content, p.name);
      assert.equal(C.TYPE_TIER[content.type], p.envelope.tier);
    }
  });
  test('tombstone = {"deleted":true,"type":…} bourré à 256', () => {
    const t = v.positive.find((p) => p.content.deleted);
    assert.equal(t.contentCanonical, '{"deleted":true,"type":"login"}');
    assert.equal(unb64u(t.envelope.ct).length, 256 + 16);
    assert.equal(t.envelope.del, true);
  });
  test('négatifs', () => {
    for (const n of v.negative) {
      assertFails(() => C.decryptRecord(n.envelope, { vaultId: n.vaultId ?? v.vaultId, keyForKg }), n.error, n.name);
    }
  });
  test('chiffrer un type au mauvais niveau est refusé', () => {
    const p = v.positive[0];
    assertFails(() => C.encryptRecord({ vaultId: v.vaultId, id: p.envelope.id, tier: 2, kg: 3, rev: p.envelope.rev, nonce: unhex(p.nonce), content: p.content, key: keys.data }), 'E_TIER', 'login au niveau 2');
  });
});

describe('recovery-kit.json — 24 mots et code du coffre', () => {
  const v = load('recovery-kit.json');
  const wordlist = C.loadWordlist();
  test('liste de mots', () => {
    assert.equal(wordlist.length, 2048);
    assert.equal(new Set(wordlist).size, 2048);
    assert.equal(hex(C.sha256(readFileSync(join(C.SHARED_DIR, 'bip39-french.txt')))), v.wordlist.sha256);
    assert.equal(wordlist[0], v.wordlist.first);
    assert.equal(wordlist[2047], v.wordlist.last);
    for (const w of wordlist) assert.equal(w, w.normalize('NFC'), 'liste stockée en NFC');
  });
  test('encodage / décodage', () => {
    for (const p of v.positive) {
      const words = C.mnemonicEncode(unhex(p.rk), wordlist);
      assert.deepEqual(words, p.words, p.name);
      assert.equal(words.join(' '), p.sentence);
      assert.equal(hex(C.sha256(unhex(p.rk)).subarray(0, 1)), p.checksumByte);
      assert.equal(hex(C.mnemonicDecode(p.words, wordlist)), p.rk);
      assert.equal(hex(C.mnemonicDecode(p.sentenceNfd.split(' '), wordlist)), p.rk, 'saisie NFD acceptée');
      assert.equal(hex(C.mnemonicDecode(p.words.map((w) => ` ${w.toUpperCase()} `), wordlist)), p.rk, 'casse et espaces tolérés');
    }
  });
  test('négatifs', () => {
    for (const n of v.negative) assertFails(() => C.mnemonicDecode(n.words, wordlist), n.error, n.name);
  });
  test('code du coffre (Crockford)', () => {
    for (const c of v.vaultCode) {
      assert.equal(C.crockfordEncode(unhex(c.vaultId)), c.compact);
      assert.equal(C.vaultCode(c.vaultId), c.code);
      assert.match(c.code, /^[0-7][0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
      assert.equal(hex(C.crockfordDecode(c.code)), c.vaultId);
      assert.equal(hex(C.crockfordDecode(c.compact.toLowerCase().replace(/0/g, 'o'))), c.vaultId, 'O/o → 0 tolérés');
    }
    for (const n of v.vaultCodeNegative) assertFails(() => C.crockfordDecode(n.code), n.error, n.name);
  });
});

describe('bearer-token.json — jetons porteurs', () => {
  const v = load('bearer-token.json');
  test('jeton et hachage', () => {
    for (const p of v.positive) {
      assert.match(p.token, /^[0-9a-f]{64}$/);
      assert.equal(C.tokenHash(p.token), p.tokenHash);
      assert.equal(hex(C.sha256(utf8(p.token))), p.tokenHash);
      assert.equal(p.authorizationHeader, `Bearer ${p.token}`);
    }
    assert.equal(C.bearerToken(unhex(v.positive[0].key)), v.positive[0].token);
  });
  test('négatifs', () => {
    for (const n of v.negative) {
      if (n.operation === 'compare') { assert.notEqual(n.rawHash, n.tokenHash); continue; }
      assertFails(() => C.tokenHash(n.token), n.error, n.name);
    }
  });
});

describe('pairing.json — appairage', () => {
  const v = load('pairing.json');
  test('dérivations', () => {
    const nN = unhex(v.new.privateKey); const nE = unhex(v.existing.privateKey);
    const pkN = C.x25519PublicKey(nN); const pkE = C.x25519PublicKey(nE);
    assert.equal(hex(pkN), v.new.publicKey);
    assert.equal(hex(pkE), v.existing.publicKey);
    assert.equal(b64u(pkN), v.new.publicKeyB64u);
    const shared = C.x25519(nE, pkN);
    assert.equal(hex(shared), v.sharedSecret);
    assert.equal(hex(C.x25519(nN, pkE)), v.sharedSecret);
    assert.equal(C.pairingSlot(pkN), v.slot);
    assert.equal(hex(Buffer.concat([pkN, pkE])), v.hkdfInfoSuffix);
    assert.equal(hex(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.concat([utf8('qafila/v1/pair'), pkN, pkE]), 32)), v.k, 'info = chaîne || pkN || pkE, sel vide');
    const d = C.pairingDerive(shared, pkN, pkE);
    assert.equal(hex(d.k), v.k); assert.equal(hex(d.kMac), v.kMac); assert.equal(hex(d.kRead), v.kRead);
    assert.equal(d.sas, v.sas);
    assert.match(v.sas, /^[0-9]{6}$/);
    assert.equal(String(unhex(v.sasBytes).readUInt32BE(0) % 1000000).padStart(6, '0'), v.sas);
    assert.equal(unhex(v.sasBytes).length, 32);
    assert.equal(hex(C.hmacSha256(d.kMac, Buffer.concat([pkN, pkE, unb64u(v.packet.ct)]))), hex(unb64u(v.packet.mac)), 'mac = HMAC(K_mac, pkN||pkE||ct)');
    assert.equal(hex(C.pairingReadProof(d.kRead, pkN)), v.readProof);
    assert.equal(C.pairingAad(v.slot), v.aad);
  });
  test('scellement et ouverture du paquet', () => {
    const nN = unhex(v.new.privateKey); const nE = unhex(v.existing.privateKey);
    const packet = C.pairingSeal({ nE, pkN: C.x25519PublicKey(nN), nonce: unhex(v.nonce), payload: v.payload });
    assert.deepEqual(packet, v.packet);
    assert.equal(C.canonicalJson(v.payload), v.payloadCanonical);
    const { payload, sas } = C.pairingOpen({ nN, packet });
    assert.deepEqual(payload, v.payload);
    assert.equal(sas, v.sas);
    assert.equal(b64u(unb64u(payload.vmk)), payload.vmk);
    assert.equal(unb64u(payload.vmk).length, 32);
  });
  test('négatifs', () => {
    const nN = unhex(v.new.privateKey);
    for (const n of v.negative) {
      if (n.operation === 'compare') {
        assert.notEqual(n.sas, n.mustDifferFrom, n.name);
        const pkN = C.x25519PublicKey(nN);
        const d = C.pairingDerive(C.x25519(unhex(n.attacker.privateKey), pkN), pkN, unhex(n.attacker.publicKey));
        assert.equal(d.sas, n.sas);
        continue;
      }
      assertFails(() => C.pairingOpen({ nN, packet: n.packet }), n.error, n.name);
    }
  });
});

describe('backup.json — sauvegarde .qafila', () => {
  const v = load('backup.json');
  test('construction et vérification', async () => {
    const kek = await C.argon2id(v.passphrase, unhex(v.exportSalt));
    assert.equal(hex(kek), v.exportKek);
    const slots = load('slots.json');
    const vmk = unhex(slots.vmk);
    const slot = C.wrapSlot({ key: kek, vmk, vaultId: v.backup.vaultId, slotId: 'export', kg: v.backup.keyGeneration, nonce: unhex(v.exportNonce) });
    assert.deepEqual(slot, v.backup.slot);
    assert.equal(C.slotAad(v.backup.vaultId, 'export', v.backup.keyGeneration), v.exportSlotAad);
    const kExport = C.deriveTierKeys(vmk).export;
    assert.equal(hex(kExport), v.kExport);
    const built = C.buildBackup({ vaultId: v.backup.vaultId, keyGeneration: v.backup.keyGeneration, salt: unhex(v.exportSalt), slot, records: [...v.backup.records].reverse(), kExport });
    assert.deepEqual(built, v.backup, 'ordre des enregistrements normalisé par id');
    const { mac, ...body } = v.backup;
    assert.equal(C.canonicalJson(body), v.macInputCanonical);
    assert.ok(C.verifyBackupMac(v.backup, kExport));
    assert.equal(hex(C.unwrapSlot({ key: kek, slot: v.backup.slot, vaultId: v.backup.vaultId, kg: v.backup.keyGeneration })), slots.vmk);
  });
  test('négatifs', () => {
    for (const n of v.negative) assertFails(() => C.verifyBackupMac(n.backup, unhex(v.kExport)), n.error, n.name);
  });
});

describe('schemas/ — fichiers JSON Schema', () => {
  const dir = join(C.SHARED_DIR, 'schemas');
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  test('présents, analysables, draft 2020-12, $id cohérent', () => {
    const expected = ['backup', 'common', 'pairing-packet', 'record-bookmark', 'record-device', 'record-envelope', 'record-folder', 'record-login', 'record-setting', 'record', 'slot', 'vault-header'];
    assert.deepEqual(files.map((f) => f.replace('.schema.json', '')), expected);
    for (const f of files) {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema', f);
      assert.equal(s.$id, `https://qafila.fr/schemas/v1/${f}`, f);
      assert.ok(s.title && s.description, `${f} : titre et description`);
    }
  });
  test('les motifs des schémas acceptent les vecteurs', () => {
    const common = JSON.parse(readFileSync(join(dir, 'common.schema.json'), 'utf8')).$defs;
    const re = (d) => new RegExp(d.pattern);
    const rec = load('records.json');
    for (const p of rec.positive) {
      assert.match(p.envelope.id, re(common.uuid));
      assert.match(p.envelope.rev, re(common.rev));
      assert.match(p.envelope.n, re(common.nonce));
      assert.match(p.envelope.ct, /^[A-Za-z0-9_-]{363,}$/);
    }
    assert.match(rec.vaultId, re(common.vaultId));
    const h = load('header.json').header;
    assert.match(h.kdf.salt, re(common.kdf.properties.salt));
    for (const s of h.slots) { assert.match(s.n, re(common.nonce)); assert.match(s.ct, /^[A-Za-z0-9_-]{64}$/); }
    const b = load('backup.json').backup;
    assert.match(b.mac, /^[A-Za-z0-9_-]{43}$/);
    const pk = load('pairing.json').packet;
    for (const k of ['pkN', 'pkE', 'mac']) assert.match(pk[k], /^[A-Za-z0-9_-]{43}$/);
  });
});
