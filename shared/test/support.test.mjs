// Le lien de soutien est vide (pas encore ouvert) ou un lien Stripe en https.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../support.json', import.meta.url), 'utf8'))

test('support.json : lien Stripe https ou vide', () => {
  assert.equal(typeof cfg.stripePaymentLink, 'string')
  assert.ok(Array.isArray(cfg.allowedHosts) && cfg.allowedHosts.length > 0)
  if (cfg.stripePaymentLink === '') return
  const u = new URL(cfg.stripePaymentLink)
  assert.equal(u.protocol, 'https:')
  assert.ok(cfg.allowedHosts.includes(u.hostname), `hôte non autorisé : ${u.hostname}`)
})
