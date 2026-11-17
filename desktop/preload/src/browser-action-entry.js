'use strict';
// Source du préchargement « boutons d'extensions » du chrome : élément <browser-action-list> (icônes des extensions,
// badges, fenêtres des extensions). Assemblé par `npm run build:preload` dans preload/browser-action.js : un
// préchargement en bac à sable ne peut charger que le module electron, d'où un fichier autonome.
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action');

if (location.protocol === 'file:' && /\/renderer\/index\.html$/.test(location.pathname)) injectBrowserAction();
