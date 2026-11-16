// Tests du contrat « protocole du relais aveugle et appairage » (shared/PROTOCOL.md).
// - chaque fixture de shared/fixtures/protocol/ est validée contre les schémas de shared/schemas/protocol/ ;
// - le vecteur d'appairage est recalculé (X25519, HKDF, SAS, AES-GCM, HMAC, preuves) ;
// - l'exemple de fusion est rejoué et doit converger comme PROTOCOL.md §5 le dit.
// Aucune dépendance : mini-validateur JSON Schema (sous-ensemble suffisant pour nos schémas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, createHmac, hkdfSync, createDecipheriv, createCipheriv, createPrivateKey, createPublicKey, diffieHellman } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = join(here, '..', 'schemas', 'protocol');
const FIXTURES = join(here, '..', 'fixtures', 'protocol');

// ------------------------------------------------------------------ mini-validateur
const schemas = new Map();
for (const f of readdirSync(SCHEMAS).filter(f => f.endsWith('.json'))) {
  schemas.set(f, JSON.parse(readFileSync(join(SCHEMAS, f), 'utf8')));
}
const usedSchemas = new Set();

function resolveRef(ref, current) {
  const [file, pointer = ''] = ref.split('#');
  const root = file ? schemas.get(file) : current.root;
  if (!root) throw new Error(`schéma introuvable : ${ref}`);
  let node = root;
  for (const part of pointer.split('/').filter(Boolean)) {
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`pointeur introuvable : ${ref}`);
  }
  return { schema: node, root };
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function validate(schema, value, ctx, path = '$', errors = []) {
  if (schema.$ref) {
    const r = resolveRef(schema.$ref, ctx);
    validate(r.schema, value, { root: r.root }, path, errors);
    const { $ref, ...rest } = schema;
    if (Object.keys(rest).some(k => !['description', 'title', '$comment'].includes(k))) validate(rest, value, ctx, path, errors);
    return errors;
  }
  const t = typeOf(value);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some(x => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { errors.push(`${path}: type ${t} ≠ ${types.join('|')}`); return errors; }
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: ≠ const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${path}: hors enum (${JSON.stringify(value)})`);
  if (t === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: motif ${schema.pattern} non respecté (${value.slice(0, 40)})`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: longueur ${value.length} < ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longueur ${value.length} > ${schema.maxLength}`);
  }
  if (t === 'integer' || t === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > ${schema.maximum}`);
  }
  if (t === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: ${value.length} éléments < ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: ${value.length} éléments > ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, ctx, `${path}[${i}]`, errors));
  }
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}: propriété requise manquante « ${k} »`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) validate(schema.properties[k], v, ctx, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: propriété inattendue « ${k} »`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, ctx, `${path}.${k}`, errors);
    }
  }
  if (schema.allOf) for (const s of schema.allOf) validate(s, value, ctx, path, errors);
  if (schema.anyOf && !schema.anyOf.some(s => validate(s, value, ctx, path, []).length === 0)) errors.push(`${path}: aucune branche anyOf`);
  if (schema.oneOf) {
    const n = schema.oneOf.filter(s => validate(s, value, ctx, path, []).length === 0).length;
    if (n !== 1) errors.push(`${path}: ${n} branches oneOf valides (1 attendue)`);
  }
  return errors;
}

function check(schemaFile, value, label) {
  const schema = schemas.get(schemaFile);
  assert.ok(schema, `${label}: schéma ${schemaFile} introuvable`);
  usedSchemas.add(schemaFile);
  const errors = validate(schema, value, { root: schema });
  assert.deepEqual(errors, [], `${label} (${schemaFile})`);
}

// Le validateur lui-même doit refuser ce qu'il faut (sinon les tests suivants ne prouvent rien).
test('le mini-validateur détecte les violations', () => {
  const env = schemas.get('envelope.json');
  const ok = { v: 1, id: '6f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90', tier: 1, kg: 3, rev: '1763290511123-0002-9af3', del: false, n: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(363) };
  assert.deepEqual(validate(env, ok, { root: env }), []);
  assert.ok(validate(env, { ...ok, extra: 1 }, { root: env }).length, 'propriété en trop');
  assert.ok(validate(env, { ...ok, tier: 3 }, { root: env }).length, 'tier hors enum');
  assert.ok(validate(env, { ...ok, rev: '1763290511123-2-9af3' }, { root: env }).length, 'rev mal formé');
  assert.ok(validate(env, { ...ok, ct: 'A'.repeat(360) }, { root: env }).length, 'ct trop court');
  assert.ok(validate(env, { ...ok, ct: 'A'.repeat(362) + '=' }, { root: env }).length, 'base64 avec bourrage refusé');
  assert.ok(validate(env, { ...ok, ct: 'A'.repeat(362) + '+' }, { root: env }).length, 'alphabet base64 standard refusé');
  assert.ok(validate(env, { ...ok, id: '6F1C2E5A-3B0D-4A8E-9F21-0C7D4E5B6A90' }, { root: env }).length, 'uuid majuscule');
  const err = schemas.get('error.json');
  assert.ok(validate(err, { error: 'nope', message: 'x' }, { root: err }).length, 'code inconnu');
  const st = schemas.get('sync-state.json');
  assert.ok(validate(st, { v: 1 }, { root: st }).length, 'état incomplet');
});

test('tous les schémas sont des JSON valides référencés sans trou', () => {
  for (const [name, schema] of schemas) {
    assert.equal(schema.$id, name, `${name}: $id doit égaler le nom du fichier`);
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        if (typeof node.$ref === 'string') resolveRef(node.$ref, { root: schema });
        Object.values(node).forEach(walk);
      }
    };
    walk(schema);
  }
});

// ------------------------------------------------------------------ fixtures contre schémas
const fixtures = readdirSync(FIXTURES).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'))]);
const ERROR_FREE = new Set([200, 201, 204]);

for (const [name, fx] of fixtures) {
  test(`fixture ${name} : chaque étape respecte son schéma`, () => {
    assert.ok(Array.isArray(fx.steps) && fx.steps.length, 'steps');
    for (const s of fx.steps) {
      const label = `${name} étape ${s.step} (${s.name})`;
      assert.match(s.request.method, /^(GET|PUT|POST|DELETE)$/, label);
      assert.match(s.request.path, /^\/sync\/v1(\/|$)/, label);
      if (s.request.schema) check(s.request.schema, s.request.body, `${label} requête`);
      if (s.request.body !== undefined && s.request.method === 'GET') assert.fail(`${label}: un GET n'a pas de corps`);
      if (s.response.status === 204) { assert.equal(s.response.body, undefined, `${label}: 204 sans corps`); continue; }
      assert.ok(s.response.schema, `${label}: réponse sans schéma`);
      if (!ERROR_FREE.has(s.response.status)) {
        assert.equal(s.response.schema, 'error.json', `${label}: une erreur suit error.json`);
        if (s.response.status === 429) assert.ok(s.response.headers?.['Retry-After'], `${label}: 429 porte Retry-After`);
      }
      check(s.response.schema, s.response.body, `${label} réponse`);
    }
    if (fx.qr) {
      check(fx.qr.schema, fx.qr.parsed, `${name} QR`);
      const u = new URL(fx.qr.uri);
      assert.equal(u.protocol, 'qafila:'); assert.equal(u.hostname, fx.qr.parsed.action);
      for (const [k, val] of u.searchParams) assert.equal(String(fx.qr.parsed[k]), val, `${name} QR paramètre ${k}`);
      assert.deepEqual([...u.searchParams.keys()], Object.keys(fx.qr.parsed).filter(k => !['scheme', 'action'].includes(k)), `${name} QR : ordre des paramètres`);
    }
    if (fx.decrypted?.schema) check(fx.decrypted.schema, fx.decrypted.packet, `${name} paquet déchiffré`);
    if (fx.clientStateAfter) for (const [k, v] of Object.entries(fx.clientStateAfter)) if (k !== 'schema') check(fx.clientStateAfter.schema, v, `${name} sync-state ${k}`);
  });
}

test('les erreurs portent le code HTTP fixé par PROTOCOL.md §9', () => {
  const expected = { bad_request: 400, invalid_envelope: 400, rev_in_future: 400, unauthorized: 401, forbidden: 403, vault_not_found: 404, pairing_not_found: 404, vault_exists: 409, key_generation_mismatch: 409, pairing_slot_taken: 409, pairing_slot_mismatch: 400, pairing_commit_mismatch: 409, pairing_not_open: 409, pairing_proof_invalid: 403, pairing_gone: 410, payload_too_large: 413, quota_exceeded: 413, rate_limited: 429, creation_limited: 429, internal_error: 500, unavailable: 503 };
  const codes = schemas.get('common.json').$defs.errorCode.enum;
  assert.deepEqual(Object.keys(expected).sort(), [...codes].sort(), 'la table §9 et common.json listent les mêmes codes');
  for (const [, fx] of fixtures) for (const s of fx.steps) if (s.response.schema === 'error.json') assert.equal(s.response.status, expected[s.response.body.error], `${s.name}: ${s.response.body.error}`);
});

test('chaque schéma est exercé par au moins une fixture (ou n\'est qu\'une définition partagée)', () => {
  const definitionsOnly = new Set(['common.json', 'usage.json', 'header-public.json', 'envelope.json']);
  for (const name of schemas.keys()) if (!definitionsOnly.has(name)) assert.ok(usedSchemas.has(name), `${name} n'est utilisé par aucune fixture`);
});

// ------------------------------------------------------------------ cohérence interne des fixtures
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const envelopeSize = e => Buffer.byteLength(JSON.stringify({ v: e.v, id: e.id, tier: e.tier, kg: e.kg, rev: e.rev, del: e.del, n: e.n, ct: e.ct }));

test('enveloppes : ct = bourrage multiple de 256 + tag ; jetons : le relais ne garde que SHA-256', () => {
  for (const [name, fx] of fixtures) {
    for (const s of fx.steps) {
      const envs = [...(s.request.body?.changes || []), ...((s.response.body?.changes || []).map(c => c.envelope))];
      for (const e of envs) {
        assert.doesNotMatch(e.ct + e.n, /[+/=]/, 'base64url sans bourrage');
        const ct = Buffer.from(e.ct, 'base64url');
        assert.equal((ct.length - 16) % 256, 0, `${name} ${s.name}: taille de ct`);
        assert.ok(ct.length - 16 >= 256);
        assert.equal(Buffer.from(e.n, 'base64url').length, 12);
      }
      // seq strictement croissants dans un tirage
      if (s.response.body?.changes) {
        const seqs = s.response.body.changes.map(c => c.seq);
        for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], `${name} ${s.name}: seq croissants`);
        if (seqs.length) assert.equal(s.response.body.nextSeq, seqs.at(-1));
        else assert.equal(s.response.body.nextSeq, Number(new URL('https://x' + s.request.path).searchParams.get('since')));
      }
      // résultats de poussée : seq ssi accepted, ordre et ids du lot
      if (s.response.body?.results) {
        assert.deepEqual(s.response.body.results.map(r => r.id), s.request.body.changes.map(c => c.id), `${name} ${s.name}: ordre des résultats`);
        for (const [i, r] of s.response.body.results.entries()) {
          assert.equal('seq' in r, r.status === 'accepted', `${name} ${s.name}: seq ssi accepted`);
          if (r.status === 'accepted' || r.status === 'duplicate') assert.equal(r.rev, s.request.body.changes[i].rev);
          if (r.status === 'superseded') assert.ok(r.rev > s.request.body.changes[i].rev, 'superseded ⇒ rev serveur strictement plus grand');
        }
      }
    }
    // le relais hache le jeton tel que reçu (64 hex ASCII minuscules), jamais les 32 octets bruts (CRYPTO.md)
    for (const [tok, h] of [[fx.vectors?.syncToken, fx.vectors?.syncTokenHash], [fx.vectors?.recoveryToken, fx.vectors?.recoveryTokenHash], [fx.vectors?.newSyncToken, fx.vectors?.newSyncTokenHash]]) {
      if (!tok) continue;
      assert.match(tok, /^[0-9a-f]{64}$/);
      assert.equal(h, sha256(Buffer.from(tok, 'ascii')).toString('hex'));
      assert.notEqual(h, sha256(Buffer.from(tok, 'hex')).toString('hex'));
    }
  }
});

test('cycle de vie : l\'occupation (usage.bytes) suit la définition « taille sérialisée compacte »', () => {
  const fx = fixtures.find(([n]) => n === 'vault-lifecycle.json')[1];
  const push = fx.steps.find(s => s.step === 5);
  const expected = push.request.body.changes.reduce((a, e) => a + envelopeSize(e), 0);
  assert.equal(push.response.body.usage.bytes, expected);
  assert.equal(push.response.body.usage.records, 3);
  const headerStep = fx.steps.find(s => s.step === 8);
  assert.equal(headerStep.response.body.usage.bytes, expected);
  assert.equal(headerStep.response.body.header.vaultId, fx.vectors.vaultId);
  // un jeton de récupération ne donne que l'en-tête
  assert.equal(fx.steps.find(s => s.step === 9).response.body.error, 'forbidden');
  // code du coffre : 2 bits nuls + 128 bits en Crockford, groupes 6-5-5-5-5
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bits = '00' + [...Buffer.from(fx.vectors.vaultId, 'hex')].map(b => b.toString(2).padStart(8, '0')).join('');
  let code = ''; for (let i = 0; i < 26; i++) code += CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  assert.equal(fx.qr.parsed.id, code);
  assert.equal(fx.qr.vaultCode, [code.slice(0, 6), code.slice(6, 11), code.slice(11, 16), code.slice(16, 21), code.slice(21)].join('-'));
});

// ------------------------------------------------------------------ appairage : vecteur recalculé
test('appairage : le vecteur se recalcule à l\'octet (X25519, HKDF, SAS, AES-GCM, HMAC, preuves)', () => {
  const fx = fixtures.find(([n]) => n === 'pairing-happy-path.json')[1];
  const v = fx.vectors;
  const hkdf = (ikm, info) => Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32));
  const key = priv => createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(priv, 'hex')]), format: 'der', type: 'pkcs8' });
  const kN = key(v.nN), kE = key(v.nE);
  const pkN = Buffer.from(createPublicKey(kN).export({ format: 'jwk' }).x, 'base64url');
  const pkE = Buffer.from(createPublicKey(kE).export({ format: 'jwk' }).x, 'base64url');
  assert.equal(pkN.toString('base64url'), v.pkN);
  assert.equal(pkE.toString('base64url'), v.pkE);
  const S = diffieHellman({ privateKey: kN, publicKey: createPublicKey(kE) });
  assert.equal(S.toString('hex'), v.S);
  assert.equal(diffieHellman({ privateKey: kE, publicKey: createPublicKey(kN) }).toString('hex'), v.S, 'S identique des deux côtés');
  const slot = sha256(pkN);
  assert.equal(slot.toString('hex'), v.slot);
  // HKDF-SHA256, sel vide, info = "qafila/v1/<usage>" || pkN || pkE
  const info = usage => Buffer.concat([Buffer.from(`qafila/v1/${usage}`), pkN, pkE]);
  assert.equal(hkdf(S, info('pair')).toString('hex'), v.kPair);
  assert.equal(hkdf(S, info('pair-mac')).toString('hex'), v.kMac);
  assert.equal(hkdf(S, info('pair-read')).toString('hex'), v.kRead);
  const sasBytes = hkdf(S, info('pair-sas'));
  assert.equal(sasBytes.toString('hex'), v.sasBytes);
  assert.equal(String(sasBytes.readUInt32BE(0) % 1000000).padStart(6, '0'), v.sas);
  assert.equal(v.sasDisplay, `${v.sas.slice(0, 3)} ${v.sas.slice(3)}`);
  // QR
  assert.equal(fx.qr.uri, `qafila://pair?v=1&s=${encodeURIComponent(fx.qr.parsed.s)}&pk=${v.pkN}`);
  const u = new URL(fx.qr.uri);
  assert.equal(u.protocol, 'qafila:'); assert.equal(u.hostname, 'pair');
  assert.deepEqual([...u.searchParams.keys()], ['v', 's', 'pk']);
  // paquet : JSON canonique (clés triées) + bourrage 0x80 + zéros jusqu'à un multiple de 256
  const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : (x && typeof x === 'object') ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
  assert.equal(canonical(v.packetPlaintext), v.packetCanonical);
  const ct = Buffer.from(v.ct, 'base64url');
  assert.equal(ct.length - 16, v.paddedLength);
  assert.equal(v.paddedLength % 256, 0);
  const d = createDecipheriv('aes-256-gcm', Buffer.from(v.kPair, 'hex'), Buffer.from(v.n, 'base64url'));
  d.setAAD(Buffer.from(`qafila/v1/pair|${v.slot}`)); d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  const body = Buffer.from(v.packetCanonical, 'utf8');
  assert.equal(padded.subarray(0, body.length).toString('utf8'), v.packetCanonical);
  assert.equal(padded[body.length], 0x80);
  assert.ok(padded.subarray(body.length + 1).every(b => b === 0), 'zéros après 0x80');
  assert.deepEqual(JSON.parse(v.packetCanonical), fx.decrypted.packet);
  assert.equal(fx.decrypted.packet.vmk, v.vmk);
  // ré-chiffrement avec le même nonce ⇒ même ct (déterminisme du vecteur)
  const c = createCipheriv('aes-256-gcm', Buffer.from(v.kPair, 'hex'), Buffer.from(v.n, 'base64url')); c.setAAD(Buffer.from(`qafila/v1/pair|${v.slot}`));
  assert.equal(Buffer.concat([c.update(padded), c.final(), c.getAuthTag()]).toString('base64url'), v.ct);
  // mac, commit, preuve de lecture
  assert.equal(createHmac('sha256', Buffer.from(v.kMac, 'hex')).update(Buffer.concat([pkN, pkE, ct])).digest('base64url'), v.mac);
  assert.equal(sha256(ct).toString('hex'), v.commit);
  const readProof = createHmac('sha256', Buffer.from(v.kRead, 'hex')).update(slot).digest();
  assert.equal(readProof.toString('hex'), v.readProof);
  assert.equal(sha256(readProof).toString('hex'), v.readProofHash);
  // les étapes HTTP portent exactement ces valeurs
  const byStep = Object.fromEntries(fx.steps.map(s => [s.step, s]));
  for (const s of fx.steps) assert.ok(s.request.path.endsWith(`/pairing/${v.slot}`) || s.request.path.includes('/vaults/'), `${s.name}: chemin`);
  assert.deepEqual(byStep[2].request.body, { v: 1, pkN: v.pkN, pkE: v.pkE, commit: v.commit, readProofHash: v.readProofHash });
  assert.equal(byStep[3].response.body.error, 'pairing_slot_taken');
  assert.notEqual(byStep[3].request.body.pkE, v.pkE, 'l\'intrus a sa propre clé');
  assert.equal(byStep[4].response.body.state, 'answered');
  assert.equal(byStep[5].response.body.error, 'pairing_not_open', 'preuve avant le tour 2 : refusée');
  assert.deepEqual(byStep[6].request.body, { n: v.n, ct: v.ct, mac: v.mac });
  assert.equal(sha256(Buffer.from(byStep[6].request.body.ct, 'base64url')).toString('hex'), byStep[2].request.body.commit, 'tour 2 lié au tour 1 par commit');
  assert.equal(byStep[7].request.headers['X-Qafila-Pair-Proof'], v.readProof);
  assert.equal(sha256(Buffer.from(byStep[7].request.headers['X-Qafila-Pair-Proof'], 'hex')).toString('hex'), byStep[2].request.body.readProofHash, 'preuve de lecture = préimage du hash déposé');
  const packet = byStep[7].response.body.packet;
  assert.deepEqual({ n: packet.n, ct: packet.ct, mac: packet.mac }, byStep[6].request.body, 'le paquet rendu est celui déposé');
  assert.deepEqual({ v: packet.v, pkN: packet.pkN, pkE: packet.pkE }, { v: 1, pkN: v.pkN, pkE: v.pkE }, 'complété par le tour 1');
  assert.equal(fx.decrypted.packet.keyGeneration, fx.decrypted.packet.header.keyGeneration);
  assert.equal(byStep[8].response.body.error, 'pairing_gone', 'lecture unique');
  assert.equal(byStep[2].response.body.expiresAt - 600000 > 0, true);
  // le relais ne voit jamais : S, K_pair, VMK, SAS, readProof avant lecture
  const relaySees = JSON.stringify(fx.steps.map(s => [s.request.body, s.response.body]));
  for (const secret of [v.S, v.kPair, v.vmk, v.nN, v.nE, v.kMac, v.kRead]) assert.ok(!relaySees.includes(secret), 'secret jamais sur le fil');
});

test('appairage : la fixture et shared/vectors/pairing.json (CRYPTO.md) racontent le même échange', (t) => {
  const path = join(here, '..', 'vectors', 'pairing.json');
  let cv; try { cv = JSON.parse(readFileSync(path, 'utf8')); } catch { t.skip('vectors/pairing.json absent'); return; }
  const v = fixtures.find(([n]) => n === 'pairing-happy-path.json')[1].vectors;
  if (cv.new?.privateKey !== v.nN || cv.existing?.privateKey !== v.nE) { t.skip('clés différentes : pas de comparaison'); return; }
  // Une divergence ici signifie que PROTOCOL.md et CRYPTO.md ne décrivent plus le même appairage : à réconcilier avant toute implémentation.
  assert.equal(cv.sharedSecret, v.S, 'S');
  assert.equal(cv.slot, v.slot, 'slot');
  assert.equal(cv.k, v.kPair, 'K_pair');
  assert.equal(cv.kMac, v.kMac, 'K_mac');
  assert.equal(cv.kRead, v.kRead, 'K_read');
  assert.equal(cv.sas, v.sas, 'SAS');
  assert.equal(cv.readProof, v.readProof, 'readProof');
  assert.equal(cv.packet?.ct, v.ct, 'ct');
  assert.equal(cv.packet?.mac, v.mac, 'mac');
  assert.equal(cv.payloadCanonical, v.packetCanonical, 'charge canonique');
});

// ------------------------------------------------------------------ fusion : règles §5 rejouées
function mergeRecord(current, incoming) {
  // current / incoming : { rev, content } ; renvoie le nouvel état local. LWW sur rev, historique pour les logins.
  if (!current) return incoming;
  if (incoming.rev === current.rev) return current; // idempotence
  const [winner, loser] = incoming.rev > current.rev ? [incoming, current] : [current, incoming];
  if (winner.content.type === 'login' && !winner.content.deleted && !loser.content.deleted && loser.content.password !== winner.content.password
      && !winner.content.passwordHistory.some(h => h.password === loser.content.password)) {
    const history = [...winner.content.passwordHistory, { password: loser.content.password, changedAt: loser.content.passwordChangedAt }].slice(-10);
    return { rev: winner.rev, content: { ...winner.content, passwordHistory: history }, dirty: true };
  }
  return winner;
}

test('fusion : deux appareils éditent le même favori et le même identifiant, convergence LWW', () => {
  const fx = fixtures.find(([n]) => n === 'merge-two-devices.json')[1];
  for (const sc of fx.scenarios) {
    const content = rev => fx.decrypted[rev];
    const base = { rev: sc.base.rev, content: content(sc.base.rev) };
    const edits = { A: { rev: sc.edits.A.rev, content: content(sc.edits.A.rev) }, B: { rev: sc.edits.B.rev, content: content(sc.edits.B.rev) } };
    assert.ok(edits.A.rev > base.rev && edits.B.rev > base.rev, `${sc.name}: les éditions suivent la base`);
    assert.notEqual(edits.A.rev, edits.B.rev);
    const expectedWinner = edits.A.rev > edits.B.rev ? 'A' : 'B';
    assert.equal(sc.expected.winner, expectedWinner, `${sc.name}: le gagnant est le plus grand rev`);
    // trois ordres d'application, un seul résultat
    const orders = [['A', 'B'], ['B', 'A'], ['A', 'B', 'A', 'B']];
    const results = orders.map(order => order.reduce((state, who) => mergeRecord(state, edits[who]), base));
    for (const r of results) assert.deepEqual(r.content, sc.expected.record, `${sc.name}: convergence`);
    // relais : même règle à l'aveugle sur le rev en clair
    const serverRev = sc.arrivalOrder.reduce((cur, who) => (!cur || edits[who].rev > cur ? edits[who].rev : cur), null);
    assert.equal(serverRev, edits[expectedWinner].rev);
    if (sc.name === 'bookmark') {
      assert.equal(sc.expected.record.title, base.content.title, 'le renommage du perdant est perdu (LWW entier)');
      assert.equal(sc.expected.record.folderId, edits.B.content.folderId);
      const pullStep = fx.steps.find(s => s.step === 3);
      const bm = pullStep.response.body.changes.find(c => c.envelope.id === sc.id);
      assert.equal(bm.envelope.rev, edits.B.rev);
      assert.ok(Number(bm.envelope.rev.slice(0, 13)) >= sc.expected.hlcAfterPullOnA.lastMsAtLeast, 'A adopte lastMs ≥ ms du rev reçu');
      const pushA = fx.steps.find(s => s.step === 4).response.body.results.find(r => r.id === sc.id);
      assert.equal(pushA.status, 'superseded'); assert.equal(pushA.rev, edits.B.rev);
    }
    if (sc.name === 'login') {
      assert.equal(sc.expected.record.passwordHistory.length, base.content.passwordHistory.length + 1 + sc.expected.historyGrowsBy);
      const loser = expectedWinner === 'A' ? edits.B : edits.A;
      assert.ok(sc.expected.record.passwordHistory.some(h => h.password === loser.content.password), 'le mot de passe perdant est archivé');
      assert.equal(sc.expected.record.password, edits[expectedWinner].content.password);
      // la ré-écriture fusionnée porte un rev strictement supérieur à tout rev vu
      const merged = fx.steps.find(s => s.step === 5).request.body.changes[0];
      assert.ok(merged.rev > edits.A.rev && merged.rev > edits.B.rev);
      assert.equal(merged.rev.slice(0, 13), edits.A.rev.slice(0, 13), 'même ms : le compteur HLC a avancé');
    }
  }
});

test('révocation : nouveau coffre en kg+1, ancien effacé, l\'appareil révoqué n\'a plus rien', () => {
  const fx = fixtures.find(([n]) => n === 'revocation-key-generation-bump.json')[1];
  const v = fx.vectors;
  assert.notEqual(v.oldVaultId, v.newVaultId); assert.notEqual(v.oldSyncToken, v.newSyncToken);
  assert.equal(v.newKeyGeneration, v.oldKeyGeneration + 1);
  const create = fx.steps.find(s => s.step === 1);
  assert.equal(create.request.body.header.keyGeneration, v.newKeyGeneration);
  assert.equal(create.request.headers.Authorization, `Bearer ${v.newSyncToken}`);
  for (const e of fx.steps.find(s => s.step === 2).request.body.changes) assert.equal(e.kg, v.newKeyGeneration);
  assert.equal(fx.steps.find(s => s.step === 3).response.body.error, 'key_generation_mismatch');
  assert.equal(fx.steps.find(s => s.step === 4).request.method, 'DELETE');
  for (const n of [5, 6, 8]) assert.equal(fx.steps.find(s => s.step === n).response.body.error, 'vault_not_found');
  assert.equal(fx.steps.find(s => s.step === 7).response.body.error, 'unauthorized');
  assert.equal(fx.clientStateAfter.L.paused.reason, 'vault_not_found');
  assert.equal(fx.clientStateAfter.E.paused, null);
});
