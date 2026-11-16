'use strict';
// Noms et marques des fichiers téléchargés, sans dépendance à Electron (testé par node --test).
const path = require('node:path');

// Noms de périphériques Windows (aussi suivis d'une extension : « nul.txt », « COM1.tar.gz »).
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)$/i;
const MAX_NAME = 200;
const MAX_EXT = 32;

/**
 * Nom de fichier sûr sur les trois systèmes, 200 caractères au plus. Caractères interdits remplacés ; points et
 * espaces de tête (fichier caché, « .. ») et de fin retirés (Windows les supprime en silence : « setup.exe. »
 * deviendrait « setup.exe » une fois écrit) ; nom trop long coupé AVANT l'extension (jamais au milieu d'un caractère),
 * pour que l'extension testée soit celle du fichier écrit ; nom de périphérique Windows préfixé de « _ ».
 */
function safeFilename(filename) {
  const s = String(filename || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  let ext = path.extname(s);
  if (ext.length > MAX_EXT) ext = '';
  let stem = s.slice(0, s.length - ext.length);
  if (stem.length + ext.length > MAX_NAME) {
    stem = stem.slice(0, MAX_NAME - ext.length);
    if (/[\ud800-\udbff]$/.test(stem)) stem = stem.slice(0, -1);
    stem = stem.replace(/[. ]+$/, '');
  }
  if (!stem) stem = 'download';
  if (WINDOWS_DEVICE.test(stem.split('.')[0].trimEnd())) stem = `_${stem}`;
  return stem + ext;
}

/** Extension en minuscules (sans point) du nom tel qu'il sera écrit. */
function extensionOf(filename) { return path.extname(safeFilename(filename)).slice(1).toLowerCase(); }

/**
 * Contenu du flux Zone.Identifier (Windows). Adresse source seulement pour un téléchargement web non privé, sans
 * identifiant, mot de passe ni fragment (comme SanitizeUrlForQuarantine de Chromium) : le flux est lisible par tout
 * programme et suit le fichier (copie NTFS, extraction ZIP).
 */
function zoneIdentifier(url, isPrivate) {
  let host = '';
  if (!isPrivate && /^https?:\/\//i.test(String(url || ''))) {
    try { const u = new URL(url); u.username = ''; u.password = ''; u.hash = ''; host = /[\r\n]/.test(u.href) ? '' : u.href; } catch { host = ''; }
  }
  return `[ZoneTransfer]\r\nZoneId=3\r\n${host ? `HostUrl=${host}\r\n` : ''}`;
}

module.exports = { safeFilename, extensionOf, zoneIdentifier };
