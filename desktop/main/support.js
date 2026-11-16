'use strict';
// « Soutenir Qafila » sur PC : ouvre le lien de paiement Stripe du propriétaire (shared/support.json, clé
// stripePaymentLink) dans le NAVIGATEUR PAR DÉFAUT du système (Apple Pay / Google Pay / carte se font sur la page
// Stripe). Jamais dans un onglet Qafila, aucun achat ni déblocage dans l'application, pas d'icône Or sur PC.
const { shell } = require('electron');
const contract = require('./contract');

const STRIPE_HOSTS = new Set(['buy.stripe.com', 'donate.stripe.com', 'checkout.stripe.com']);

/** Lit et valide le lien : https et hôte présent dans allowedHosts ; sinon null (lien vide = pas encore ouvert). */
function paymentLink() {
  let cfg;
  try { cfg = contract.readJSONFresh('support.json'); } catch { return { configured: false, url: null, reason: 'missing' }; }
  const raw = typeof cfg?.stripePaymentLink === 'string' ? cfg.stripePaymentLink.trim() : '';
  if (!raw) return { configured: false, url: null, reason: 'empty' };
  // Hôtes acceptés : ceux de Stripe inscrits dans le code ET dans le fichier. support.json est hors de l'archive
  // vérifiée (resources/shared) : qui peut changer le lien ne peut pas élargir la liste pour autant.
  const allowed = new Set((Array.isArray(cfg.allowedHosts) ? cfg.allowedHosts : []).map((h) => String(h).toLowerCase()).filter((h) => STRIPE_HOSTS.has(h)));
  let u;
  try { u = new URL(raw); } catch { return { configured: false, url: null, reason: 'invalid' }; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed.has(u.hostname.toLowerCase())) {
    return { configured: false, url: null, reason: 'refused' };
  }
  return { configured: true, url: u.toString(), reason: null };
}

/** État pour la ligne des réglages (grisée « Bientôt disponible » si non configuré). L'adresse n'est pas exposée. */
function info() { const l = paymentLink(); return { configured: l.configured, reason: l.reason }; }

/** Ouvre la page de paiement dans le navigateur du système ; refuse tout lien non conforme. */
async function open() {
  const l = paymentLink();
  if (!l.configured) return false;
  try { await shell.openExternal(l.url, { activate: true }); return true; } catch { return false; }
}

module.exports = { paymentLink, info, open };
