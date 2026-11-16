'use strict';
// Identifiant de l'application (AppUserModelID sous Windows) : doit rester égal à build.appId de package.json, que
// les raccourcis NSIS portent. electron-builder retire « build » du package.json empaqueté : la valeur ne peut donc
// pas y être lue à l'exécution (test/unit.test.mjs vérifie l'égalité).
const APP_ID = 'fr.qafila.desktop';

module.exports = { APP_ID };
