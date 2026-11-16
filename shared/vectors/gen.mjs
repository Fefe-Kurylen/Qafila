#!/usr/bin/env node
// Qafila — implémentation de référence du contrat cryptographique (shared/CRYPTO.md)
// et générateur des vecteurs de test figés dans shared/vectors/*.json.
//
// Tout l'aléa est INJECTÉ (nonces, sels, clés, scalaires éphémères) : ce fichier ne tire
// jamais de nombre aléatoire. Il n'est pas un composant de production ; il sert à produire
// les vecteurs et à les re-dériver dans shared/test/crypto.test.mjs.
//
// Exécution : `cd shared && npm run vectors` (ré-écrit les JSON ; ils doivent rester identiques).

import {
  createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync,
  createPrivateKey, createPublicKey, diffieHellman,
} from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { argon2id as wasmArgon2id } from 'hash-wasm';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHARED_DIR = resolve(HERE, '..');

// ---------------------------------------------------------------------------
// Constantes du contrat
// ---------------------------------------------------------------------------

export const CONTRACT_VERSION = 1;
export const PREFIX = 'qafila/v1';
export const PAD_BLOCK = 256;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;
export const SALT_BYTES = 16;
export const KDF_PARAMS = { alg: 'argon2id', m: 65536, t: 3, p: 1 };

export const INFO = {
  secrets: `${PREFIX}/tier1-secrets`,
  data: `${PREFIX}/tier2-data`,
  sync: `${PREFIX}/sync-token`,
  export: `${PREFIX}/export`,
  vaultId: `${PREFIX}/vault-id`,
  previousKeys: `${PREFIX}/previous-keys`,
  recovery: `${PREFIX}/recovery`,
  recoveryAuth: `${PREFIX}/recovery-auth`,
  pair: `${PREFIX}/pair`,
  pairMac: `${PREFIX}/pair-mac`,
  pairSas: `${PREFIX}/pair-sas`,
  pairRead: `${PREFIX}/pair-read`,
};

export const SLOT_IDS = ['passphrase', 'device', 'recovery', 'export'];
export const TYPE_TIER = { login: 1, bookmark: 2, folder: 2, setting: 2, device: 2, tabs: 2 };

export const RE = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  vaultId: /^[0-9a-f]{32}$/,
  rev: /^[0-9]{13}-[0-9a-f]{4}-[0-9a-f]{4}$/,
  deviceId: /^[0-9a-f]{8}$/,
  hex32: /^[0-9a-f]{64}$/,
  b64u: /^[A-Za-z0-9_-]*$/,
};

export class ContractError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}
const fail = (code, message) => { throw new ContractError(code, message); };

// ---------------------------------------------------------------------------
// Encodages
// ---------------------------------------------------------------------------

export const hex = (b) => Buffer.from(b).toString('hex');
export const unhex = (s) => Buffer.from(s, 'hex');
export const utf8 = (s) => Buffer.from(s, 'utf8');

/** base64url sans `=` (RFC 4648 §5). */
export const b64u = (b) => Buffer.from(b).toString('base64url');

/** Décodage strict : alphabet url, pas de `=`, longueur et bits de queue canoniques. */
export function unb64u(s) {
  if (typeof s !== 'string' || !RE.b64u.test(s) || s.length % 4 === 1) fail('E_BASE64URL', 'chaîne base64url invalide');
  const out = Buffer.from(s, 'base64url');
  if (b64u(out) !== s) fail('E_BASE64URL', 'base64url non canonique');
  return out;
}

/** JSON canonique : clés triées (unités UTF-16), sans espace, entiers seulement, UTF-8 brut. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('E_CANONICAL', `nombre non entier ou hors borne : ${value}`);
    return value === 0 ? '0' : String(value);
  }
  if (typeof value === 'string') {
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)) fail('E_CANONICAL', 'substitut UTF-16 isolé');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  fail('E_CANONICAL', `type non représentable : ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const sha256 = (b) => createHash('sha256').update(b).digest();
export const hmacSha256 = (key, data) => createHmac('sha256', key).update(data).digest();

/** HKDF-SHA256, sel vide par défaut. */
export function hkdf(ikm, info, length = KEY_BYTES, salt = Buffer.alloc(0)) {
  return Buffer.from(hkdfSync('sha256', ikm, salt, utf8(info), length));
}

/** Argon2id : la phrase est normalisée NFC puis encodée UTF-8. Paramètres en Kio. */
export async function argon2id(passphrase, salt, params = KDF_PARAMS) {
  if (params.alg !== 'argon2id') fail('E_KDF', `algorithme inconnu : ${params.alg}`);
  if (params.m < KDF_PARAMS.m || params.t < KDF_PARAMS.t || params.p !== 1) fail('E_KDF', 'paramètres Argon2id trop faibles');
  if (salt.length !== SALT_BYTES) fail('E_KDF', 'sel de 16 octets attendu');
  return argon2idRaw(utf8(passphrase.normalize('NFC')), salt, params);
}

/** Variante sur octets bruts (sans normalisation) : sert aux vecteurs négatifs NFD. */
export async function argon2idRaw(passwordBytes, salt, params = KDF_PARAMS) {
  const out = await wasmArgon2id({
    password: passwordBytes, salt, parallelism: params.p, iterations: params.t,
    memorySize: params.m, hashLength: KEY_BYTES, outputType: 'binary',
  });
  return Buffer.from(out);
}

/** Bourrage : données || 0x80 || 0x00… jusqu'à un multiple de 256 (au moins un octet ajouté). */
export function pad(bytes) {
  const len = bytes.length + 1;
  const total = Math.ceil(len / PAD_BLOCK) * PAD_BLOCK;
  const out = Buffer.alloc(total, 0);
  out.set(bytes, 0);
  out[bytes.length] = 0x80;
  return out;
}

export function unpad(padded) {
  if (padded.length === 0 || padded.length % PAD_BLOCK !== 0) fail('E_PADDING', 'longueur non multiple de 256');
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0x00) i--;
  if (i < 0 || padded[i] !== 0x80) fail('E_PADDING', 'marqueur 0x80 absent');
  return padded.subarray(0, i);
}

/** AES-256-GCM ; retourne ciphertext || tag (16 o). */
export function aesGcmEncrypt(key, nonce, aad, plaintext) {
  if (key.length !== KEY_BYTES) fail('E_KEY', 'clé de 32 octets attendue');
  if (nonce.length !== NONCE_BYTES) fail('E_NONCE', 'nonce de 12 octets attendu');
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  c.setAAD(utf8(aad));
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

export function aesGcmDecrypt(key, nonce, aad, ctTag) {
  if (key.length !== KEY_BYTES) fail('E_KEY', 'clé de 32 octets attendue');
  if (nonce.length !== NONCE_BYTES) fail('E_NONCE', 'nonce de 12 octets attendu');
  if (ctTag.length < TAG_BYTES) fail('E_AEAD', 'message trop court');
  const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  d.setAAD(utf8(aad));
  d.setAuthTag(ctTag.subarray(ctTag.length - TAG_BYTES));
  try {
    return Buffer.concat([d.update(ctTag.subarray(0, ctTag.length - TAG_BYTES)), d.final()]);
  } catch {
    fail('E_AEAD', 'authentification échouée');
  }
}

// ---------------------------------------------------------------------------
// X25519 (clés brutes de 32 octets)
// ---------------------------------------------------------------------------

const PKCS8_X25519 = unhex('302e020100300506032b656e04220420');
const SPKI_X25519 = unhex('302a300506032b656e032100');
const x25519Private = (raw) => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: 'der', type: 'pkcs8' });
const x25519Public = (raw) => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });

export function x25519PublicKey(privateRaw) {
  return createPublicKey(x25519Private(privateRaw)).export({ type: 'spki', format: 'der' }).subarray(-32);
}

export function x25519(privateRaw, publicRaw) {
  const s = diffieHellman({ privateKey: x25519Private(privateRaw), publicKey: x25519Public(publicRaw) });
  if (s.every((b) => b === 0)) fail('E_X25519', 'secret partagé nul (point de petit ordre)');
  return s;
}

// ---------------------------------------------------------------------------
// Hiérarchie des clés
// ---------------------------------------------------------------------------

export function deriveTierKeys(vmk) {
  if (vmk.length !== KEY_BYTES) fail('E_KEY', 'VMK de 32 octets attendue');
  const sync = hkdf(vmk, INFO.sync);
  return {
    secrets: hkdf(vmk, INFO.secrets),
    data: hkdf(vmk, INFO.data),
    sync,
    export: hkdf(vmk, INFO.export),
    previousKeys: hkdf(vmk, INFO.previousKeys),
    vaultId: hex(hkdf(sync, INFO.vaultId, 16)),
  };
}

export const tierKey = (keys, tier) => (tier === 1 ? keys.secrets : tier === 2 ? keys.data : fail('E_TIER', `niveau inconnu : ${tier}`));

export const recoveryKey = (rk) => hkdf(rk, INFO.recovery);
export const recoveryToken = (rk) => hex(hkdf(rk, INFO.recoveryAuth));

/** Jeton porteur = 64 hex minuscules ; le relais garde SHA-256 des 64 caractères ASCII. */
export const bearerToken = (key32) => hex(key32);
export function tokenHash(token) {
  if (!RE.hex32.test(token)) fail('E_TOKEN', 'jeton : 64 caractères hexadécimaux minuscules attendus');
  return hex(sha256(utf8(token)));
}

// ---------------------------------------------------------------------------
// Chaînes AAD
// ---------------------------------------------------------------------------

export const slotAad = (vaultId, slotId, kg) => `${PREFIX}/slot|${vaultId}|${slotId}|${kg}`;
export const recordAad = (vaultId, id, tier, kg, rev) => `${PREFIX}|${vaultId}|${id}|${tier}|${kg}|${rev}`;
export const previousKeyAad = (vaultId, kgOld, kgCurrent) => `${PREFIX}/previous|${vaultId}|${kgOld}|${kgCurrent}`;
export const pairingAad = (slotHex) => `${PREFIX}/pair|${slotHex}`;

// ---------------------------------------------------------------------------
// Emplacements (slots) et en-tête
// ---------------------------------------------------------------------------

export function wrapSlot({ key, vmk, vaultId, slotId, kg, nonce }) {
  if (!SLOT_IDS.includes(slotId)) fail('E_SLOT', `emplacement inconnu : ${slotId}`);
  const ct = aesGcmEncrypt(key, nonce, slotAad(vaultId, slotId, kg), vmk);
  return { id: slotId, n: b64u(nonce), ct: b64u(ct) };
}

export function unwrapSlot({ key, slot, vaultId, kg }) {
  if (!SLOT_IDS.includes(slot.id)) fail('E_SLOT', `emplacement inconnu : ${slot.id}`);
  const vmk = aesGcmDecrypt(key, unb64u(slot.n), slotAad(vaultId, slot.id, kg), unb64u(slot.ct));
  if (vmk.length !== KEY_BYTES) fail('E_SLOT', 'VMK de 32 octets attendue');
  return vmk;
}

export function wrapPreviousKey({ currentVmk, oldVmk, vaultId, kgOld, kgCurrent, nonce }) {
  const kPrev = hkdf(currentVmk, INFO.previousKeys);
  const ct = aesGcmEncrypt(kPrev, nonce, previousKeyAad(vaultId, kgOld, kgCurrent), oldVmk);
  return { kg: kgOld, n: b64u(nonce), ct: b64u(ct) };
}

export function unwrapPreviousKey({ currentVmk, entry, vaultId, kgCurrent }) {
  if (!(Number.isInteger(entry.kg) && entry.kg >= 1 && entry.kg < kgCurrent)) fail('E_KEYGEN', 'génération précédente invalide');
  const kPrev = hkdf(currentVmk, INFO.previousKeys);
  return aesGcmDecrypt(kPrev, unb64u(entry.n), previousKeyAad(vaultId, entry.kg, kgCurrent), unb64u(entry.ct));
}

export function buildLocalHeader({ vaultId, createdAt, keyGeneration, salt, kdf = KDF_PARAMS, slots, previousKeys = [] }) {
  return {
    v: CONTRACT_VERSION, vaultId, createdAt, keyGeneration,
    kdf: { alg: kdf.alg, salt: b64u(salt), m: kdf.m, t: kdf.t, p: kdf.p },
    slots, previousKeys,
  };
}

export function publicHeader(header) {
  const recovery = header.slots.find((s) => s.id === 'recovery');
  if (!recovery) fail('E_HEADER', "l'en-tête public exige l'emplacement recovery");
  return { v: header.v, vaultId: header.vaultId, createdAt: header.createdAt, keyGeneration: header.keyGeneration, slots: [recovery] };
}

// ---------------------------------------------------------------------------
// Enregistrements
// ---------------------------------------------------------------------------

export function encryptRecord({ vaultId, id, tier, kg, rev, nonce, content, key }) {
  if (!RE.uuid.test(id)) fail('E_ENVELOPE', 'id : UUID v4 minuscule attendu');
  if (!RE.rev.test(rev)) fail('E_ENVELOPE', 'rev : format HLC attendu');
  if (TYPE_TIER[content.type] !== tier) fail('E_TIER', `le type ${content.type} n'appartient pas au niveau ${tier}`);
  if (typeof content.deleted !== 'boolean') fail('E_CONTENT', 'deleted booléen requis');
  const plaintext = pad(utf8(canonicalJson(content)));
  const ct = aesGcmEncrypt(key, nonce, recordAad(vaultId, id, tier, kg, rev), plaintext);
  return { v: CONTRACT_VERSION, id, tier, kg, rev, del: content.deleted, n: b64u(nonce), ct: b64u(ct) };
}

/**
 * Déchiffre et VALIDE une enveloppe. `keyForKg(kg)` retourne les clés de niveau de cette génération
 * ou null si elle est inconnue. Toute incohérence = rejet (jamais de fusion partielle).
 */
export function decryptRecord(envelope, { vaultId, keyForKg }) {
  const e = envelope;
  if (e.v !== CONTRACT_VERSION) fail('E_ENVELOPE', `version ${e.v} non prise en charge`);
  if (!RE.uuid.test(e.id)) fail('E_ENVELOPE', 'id invalide');
  if (!(e.tier === 1 || e.tier === 2)) fail('E_ENVELOPE', 'tier invalide');
  if (!(Number.isInteger(e.kg) && e.kg >= 1)) fail('E_ENVELOPE', 'kg invalide');
  if (!RE.rev.test(e.rev)) fail('E_ENVELOPE', 'rev invalide');
  if (typeof e.del !== 'boolean') fail('E_ENVELOPE', 'del invalide');
  const keys = keyForKg(e.kg);
  if (!keys) fail('E_KEYGEN', `génération de clé inconnue : ${e.kg}`);
  const nonce = unb64u(e.n);
  const ctTag = unb64u(e.ct);
  const padded = aesGcmDecrypt(tierKey(keys, e.tier), nonce, recordAad(vaultId, e.id, e.tier, e.kg, e.rev), ctTag);
  let content;
  try { content = JSON.parse(unpad(padded).toString('utf8')); } catch (err) {
    if (err instanceof ContractError) throw err;
    fail('E_CONTENT', 'JSON invalide');
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) fail('E_CONTENT', 'objet attendu');
  if (TYPE_TIER[content.type] === undefined) fail('E_CONTENT', `type inconnu : ${content.type}`);
  if (TYPE_TIER[content.type] !== e.tier) fail('E_TIER', 'niveau incohérent avec le type');
  if (content.deleted !== e.del) fail('E_DEL_MISMATCH', "l'indice del ne correspond pas au contenu");
  return content;
}

// ---------------------------------------------------------------------------
// Kit de secours : 24 mots BIP39 (liste française, NFC), code du coffre Crockford
// ---------------------------------------------------------------------------

export function loadWordlist(path = join(SHARED_DIR, 'bip39-french.txt')) {
  const words = readFileSync(path, 'utf8').split('\n').filter((w) => w.length > 0);
  if (words.length !== 2048) fail('E_WORDLIST', '2048 mots attendus');
  return words;
}

export function mnemonicEncode(rk, wordlist) {
  if (rk.length !== KEY_BYTES) fail('E_MNEMONIC', '32 octets attendus');
  const bits = [...rk, sha256(rk)[0]].map((b) => b.toString(2).padStart(8, '0')).join(''); // 264 bits
  const words = [];
  for (let i = 0; i < 24; i++) words.push(wordlist[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
  return words;
}

export function normalizeWord(w) { return w.normalize('NFC').toLowerCase().trim(); }

export function mnemonicDecode(words, wordlist) {
  if (words.length !== 24) fail('E_MNEMONIC', '24 mots attendus');
  let bits = '';
  for (const raw of words) {
    const idx = wordlist.indexOf(normalizeWord(raw));
    if (idx < 0) fail('E_MNEMONIC', `mot inconnu : ${raw}`);
    bits += idx.toString(2).padStart(11, '0');
  }
  const bytes = Buffer.alloc(33);
  for (let i = 0; i < 33; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const rk = bytes.subarray(0, 32);
  if (sha256(rk)[0] !== bytes[32]) fail('E_MNEMONIC', 'somme de contrôle invalide');
  return Buffer.from(rk);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 octets → 26 symboles Crockford (2 bits de tête nuls + 128 bits, MSB d'abord). */
export function crockfordEncode(bytes16) {
  if (bytes16.length !== 16) fail('E_VAULTCODE', '16 octets attendus');
  const bits = '00' + [...bytes16].map((b) => b.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i < 26; i++) out += CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out;
}

export function crockfordDecode(code) {
  const s = code.toUpperCase().replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 26) fail('E_VAULTCODE', '26 symboles attendus');
  let bits = '';
  for (const ch of s) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) fail('E_VAULTCODE', `symbole inconnu : ${ch}`);
    bits += v.toString(2).padStart(5, '0');
  }
  if (!bits.startsWith('00')) fail('E_VAULTCODE', 'bits de tête non nuls');
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(bits.slice(2 + i * 8, 2 + i * 8 + 8), 2);
  return out;
}

/** Code du coffre affiché : 26 symboles en groupes 6-5-5-5-5. */
export function vaultCode(vaultIdHex) {
  const c = crockfordEncode(unhex(vaultIdHex));
  return [c.slice(0, 6), c.slice(6, 11), c.slice(11, 16), c.slice(16, 21), c.slice(21, 26)].join('-');
}

export function recoveryUrl({ server, vaultId, rk }) {
  return `qafila://recover?v=1&s=${encodeURIComponent(server)}&id=${crockfordEncode(unhex(vaultId))}&rk=${b64u(rk)}`;
}

// ---------------------------------------------------------------------------
// Appairage
// ---------------------------------------------------------------------------

export function pairingSlot(pkN) { return hex(sha256(pkN)); }

/** HKDF d'appairage : sel vide, info = UTF-8("qafila/v1/<usage>") || pkN || pkE (octets bruts). */
export function pairingHkdf(shared, info, pkN, pkE) {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.concat([utf8(info), pkN, pkE]), KEY_BYTES));
}

/** SAS = uint32 grand-boutiste des 4 premiers octets de HKDF(S, pair-sas) mod 10^6, sur 6 chiffres. */
export function sasFromBytes(sasBytes) {
  return String(sasBytes.readUInt32BE(0) % 1000000).padStart(6, '0');
}

export function pairingDerive(shared, pkN, pkE) {
  const sasBytes = pairingHkdf(shared, INFO.pairSas, pkN, pkE);
  return {
    k: pairingHkdf(shared, INFO.pair, pkN, pkE),
    kMac: pairingHkdf(shared, INFO.pairMac, pkN, pkE),
    kRead: pairingHkdf(shared, INFO.pairRead, pkN, pkE),
    sasBytes,
    sas: sasFromBytes(sasBytes),
  };
}

export function pairingReadProof(kRead, pkN) { return hmacSha256(kRead, sha256(pkN)); }

/** Côté E (existant) : scelle le paquet déposé dans la boîte aux lettres. */
export function pairingSeal({ nE, pkN, nonce, payload }) {
  const pkE = x25519PublicKey(nE);
  const shared = x25519(nE, pkN);
  const { k, kMac } = pairingDerive(shared, pkN, pkE);
  const slot = pairingSlot(pkN);
  const ct = aesGcmEncrypt(k, nonce, pairingAad(slot), pad(utf8(canonicalJson(payload))));
  const mac = hmacSha256(kMac, Buffer.concat([pkN, pkE, ct]));
  return { v: CONTRACT_VERSION, pkN: b64u(pkN), pkE: b64u(pkE), n: b64u(nonce), ct: b64u(ct), mac: b64u(mac) };
}

/** Côté N (nouveau) : vérifie et ouvre le paquet. */
export function pairingOpen({ nN, packet }) {
  const pkN = x25519PublicKey(nN);
  if (packet.v !== CONTRACT_VERSION) fail('E_PAIR', 'version inconnue');
  if (!unb64u(packet.pkN).equals(pkN)) fail('E_PAIR', 'pkN ne correspond pas à notre clé');
  const pkE = unb64u(packet.pkE);
  if (pkE.length !== 32) fail('E_PAIR', 'pkE invalide');
  const nonce = unb64u(packet.n);
  const ct = unb64u(packet.ct);
  const shared = x25519(nN, pkE);
  const { k, kMac, sas } = pairingDerive(shared, pkN, pkE);
  const expectedMac = hmacSha256(kMac, Buffer.concat([pkN, pkE, ct]));
  const mac = unb64u(packet.mac);
  if (mac.length !== 32 || !expectedMac.equals(mac)) fail('E_PAIR', 'mac invalide');
  const padded = aesGcmDecrypt(k, nonce, pairingAad(pairingSlot(pkN)), ct);
  const payload = JSON.parse(unpad(padded).toString('utf8'));
  if (payload.v !== CONTRACT_VERSION || !RE.vaultId.test(payload.vaultId) || !Number.isInteger(payload.keyGeneration)) fail('E_PAIR', 'charge invalide');
  if (unb64u(payload.vmk).length !== KEY_BYTES) fail('E_PAIR', 'VMK invalide');
  return { payload, sas };
}

// ---------------------------------------------------------------------------
// Sauvegarde .qafila
// ---------------------------------------------------------------------------

export function backupMac(kExport, backupWithoutMac) {
  return b64u(hmacSha256(kExport, utf8(canonicalJson(backupWithoutMac))));
}

export function buildBackup({ vaultId, keyGeneration, salt, kdf = KDF_PARAMS, slot, records, kExport }) {
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = {
    format: 'qafila-backup', v: CONTRACT_VERSION, vaultId, keyGeneration,
    kdf: { alg: kdf.alg, salt: b64u(salt), m: kdf.m, t: kdf.t, p: kdf.p },
    slot, records: sorted,
  };
  return { ...body, mac: backupMac(kExport, body) };
}

export function verifyBackupMac(backup, kExport) {
  const { mac, ...body } = backup;
  if (backup.format !== 'qafila-backup' || backup.v !== CONTRACT_VERSION) fail('E_BACKUP', 'format inconnu');
  if (backupMac(kExport, body) !== mac) fail('E_BACKUP', 'mac du fichier invalide');
  return true;
}

// ---------------------------------------------------------------------------
// Génération des vecteurs
// ---------------------------------------------------------------------------

/** Aléa « injecté » reproductible : dérivé d'une étiquette, jamais d'un CSPRNG. */
export const fixedBytes = (label, n) => sha256(utf8(`qafila/vectors/${label}`)).subarray(0, n);
const seq = (start, n) => Buffer.from(Array.from({ length: n }, (_, i) => (start + i) & 0xff));

export async function generateVectors() {
  const wordlist = loadWordlist();
  const VMK = seq(0x00, 32);           // génération courante (kg = 3)
  const VMK2 = seq(0x80, 32);          // génération précédente (kg = 2)
  const RK = seq(0x20, 32);
  const DUK = seq(0x40, 32);
  const SALT = seq(0x60, 16);
  const KG = 3;
  const CREATED_AT = 1763290000000;
  const keys = deriveTierKeys(VMK);
  const keys2 = deriveTierKeys(VMK2);
  const vaultId = keys.vaultId;
  const KEK = await argon2id('qafila-vecteur-test', SALT);

  // --- argon2id --------------------------------------------------------------
  const argonCases = [
    { name: 'phrase de référence', passphrase: 'qafila-vecteur-test', salt: SALT },
    { name: 'accents (NFC)', passphrase: 'Café crème à l’été 2026', salt: fixedBytes('salt/accents', 16) },
    { name: 'émoji', passphrase: 'Mot de passe 🔐 émoji', salt: fixedBytes('salt/emoji', 16) },
    { name: 'arabe', passphrase: 'قافلة-sécurité-2026', salt: fixedBytes('salt/arabic', 16) },
  ];
  const argonPositive = [];
  for (const c of argonCases) {
    const nfc = c.passphrase.normalize('NFC');
    const nfd = c.passphrase.normalize('NFD');
    const kek = await argon2id(nfc, c.salt);
    argonPositive.push({
      name: c.name,
      passphrase: nfc,
      passphraseNfd: nfd,
      passphraseNfcUtf8Hex: hex(utf8(nfc)),
      salt: hex(c.salt), params: KDF_PARAMS, outputLength: 32,
      kek: hex(kek),
    });
  }
  const accents = argonPositive[1];
  const nfdRaw = await argon2idRaw(utf8(accents.passphraseNfd), unhex(accents.salt));
  const argonNegative = [{
    name: 'NFD non normalisé : dérivation sur les octets NFD bruts (interdit) donne une autre clé',
    operation: 'argon2idRaw',
    passwordUtf8Hex: hex(utf8(accents.passphraseNfd)),
    salt: accents.salt, params: KDF_PARAMS,
    kekWithoutNfc: hex(nfdRaw),
    mustDifferFrom: accents.kek,
    expect: 'kekWithoutNfc != mustDifferFrom ; une implémentation conforme produit mustDifferFrom pour la chaîne NFD',
  }];
  if (hex(nfdRaw) === accents.kek) throw new Error('vecteur NFD : collision inattendue');

  // --- hkdf ------------------------------------------------------------------
  const hkdfVectors = {
    description: 'HKDF-SHA256, sel vide (sauf appairage : sel = pkN||pkE), info = "qafila/v1/<usage>", longueur 32 sauf vault-id (16).',
    vmk: hex(VMK), rk: hex(RK),
    derived: [
      { name: 'K_secrets', ikm: 'vmk', info: INFO.secrets, length: 32, okm: hex(keys.secrets) },
      { name: 'K_data', ikm: 'vmk', info: INFO.data, length: 32, okm: hex(keys.data) },
      { name: 'K_sync', ikm: 'vmk', info: INFO.sync, length: 32, okm: hex(keys.sync) },
      { name: 'K_export', ikm: 'vmk', info: INFO.export, length: 32, okm: hex(keys.export) },
      { name: 'K_previous', ikm: 'vmk', info: INFO.previousKeys, length: 32, okm: hex(keys.previousKeys) },
      { name: 'vaultId', ikm: 'K_sync', ikmHex: hex(keys.sync), info: INFO.vaultId, length: 16, okm: vaultId },
      { name: 'K_recovery', ikm: 'rk', info: INFO.recovery, length: 32, okm: hex(recoveryKey(RK)) },
      { name: 'recoveryToken', ikm: 'rk', info: INFO.recoveryAuth, length: 32, okm: recoveryToken(RK) },
    ],
  };

  // --- slots + header --------------------------------------------------------
  const nPass = fixedBytes('nonce/slot/passphrase', 12);
  const nDev = fixedBytes('nonce/slot/device', 12);
  const nRec = fixedBytes('nonce/slot/recovery', 12);
  const nPrev = fixedBytes('nonce/previous/2', 12);
  const slotPass = wrapSlot({ key: KEK, vmk: VMK, vaultId, slotId: 'passphrase', kg: KG, nonce: nPass });
  const slotDev = wrapSlot({ key: DUK, vmk: VMK, vaultId, slotId: 'device', kg: KG, nonce: nDev });
  const slotRec = wrapSlot({ key: recoveryKey(RK), vmk: VMK, vaultId, slotId: 'recovery', kg: KG, nonce: nRec });
  const prev2 = wrapPreviousKey({ currentVmk: VMK, oldVmk: VMK2, vaultId, kgOld: 2, kgCurrent: KG, nonce: nPrev });
  const header = buildLocalHeader({ vaultId, createdAt: CREATED_AT, keyGeneration: KG, salt: SALT, slots: [slotPass, slotDev, slotRec], previousKeys: [prev2] });

  const slotsVectors = {
    description: 'Enveloppement de la VMK dans les emplacements. AAD = "qafila/v1/slot|<vaultId>|<slotId>|<keyGeneration>".',
    vaultId, keyGeneration: KG, vmk: hex(VMK),
    positive: [
      { slotId: 'passphrase', keyName: 'KEK = Argon2id("qafila-vecteur-test", salt)', key: hex(KEK), salt: hex(SALT), nonce: hex(nPass), aad: slotAad(vaultId, 'passphrase', KG), slot: slotPass },
      { slotId: 'device', keyName: 'DUK', key: hex(DUK), nonce: hex(nDev), aad: slotAad(vaultId, 'device', KG), slot: slotDev },
      { slotId: 'recovery', keyName: 'HKDF(RK, "qafila/v1/recovery")', key: hex(recoveryKey(RK)), rk: hex(RK), nonce: hex(nRec), aad: slotAad(vaultId, 'recovery', KG), slot: slotRec },
      {
        slotId: 'previousKeys[kg=2]', keyName: 'K_previous = HKDF(VMK, "qafila/v1/previous-keys")', key: hex(keys.previousKeys),
        plaintext: hex(VMK2), nonce: hex(nPrev), aad: previousKeyAad(vaultId, 2, KG), entry: prev2,
      },
    ],
    negative: [
      { name: 'emplacement présenté sous une autre génération', operation: 'unwrapSlot', key: hex(KEK), slot: slotPass, vaultId, keyGeneration: KG + 1, error: 'E_AEAD' },
      { name: 'emplacement présenté sous un autre coffre', operation: 'unwrapSlot', key: hex(KEK), slot: slotPass, vaultId: keys2.vaultId, keyGeneration: KG, error: 'E_AEAD' },
      { name: 'emplacement renommé (device présenté comme passphrase)', operation: 'unwrapSlot', key: hex(DUK), slot: { ...slotDev, id: 'passphrase' }, vaultId, keyGeneration: KG, error: 'E_AEAD' },
      { name: 'KEK issue de la phrase NFD sans normalisation', operation: 'unwrapSlot', key: hex(await argon2idRaw(utf8('qafila-vecteur-test'.normalize('NFD') + '́'), SALT)), slot: slotPass, vaultId, keyGeneration: KG, error: 'E_AEAD' },
      { name: 'tag altéré', operation: 'unwrapSlot', key: hex(KEK), slot: { ...slotPass, ct: b64u(flipLastByte(unb64u(slotPass.ct))) }, vaultId, keyGeneration: KG, error: 'E_AEAD' },
      { name: 'base64 avec bourrage « = » refusé', operation: 'unwrapSlot', key: hex(KEK), slot: { ...slotPass, n: `${slotPass.n}=` }, vaultId, keyGeneration: KG, error: 'E_BASE64URL' },
      { name: 'alphabet base64 standard (« + », « / ») refusé', operation: 'unwrapSlot', key: hex(KEK), slot: { ...slotPass, ct: slotPass.ct.replace(/[-_]/g, '+').slice(0, 63) + '/' }, vaultId, keyGeneration: KG, error: 'E_BASE64URL' },
    ],
  };

  const headerVectors = {
    description: 'En-tête local complet (header.json) et sa projection publique (relais). Toutes les valeurs dérivent de vmk/vmk2/rk/duk/salt ci-dessus.',
    inputs: { vmk: hex(VMK), vmkPrevious: { kg: 2, vmk: hex(VMK2) }, rk: hex(RK), duk: hex(DUK), kek: hex(KEK), salt: hex(SALT), passphrase: 'qafila-vecteur-test', createdAt: CREATED_AT },
    header,
    headerCanonical: canonicalJson(header),
    publicHeader: publicHeader(header),
    vaultCode: vaultCode(vaultId),
    recoveryUrl: recoveryUrl({ server: 'https://sync.qafila.fr', vaultId, rk: RK }),
  };

  // --- records ---------------------------------------------------------------
  const login = {
    type: 'login', title: 'Aeon', origins: ['https://aeon.co', 'https://login.aeon.co'],
    username: 'lina@example.org', password: 'Zéphyr-2026!🔑', note: '',
    formActionOrigin: 'https://aeon.co', httpRealm: null, totp: null, folderId: null, favorite: false, tags: [],
    createdAt: 1763290000000, modifiedAt: 1763290000000, lastUsedAt: null, passwordChangedAt: 1763290000000,
    passwordHistory: [{ password: 'ancien', changedAt: 1750000000000 }],
    source: 'firefox', importGuid: '{a1b2c3d4-0000-4000-8000-000000000000}', importBatch: 'b7e1f2a3-5c6d-4e7f-8a9b-0c1d2e3f4a5b', neverSaveHere: false,
    author: 'd3c9a1f0', deleted: false,
  };
  const bookmark = { type: 'bookmark', title: 'Aeon', url: 'https://aeon.co/', addedAt: 1763290000000, folderId: null, position: 'a0V', author: 'd3c9a1f0', deleted: false };
  const setting = { type: 'setting', key: 'toolbar', value: { actions: ['back', 'forward', 'share', 'newTab', 'tabs', 'menu'], position: 'bottom', 'é': 'tri UTF-16 : é (U+00E9) après z' }, scope: 'all', author: 'd3c9a1f0', deleted: false };
  const folder = { type: 'folder', name: 'Firefox · 16 nov. 2026', kind: 'bookmark', parentId: null, position: 'a1', createdAt: 1763290000000, toolbar: false, author: 'd3c9a1f0', deleted: false };
  const device = { type: 'device', deviceId: 'd3c9a1f0', name: 'iPhone de Lina', platform: 'ios', appVersion: '1.4.0', createdAt: 1763290000000, lastSeenAt: 1763290511123, author: 'd3c9a1f0', deleted: false };
  const tombstone = { type: 'login', deleted: true };
  const ids = {
    login: '6f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90', bookmark: '2b7d0c4e-8f1a-4c3b-9d5e-6f7a8b9c0d1e', setting: '9a8b7c6d-5e4f-4a3b-8c9d-0e1f2a3b4c5d',
    folder: '1e2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b', device: 'c0ffee00-1234-4abc-8def-0123456789ab', tombstone: '6f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90',
  };
  const recCases = [
    { name: 'login (niveau 1)', content: login, id: ids.login, tier: 1, rev: '1763290511123-0002-9af3' },
    { name: 'tombstone login (niveau 1, del=true)', content: tombstone, id: ids.tombstone, tier: 1, rev: '1763290600000-0000-0c41' },
    { name: 'bookmark (niveau 2)', content: bookmark, id: ids.bookmark, tier: 2, rev: '1763290511123-0003-11aa' },
    { name: 'setting avec valeur imbriquée et clé non ASCII (niveau 2)', content: setting, id: ids.setting, tier: 2, rev: '1763290511124-0000-ffff' },
    { name: 'folder (niveau 2)', content: folder, id: ids.folder, tier: 2, rev: '1763290511125-0000-0001' },
    { name: 'device (niveau 2)', content: device, id: ids.device, tier: 2, rev: '1763290511126-0000-0002' },
  ];
  const recPositive = recCases.map((c) => {
    const nonce = fixedBytes(`nonce/record/${c.id}/${c.rev}`, 12);
    const key = tierKey(keys, c.tier);
    const envelope = encryptRecord({ vaultId, id: c.id, tier: c.tier, kg: KG, rev: c.rev, nonce, content: c.content, key });
    const canonical = canonicalJson(c.content);
    return {
      name: c.name, content: c.content, contentCanonical: canonical, paddedHex: hex(pad(utf8(canonical))),
      key: hex(key), nonce: hex(nonce), aad: recordAad(vaultId, c.id, c.tier, KG, c.rev), envelope, envelopeCanonical: canonicalJson(envelope),
    };
  });
  const env0 = recPositive[0].envelope;
  const keyForKgDesc = { 3: 'vmk', 2: 'vmkPrevious' };
  const badPadding = (() => {
    const nonce = fixedBytes('nonce/record/badpad', 12);
    const pt = Buffer.alloc(256, 0); // JSON suivi de zéros sans 0x80
    const j = utf8(canonicalJson(tombstone)); pt.set(j, 0);
    const ct = aesGcmEncrypt(keys.secrets, nonce, recordAad(vaultId, ids.login, 1, KG, '1763290700000-0000-0000'), pt);
    return { v: 1, id: ids.login, tier: 1, kg: KG, rev: '1763290700000-0000-0000', del: true, n: b64u(nonce), ct: b64u(ct) };
  })();
  const delMismatch = (() => {
    const nonce = fixedBytes('nonce/record/delmismatch', 12);
    const ct = aesGcmEncrypt(keys.secrets, nonce, recordAad(vaultId, ids.login, 1, KG, '1763290700000-0001-0000'), pad(utf8(canonicalJson(login))));
    return { v: 1, id: ids.login, tier: 1, kg: KG, rev: '1763290700000-0001-0000', del: true, n: b64u(nonce), ct: b64u(ct) };
  })();
  const tierMismatch = (() => {
    const nonce = fixedBytes('nonce/record/tiermismatch', 12);
    const ct = aesGcmEncrypt(keys.data, nonce, recordAad(vaultId, ids.login, 2, KG, '1763290700000-0002-0000'), pad(utf8(canonicalJson(login))));
    return { v: 1, id: ids.login, tier: 2, kg: KG, rev: '1763290700000-0002-0000', del: false, n: b64u(nonce), ct: b64u(ct) };
  })();
  const recordsVectors = {
    description: 'Enveloppes AEAD par enregistrement. AAD = "qafila/v1|<vaultId>|<id>|<tier>|<kg>|<rev>". Contenu = JSON canonique bourré à 256.',
    vaultId, keyGeneration: KG, keys: { secrets: hex(keys.secrets), data: hex(keys.data) },
    keysPrevious: { kg: 2, secrets: hex(keys2.secrets), data: hex(keys2.data) },
    positive: recPositive,
    negative: [
      { name: 'tag altéré', operation: 'decryptRecord', envelope: { ...env0, ct: b64u(flipLastByte(unb64u(env0.ct))) }, error: 'E_AEAD' },
      { name: 'texte chiffré altéré', operation: 'decryptRecord', envelope: { ...env0, ct: b64u(flipByte(unb64u(env0.ct), 0)) }, error: 'E_AEAD' },
      { name: 'AAD : autre id', operation: 'decryptRecord', envelope: { ...env0, id: ids.bookmark }, error: 'E_AEAD' },
      { name: 'AAD : autre vaultId', operation: 'decryptRecord', vaultId: keys2.vaultId, envelope: env0, error: 'E_AEAD' },
      { name: 'AAD : autre kg (2, clés de la génération 2 connues)', operation: 'decryptRecord', envelope: { ...env0, kg: 2 }, error: 'E_AEAD' },
      { name: 'kg inconnu (9)', operation: 'decryptRecord', envelope: { ...env0, kg: 9 }, error: 'E_KEYGEN' },
      { name: 'AAD : rev modifié', operation: 'decryptRecord', envelope: { ...env0, rev: '1763290511123-0002-9af4' }, error: 'E_AEAD' },
      { name: 'AAD : autre tier (clé de niveau 2)', operation: 'decryptRecord', envelope: { ...env0, tier: 2 }, error: 'E_AEAD' },
      { name: 'bourrage invalide (pas de 0x80), AEAD valide', operation: 'decryptRecord', envelope: badPadding, error: 'E_PADDING' },
      { name: 'indice del=true mais contenu deleted=false, AEAD valide', operation: 'decryptRecord', envelope: delMismatch, error: 'E_DEL_MISMATCH' },
      { name: 'type login chiffré au niveau 2, AEAD valide', operation: 'decryptRecord', envelope: tierMismatch, error: 'E_TIER' },
      { name: 'ct en base64 standard avec padding', operation: 'decryptRecord', envelope: { ...env0, ct: Buffer.from(unb64u(env0.ct)).toString('base64') }, error: 'E_BASE64URL' },
      { name: 'version inconnue', operation: 'decryptRecord', envelope: { ...env0, v: 2 }, error: 'E_ENVELOPE' },
      { name: 'rev dans un mauvais format', operation: 'decryptRecord', envelope: { ...env0, rev: '1763290511123-2-9af3' }, error: 'E_ENVELOPE' },
    ],
    keyForKg: keyForKgDesc,
  };

  // --- padding ---------------------------------------------------------------
  const padInputs = [
    { name: 'vide', input: Buffer.alloc(0) },
    { name: '{}', input: utf8('{}') },
    { name: '255 octets', input: Buffer.alloc(255, 0x41) },
    { name: '256 octets (un bloc entier est ajouté)', input: Buffer.alloc(256, 0x41) },
    { name: '257 octets', input: Buffer.alloc(257, 0x41) },
    { name: '511 octets', input: Buffer.alloc(511, 0x41) },
  ];
  const paddingVectors = {
    description: 'Bourrage : données || 0x80 || 0x00* jusqu\'au prochain multiple de 256 (au moins un octet ajouté). Débourrage : retirer les 0x00 finaux, exiger 0x80.',
    positive: padInputs.map((p) => ({ name: p.name, inputHex: hex(p.input), paddedHex: hex(pad(p.input)), paddedLength: pad(p.input).length })),
    negative: [
      { name: 'longueur nulle', operation: 'unpad', paddedHex: '', error: 'E_PADDING' },
      { name: 'longueur non multiple de 256', operation: 'unpad', paddedHex: hex(Buffer.concat([utf8('{}'), Buffer.from([0x80]), Buffer.alloc(297, 0)])), error: 'E_PADDING' },
      { name: 'uniquement des zéros', operation: 'unpad', paddedHex: hex(Buffer.alloc(256, 0)), error: 'E_PADDING' },
      { name: 'dernier octet non nul différent de 0x80', operation: 'unpad', paddedHex: hex(Buffer.concat([utf8('{}'), Buffer.from([0x81]), Buffer.alloc(253, 0)])), error: 'E_PADDING' },
      { name: 'JSON suivi de zéros sans 0x80', operation: 'unpad', paddedHex: hex(Buffer.concat([utf8('{}'), Buffer.alloc(254, 0)])), error: 'E_PADDING' },
    ],
  };

  // --- recovery kit ----------------------------------------------------------
  const kitCases = [
    { name: 'RK du jeu de vecteurs', rk: RK },
    { name: 'entropie nulle', rk: Buffer.alloc(32, 0) },
    { name: 'entropie 0xff', rk: Buffer.alloc(32, 0xff) },
    { name: 'entropie dérivée', rk: fixedBytes('rk/derived', 32) },
  ];
  const kitPositive = kitCases.map((c) => {
    const words = mnemonicEncode(c.rk, wordlist);
    if (!mnemonicDecode(words, wordlist).equals(c.rk)) throw new Error('kit : aller-retour échoué');
    return { name: c.name, rk: hex(c.rk), checksumByte: hex(sha256(c.rk).subarray(0, 1)), words, sentence: words.join(' '), sentenceNfd: words.join(' ').normalize('NFD') };
  });
  const w0 = kitPositive[0].words;
  const recoveryVectors = {
    description: 'Kit de secours : 24 mots BIP39 (liste française shared/bip39-french.txt, NFC), 256 bits + 8 bits SHA-256 ; code du coffre Crockford 26 symboles.',
    wordlist: { file: 'shared/bip39-french.txt', sha256: hex(sha256(readFileSync(join(SHARED_DIR, 'bip39-french.txt')))), count: 2048, first: wordlist[0], last: wordlist[2047] },
    positive: kitPositive,
    negative: [
      { name: 'somme de contrôle invalide (deux derniers mots permutés)', operation: 'mnemonicDecode', words: [...w0.slice(0, 22), w0[23], w0[22]], error: 'E_MNEMONIC' },
      { name: '23 mots', operation: 'mnemonicDecode', words: w0.slice(0, 23), error: 'E_MNEMONIC' },
      { name: 'mot hors liste', operation: 'mnemonicDecode', words: [...w0.slice(0, 23), 'qafila'], error: 'E_MNEMONIC' },
      { name: 'premier mot remplacé par son voisin', operation: 'mnemonicDecode', words: [wordlist[(wordlist.indexOf(w0[0]) + 1) % 2048], ...w0.slice(1)], error: 'E_MNEMONIC' },
    ],
    vaultCode: [
      { vaultId, code: vaultCode(vaultId), compact: crockfordEncode(unhex(vaultId)) },
      { vaultId: '00000000000000000000000000000000', code: vaultCode('00000000000000000000000000000000'), compact: crockfordEncode(Buffer.alloc(16, 0)) },
      { vaultId: 'ffffffffffffffffffffffffffffffff', code: vaultCode('ffffffffffffffffffffffffffffffff'), compact: crockfordEncode(Buffer.alloc(16, 0xff)) },
    ],
    vaultCodeNegative: [
      { name: 'bits de tête non nuls', operation: 'crockfordDecode', code: 'ZZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', error: 'E_VAULTCODE' },
      { name: 'symbole U interdit', operation: 'crockfordDecode', code: '0UUUUU-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', error: 'E_VAULTCODE' },
    ],
    recoveryUrl: recoveryUrl({ server: 'https://sync.qafila.fr', vaultId, rk: RK }),
  };

  // --- bearer tokens ---------------------------------------------------------
  const bearerVectors = {
    description: 'Jeton porteur = 64 hex minuscules de la clé ; le relais stocke hex(SHA-256(UTF-8 du jeton tel que reçu)).',
    positive: [
      { name: 'jeton de synchronisation (K_sync)', key: hex(keys.sync), token: bearerToken(keys.sync), tokenHash: tokenHash(bearerToken(keys.sync)), authorizationHeader: `Bearer ${bearerToken(keys.sync)}` },
      { name: 'jeton de récupération (HKDF(RK, recovery-auth))', key: recoveryToken(RK), token: recoveryToken(RK), tokenHash: tokenHash(recoveryToken(RK)), authorizationHeader: `Bearer ${recoveryToken(RK)}` },
    ],
    negative: [
      { name: 'hex majuscule refusé', operation: 'tokenHash', token: bearerToken(keys.sync).toUpperCase(), error: 'E_TOKEN' },
      { name: 'longueur incorrecte', operation: 'tokenHash', token: bearerToken(keys.sync).slice(0, 63), error: 'E_TOKEN' },
      { name: 'hachage des 32 octets bruts (interdit) différent du hachage du jeton ASCII', operation: 'compare', rawHash: hex(sha256(keys.sync)), tokenHash: tokenHash(bearerToken(keys.sync)) },
    ],
  };

  // --- pairing ---------------------------------------------------------------
  const nN = fixedBytes('x25519/new', 32);
  const nE = fixedBytes('x25519/existing', 32);
  const pkN = x25519PublicKey(nN);
  const pkE = x25519PublicKey(nE);
  const shared = x25519(nE, pkN);
  if (!shared.equals(x25519(nN, pkE))) throw new Error('x25519 asymétrique');
  const derived = pairingDerive(shared, pkN, pkE);
  const pairPayload = { v: 1, vaultId, keyGeneration: KG, vmk: b64u(VMK), header: publicHeader(header), server: 'https://sync.qafila.fr', deviceName: 'iPhone de Lina' };
  const pairNonce = fixedBytes('nonce/pair', 12);
  const packet = pairingSeal({ nE, pkN, nonce: pairNonce, payload: pairPayload });
  const opened = pairingOpen({ nN, packet });
  if (canonicalJson(opened.payload) !== canonicalJson(pairPayload) || opened.sas !== derived.sas) throw new Error('appairage : aller-retour échoué');
  const nX = fixedBytes('x25519/attacker', 32);
  const pkX = x25519PublicKey(nX);
  const otherDerived = pairingDerive(x25519(nX, pkN), pkN, pkX);
  const pairingVectors = {
    description: 'Appairage X25519 éphémère. S = X25519(nE, pkN) = X25519(nN, pkE) ; HKDF sel vide, info = "qafila/v1/<usage>" || pkN || pkE ; SAS = uint32BE(4 premiers octets de HKDF(S, pair-sas, 32)) mod 10^6 sur 6 chiffres.',
    new: { privateKey: hex(nN), publicKey: hex(pkN), publicKeyB64u: b64u(pkN), qr: `qafila://pair?v=1&s=${encodeURIComponent('https://sync.qafila.fr')}&pk=${b64u(pkN)}` },
    existing: { privateKey: hex(nE), publicKey: hex(pkE) },
    sharedSecret: hex(shared),
    slot: pairingSlot(pkN),
    hkdfInfoSuffix: hex(Buffer.concat([pkN, pkE])),
    k: hex(derived.k), kMac: hex(derived.kMac), kRead: hex(derived.kRead),
    sasBytes: hex(derived.sasBytes), sas: derived.sas, sasDisplay: `${derived.sas.slice(0, 3)} ${derived.sas.slice(3)}`,
    readProof: hex(pairingReadProof(derived.kRead, pkN)),
    payload: pairPayload, payloadCanonical: canonicalJson(pairPayload), aad: pairingAad(pairingSlot(pkN)), nonce: hex(pairNonce),
    macInput: 'pkN || pkE || ct',
    packet,
    negative: [
      { name: 'SAS d\'un autre échange (attaquant pkX à la place de pkE)', operation: 'compare', attacker: { privateKey: hex(nX), publicKey: hex(pkX) }, sas: otherDerived.sas, mustDifferFrom: derived.sas },
      { name: 'mac altéré', operation: 'pairingOpen', packet: { ...packet, mac: b64u(flipLastByte(unb64u(packet.mac))) }, error: 'E_PAIR' },
      { name: 'ct altéré (mac recalculé impossible sans S)', operation: 'pairingOpen', packet: { ...packet, ct: b64u(flipLastByte(unb64u(packet.ct))) }, error: 'E_PAIR' },
      { name: 'pkE substitué', operation: 'pairingOpen', packet: { ...packet, pkE: b64u(pkX) }, error: 'E_PAIR' },
      { name: 'paquet destiné à une autre clé pkN', operation: 'pairingOpen', packet: { ...packet, pkN: b64u(pkX) }, error: 'E_PAIR' },
    ],
  };
  if (otherDerived.sas === derived.sas) throw new Error('vecteur SAS : collision inattendue');

  // --- backup ----------------------------------------------------------------
  const exportSalt = fixedBytes('salt/export', 16);
  const exportKek = await argon2id('sauvegarde-vecteur-test', exportSalt);
  const exportNonce = fixedBytes('nonce/slot/export', 12);
  const exportSlot = wrapSlot({ key: exportKek, vmk: VMK, vaultId, slotId: 'export', kg: KG, nonce: exportNonce });
  const backup = buildBackup({ vaultId, keyGeneration: KG, salt: exportSalt, slot: exportSlot, records: [recPositive[0].envelope, recPositive[2].envelope], kExport: keys.export });
  verifyBackupMac(backup, keys.export);
  const truncated = { ...backup, records: backup.records.slice(0, 1) };
  const backupVectors = {
    description: 'Sauvegarde .qafila minimale : emplacement export (Argon2id sur la phrase d\'export) + enveloppes + mac HMAC-SHA256(K_export, JSON canonique sans mac).',
    passphrase: 'sauvegarde-vecteur-test', exportKek: hex(exportKek), exportSalt: hex(exportSalt), exportNonce: hex(exportNonce), exportSlotAad: slotAad(vaultId, 'export', KG),
    kExport: hex(keys.export),
    backup,
    macInputCanonical: canonicalJson((({ mac, ...b }) => b)(backup)),
    negative: [
      { name: 'enregistrement retiré : mac invalide', operation: 'verifyBackupMac', backup: truncated, error: 'E_BACKUP' },
      { name: 'mac altéré', operation: 'verifyBackupMac', backup: { ...backup, mac: b64u(flipLastByte(unb64u(backup.mac))) }, error: 'E_BACKUP' },
    ],
  };

  // --- standard --------------------------------------------------------------
  const standardVectors = {
    description: 'Vecteurs publiés, recalculés ici avec node:crypto pour vérifier la primitive de chaque plateforme.',
    hkdfSha256: [{
      source: 'RFC 5869 A.1', ikm: hex(Buffer.alloc(22, 0x0b)), salt: '000102030405060708090a0b0c', info: 'f0f1f2f3f4f5f6f7f8f9', length: 42,
      okm: hex(hkdfSync('sha256', Buffer.alloc(22, 0x0b), unhex('000102030405060708090a0b0c'), unhex('f0f1f2f3f4f5f6f7f8f9'), 42)),
    }],
    hmacSha256: [{ source: 'RFC 4231 case 2', key: hex(utf8('Jefe')), data: hex(utf8('what do ya want for nothing?')), mac: hex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?'))) }],
    aes256Gcm: [(() => {
      const key = unhex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308');
      const iv = unhex('cafebabefacedbaddecaf888');
      const pt = unhex('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39');
      const aad = unhex('feedfacedeadbeeffeedfacedeadbeefabaddad2');
      const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad);
      const ct = Buffer.concat([c.update(pt), c.final()]);
      return { source: 'McGrew–Viega / NIST GCM test case 16', key: hex(key), iv: hex(iv), plaintext: hex(pt), aad: hex(aad), ciphertext: hex(ct), tag: hex(c.getAuthTag()) };
    })()],
    x25519: [{
      source: 'RFC 7748 §6.1',
      alicePrivate: '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
      alicePublic: hex(x25519PublicKey(unhex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'))),
      bobPrivate: '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
      bobPublic: hex(x25519PublicKey(unhex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb'))),
      shared: hex(x25519(unhex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'), x25519PublicKey(unhex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')))),
    }],
    sha256: [{ source: 'FIPS 180-4, "abc"', data: hex(utf8('abc')), digest: hex(sha256(utf8('abc'))) }],
  };

  // --- canonical JSON --------------------------------------------------------
  const canonicalVectors = {
    description: 'JSON canonique : clés triées par unités UTF-16, aucun espace, entiers seulement, UTF-8 brut (pas d\'échappement \\uXXXX hors contrôles).',
    positive: [
      { input: { b: 1, a: [true, null, 'x'], 'é': 'e', Z: 0, '~': -5, 'è': { y: 2, x: 1 } }, canonical: canonicalJson({ b: 1, a: [true, null, 'x'], 'é': 'e', Z: 0, '~': -5, 'è': { y: 2, x: 1 } }) },
      { input: { s: 'guillemet " antislash \\ contrôle \u0001 tab \t nl \n', emoji: '🔐', ar: 'قافلة' }, canonical: canonicalJson({ s: 'guillemet " antislash \\ contrôle \u0001 tab \t nl \n', emoji: '🔐', ar: 'قافلة' }) },
      { input: { 'a\u{1F600}': 1, 'a￿': 2, 'ab': 3 }, canonical: canonicalJson({ 'a\u{1F600}': 1, 'a￿': 2, 'ab': 3 }), note: 'U+1F600 (substituts D83D DE00) se classe AVANT U+FFFF en unités UTF-16, après "ab"' },
    ],
    negative: [
      { name: 'nombre non entier', operation: 'canonicalJson', inputJson: '{"x":1.5}', error: 'E_CANONICAL' },
      { name: 'entier hors borne 2^53', operation: 'canonicalJson', inputJson: '{"x":9007199254740993}', error: 'E_CANONICAL' },
    ],
  };

  return {
    'argon2id.json': { description: 'Argon2id (RFC 9106, version 0x13) : m = 65536 Kio, t = 3, p = 1, sortie 32 o, sel 16 o. La phrase est normalisée NFC avant l\'encodage UTF-8.', positive: argonPositive, negative: argonNegative },
    'hkdf.json': hkdfVectors,
    'slots.json': slotsVectors,
    'header.json': headerVectors,
    'records.json': recordsVectors,
    'padding.json': paddingVectors,
    'recovery-kit.json': recoveryVectors,
    'bearer-token.json': bearerVectors,
    'pairing.json': pairingVectors,
    'backup.json': backupVectors,
    'canonical-json.json': canonicalVectors,
    'standard.json': standardVectors,
  };
}

function flipLastByte(buf) { return flipByte(buf, buf.length - 1); }
function flipByte(buf, i) { const out = Buffer.from(buf); out[i] ^= 0x01; return out; }

export async function writeVectors(dir = HERE) {
  const all = await generateVectors();
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(all)) {
    writeFileSync(join(dir, name), JSON.stringify({ $comment: 'Généré par shared/vectors/gen.mjs — ne pas éditer à la main.', ...data }, null, 2) + '\n');
  }
  return Object.keys(all);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeVectors().then((names) => { console.log(`Vecteurs écrits : ${names.join(', ')}`); })
    .catch((err) => { console.error(err); process.exit(1); });
}
