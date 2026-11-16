/*
 * Qafila — script de détection et de remplissage des formulaires de connexion.
 * Contrat : shared/FORMS.md. Injecté tel quel (ES2017, sans module, sans dépendance) au « document start »
 * dans WKWebView (WKContentWorld dédié), Android WebView (addDocumentStartJavaScript) et Electron (preload,
 * monde isolé). Idempotent : une seconde injection ne fait rien.
 *
 * Expose window.__qafilaForms = { version, frame, detect(), fill(credential), observe(callback), captureSubmit(callback) }.
 * Le script ne connaît jamais le coffre : fill() reçoit une valeur après le tap de l'utilisateur, une fois.
 * Il ne soumet jamais un formulaire, ne remplit jamais dans un cadre enfant ni pour une autre origine.
 */
(function () {
  'use strict';

  var VERSION = 1;

  if (typeof window === 'undefined' || typeof document === 'undefined') { return; }
  if (window.__qafilaForms && window.__qafilaForms.version === VERSION) { return; }

  var doc = document;
  var win = window;

  // ------------------------------------------------------------------ références natives capturées
  // Capturées au « document start », avant tout script de la page (utile là où il n'y a pas de monde isolé).
  var ElementProto = win.Element.prototype;
  var NodeProto = win.Node.prototype;
  var qsa = ElementProto.querySelectorAll;
  var docQsa = win.Document.prototype.querySelectorAll;
  var docQs = win.Document.prototype.querySelector;
  var matches = ElementProto.matches || ElementProto.webkitMatchesSelector;
  var closest = ElementProto.closest;
  var getAttribute = ElementProto.getAttribute;
  var contains = NodeProto.contains;
  var dispatchEvent = win.EventTarget.prototype.dispatchEvent;
  var addEventListener = win.EventTarget.prototype.addEventListener;
  var removeEventListener = win.EventTarget.prototype.removeEventListener;
  var getComputedStyle = win.getComputedStyle;
  var inputValueDesc = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  var inputValueSet = inputValueDesc && inputValueDesc.set;
  var inputValueGet = inputValueDesc && inputValueDesc.get;
  var InputEventCtor = typeof win.InputEvent === 'function' ? win.InputEvent : null;
  var EventCtor = win.Event;
  var MutationObserverCtor = win.MutationObserver;
  var JSONStringify = JSON.stringify;
  var Now = Date.now;
  var setTimeoutFn = win.setTimeout;
  var clearTimeoutFn = win.clearTimeout;

  var isTopFrame = (function () { try { return win.top === win; } catch (e) { return false; } })();

  var MAX_FORMS = 5;
  var MAX_FIELDS = 8;
  var OBSERVE_DEBOUNCE_MS = 150;
  var SUBMIT_DEDUPE_MS = 3000;

  // ------------------------------------------------------------------ utilitaires
  function attr(el, name) { try { return getAttribute.call(el, name); } catch (e) { return null; } }
  function lower(s) { return (s == null ? '' : String(s)).toLowerCase(); }
  function fold(s) {
    // minuscules, accents retirés, espaces normalisés : « Mot de passe actuel » → « mot de passe actuel »
    var t = lower(s);
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* normalize absent : on garde */ }
    return t.replace(/\s+/g, ' ').trim();
  }
  function isElement(n) { return !!n && n.nodeType === 1; }
  function localName(el) { return lower(el.localName || el.tagName); }
  function isInput(el) { return isElement(el) && localName(el) === 'input'; }
  function inputType(el) { return lower(attr(el, 'type') || 'text').trim() || 'text'; }
  function autocompleteTokens(el) {
    var raw = attr(el, 'autocomplete');
    if (raw == null) { return []; }
    return lower(raw).split(/\s+/).filter(function (t) { return t.length > 0; });
  }
  function autocompleteValue(el) {
    var raw = attr(el, 'autocomplete');
    if (raw == null) { return null; }
    var v = lower(raw).replace(/\s+/g, ' ').trim();
    return v.length ? v : null;
  }
  function hasToken(el, token) { return autocompleteTokens(el).indexOf(token) !== -1; }
  function arrayFrom(list) { var out = []; for (var i = 0; i < list.length; i++) { out.push(list[i]); } return out; }
  function all(root, selector) {
    try { return arrayFrom((root === doc ? docQsa : qsa).call(root, selector)); } catch (e) { return []; }
  }
  function originOf(href) {
    try {
      var u = new win.URL(href, doc.baseURI);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { return null; }
      return u.origin;
    } catch (e) { return null; }
  }
  function pageOrigin() {
    try {
      var o = win.location.origin;
      if (o && o !== 'null' && /^https?:\/\//.test(o)) { return o; }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Environnement avec mise en page ? (jsdom et les documents non rendus n'en ont pas : on ignore alors la géométrie)
  function hasLayout() {
    try {
      var de = doc.documentElement;
      if (!de) { return false; }
      var r = de.getBoundingClientRect();
      return (r.width > 0 || r.height > 0 || de.clientWidth > 0);
    } catch (e) { return false; }
  }

  // Visible = rendu : ni type=hidden, ni attribut hidden, ni display:none / visibility:hidden / opacity:0 /
  // aria-hidden sur l'élément ou un ancêtre, ni boîte vide ou hors écran à gauche / en haut quand la mise en page existe.
  function isRendered(el, layout) {
    if (!isElement(el)) { return false; }
    if (isInput(el) && inputType(el) === 'hidden') { return false; }
    for (var n = el; isElement(n); n = n.parentElement) {
      if (n.hidden === true) { return false; }
      if (attr(n, 'aria-hidden') === 'true') { return false; }
      var cs = null;
      try { cs = getComputedStyle.call(win, n); } catch (e) { cs = null; }
      if (cs) {
        if (cs.display === 'none') { return false; }
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') { return false; }
        if (cs.opacity === '0') { return false; }
      }
    }
    if (layout) {
      try {
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) { return false; }
        if (r.right <= 0 || r.bottom <= 0) { return false; }
      } catch (e) { /* ignore */ }
    }
    return true;
  }

  // Chemin CSS déterministe : #id (si unique et simple) sinon tag:nth-of-type(n) depuis <body>. Voir FORMS.md §3.5.
  function selectorPath(el) {
    var parts = [];
    var de = doc.documentElement;
    for (var n = el; isElement(n) && n !== de; n = n.parentElement) {
      var id = attr(n, 'id');
      if (id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) && all(doc, '#' + id).length === 1) {
        parts.unshift('#' + id);
        return parts.join(' > ');
      }
      var tag = localName(n);
      var idx = 1;
      for (var s = n.previousElementSibling; s; s = s.previousElementSibling) {
        if (localName(s) === tag) { idx++; }
      }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
    }
    return parts.join(' > ');
  }
  function byPath(path) {
    if (typeof path !== 'string' || !path) { return null; }
    try { return docQs.call(doc, path); } catch (e) { return null; }
  }

  // Texte descriptif d'un champ : name, id, placeholder, aria-label, aria-labelledby, <label for>, label parent, title.
  function fieldText(el) {
    var bits = [attr(el, 'name'), attr(el, 'id'), attr(el, 'placeholder'), attr(el, 'aria-label'), attr(el, 'title'), attr(el, 'class')];
    var labelledby = attr(el, 'aria-labelledby');
    if (labelledby) {
      labelledby.split(/\s+/).forEach(function (id) {
        var l = id && byPath('#' + id.replace(/[^A-Za-z0-9_-]/g, ''));
        if (l) { bits.push(l.textContent); }
      });
    }
    try {
      var labels = el.labels;
      if (labels && labels.length) { for (var i = 0; i < labels.length; i++) { bits.push(labels[i].textContent); } }
    } catch (e) { /* ignore */ }
    var pl = closest.call(el, 'label');
    if (pl) { bits.push(pl.textContent); }
    return fold(bits.filter(function (b) { return b != null && b !== ''; }).join(' | '));
  }

  // Mots-clés (texte « plié » : minuscules sans accents). Voir FORMS.md §3.3.
  var RE_USERNAME = /user|usr|\blogin|log-?in|e-?mail|courriel|\bmail\b|identifiant|identifier|pseudo|\bnick|account|compte|phone|\btel\b|telephone|mobile|membre|member|utilisateur|sign-?in|\buid\b|customer|client|nom d.?utilisateur/;
  var RE_USERNAME_STRONG = /e-?mail|courriel|identifiant|utilisateur|username|\blogin\b|log-?in/;
  var RE_NOT_USERNAME = /search|recherche|captcha|\botp\b|one-?time|\bzip|postal|postcode|\bcity\b|\bville\b|first[_ -]?name|last[_ -]?name|prenom|surname|given[_ -]?name|family[_ -]?name|\baddress\b|\badresse\b|street|\brue\b|company|societe|\bcard\b|\bcarte\b|\bcvv\b|\bcvc\b|\biban\b|birth|naissance|coupon|promo|quantity|\bqty\b|subject|sujet|message|comment|newsletter|query|\bq\b|nom de famille|code postal|\bcode\b/;
  var RE_CONFIRM = /confirm|repeat|repet|again|verify|verif|retype|re-?enter|second|password2|pass2|pwd2|mdp2|\bbis\b|encore/;
  var RE_CURRENT = /current|actuel|\bold\b|ancien|existing|present/;
  var RE_SIGNUP = /sign-?up|register|registration|inscri|s.?inscrire|creer|create|\bjoin\b|rejoindre|nouveau compte|new account|get started|commencer/;
  var RE_LOGIN_BUTTON = /log-?in|sign-?in|connexion|connecter|continuer|continue|suivant|next|valider|submit|envoyer|entrer|enter|\bok\b|\bgo\b/;

  function isTextLike(el) {
    if (!isInput(el)) { return false; }
    var t = inputType(el);
    return t === 'text' || t === 'email' || t === 'tel' || t === 'hidden';
  }
  function isPasswordField(el) {
    return isInput(el) && inputType(el) === 'password' && !hasToken(el, 'one-time-code');
  }
  function inTemplate(el) { return !!closest.call(el, 'template'); }

  // Conteneur d'un champ sans <form> : premier ancêtre qui contient aussi un champ texte ou un bouton, sinon <body>.
  function containerOf(el) {
    var form = closest.call(el, 'form');
    if (form) { return form; }
    var body = doc.body || doc.documentElement;
    for (var n = el.parentElement; isElement(n) && n !== body; n = n.parentElement) {
      var inputs = all(n, 'input, button, [role="button"]');
      for (var i = 0; i < inputs.length; i++) {
        var c = inputs[i];
        if (c === el) { continue; }
        if (localName(c) === 'button' || attr(c, 'role') === 'button') { return n; }
        if (isTextLike(c) && inputType(c) !== 'hidden') { return n; }
        if (isInput(c) && (inputType(c) === 'submit' || inputType(c) === 'button')) { return n; }
      }
    }
    return body;
  }

  function submitText(container) {
    var bits = [];
    all(container, 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]').forEach(function (b) {
      bits.push(b.textContent, attr(b, 'value'), attr(b, 'aria-label'), attr(b, 'title'));
    });
    return fold(bits.filter(function (b) { return b != null && b !== ''; }).join(' | '));
  }
  function containerText(container) {
    var bits = [attr(container, 'id'), attr(container, 'name'), attr(container, 'class'), attr(container, 'action'), attr(container, 'aria-label'), attr(container, 'data-testid')];
    return fold(bits.filter(function (b) { return b != null && b !== ''; }).join(' | '));
  }

  function formActionOrigin(container) {
    if (localName(container) !== 'form') { return null; }
    var raw = attr(container, 'action');
    if (raw == null || raw.trim() === '') { return pageOrigin(); }
    return originOf(raw.trim());
  }

  // ------------------------------------------------------------------ détection
  function classifyPasswords(passwords, layout, signupHint) {
    // passwords : champs mot de passe du conteneur, ordre du document.
    var visible = passwords.filter(function (p) { return isRendered(p, layout); });
    var countable = visible.length ? visible : passwords;
    var roles = new Map();
    var hasNew = false;
    var explicitNew = countable.some(function (p) { return hasToken(p, 'new-password'); });
    var signupLike = explicitNew || countable.length >= 2 || (countable.length === 1 && signupHint);

    if (!signupLike) {
      passwords.forEach(function (p) { roles.set(p, 'password'); });
      return roles;
    }
    var seenNew = false;
    countable.forEach(function (p, i) {
      var text = fieldText(p);
      var role;
      if (hasToken(p, 'current-password')) { role = 'password'; }
      else if (hasToken(p, 'new-password')) { role = (seenNew || RE_CONFIRM.test(text)) ? 'confirmPassword' : 'newPassword'; }
      else if (RE_CURRENT.test(text) && !RE_CONFIRM.test(text)) { role = 'password'; }
      else if (RE_CONFIRM.test(text)) { role = 'confirmPassword'; }
      else if (countable.length >= 3 && i === 0 && !explicitNew) { role = 'password'; }
      else { role = seenNew ? 'confirmPassword' : 'newPassword'; }
      if (role === 'newPassword') { seenNew = true; hasNew = true; }
      roles.set(p, role);
    });
    if (!hasNew) {
      // deux champs tous deux « confirm » ou similaires : le premier devient newPassword
      for (var k = 0; k < countable.length; k++) {
        if (roles.get(countable[k]) === 'confirmPassword') { roles.set(countable[k], 'newPassword'); break; }
      }
    }
    passwords.forEach(function (p) { if (!roles.has(p)) { roles.set(p, 'password'); } });
    return roles;
  }

  function scoreUsername(el, firstPassword, layout) {
    var score = 0;
    var tokens = autocompleteTokens(el);
    var type = inputType(el);
    var text = fieldText(el);
    var rendered = isRendered(el, layout);
    if (tokens.indexOf('username') !== -1) { score += 100; }
    else if (tokens.indexOf('email') !== -1) { score += 90; }
    else if (tokens.indexOf('tel') !== -1) { score += 60; }
    else if (tokens.indexOf('off') === -1 && tokens.length && tokens.indexOf('on') === -1) { score -= 60; } // autocomplete explicite autre (name, address-line1…)
    if (type === 'email') { score += 80; }
    if (RE_USERNAME.test(text)) { score += 40; }
    if (RE_NOT_USERNAME.test(text) && tokens.indexOf('username') === -1 && tokens.indexOf('email') === -1 && type !== 'email' && !RE_USERNAME_STRONG.test(text)) { score -= 100; }
    if (rendered) { score += 50; } else if (type === 'hidden') { score -= 20; } else { score -= 10; }
    if (firstPassword) {
      var pos = 0;
      try { pos = firstPassword.compareDocumentPosition(el); } catch (e) { pos = 0; }
      if (pos & 2) { score += 30; } else { score -= 20; } // 2 = DOCUMENT_POSITION_PRECEDING
    }
    if (type === 'hidden' && !(tokens.indexOf('username') !== -1 || tokens.indexOf('email') !== -1 || RE_USERNAME.test(text))) { score -= 500; }
    if (el.disabled) { score -= 30; }
    return score;
  }

  function pickUsername(container, passwords, layout) {
    var inputs = all(container, 'input');
    var candidates = inputs.filter(function (el) {
      return isTextLike(el) && passwords.indexOf(el) === -1 && !inTemplate(el);
    });
    var first = passwords.length ? passwords[0] : null;
    var firstIndex = first ? inputs.indexOf(first) : -1;
    var best = null;
    var bestScore = -Infinity;
    var bestDistance = Infinity;
    candidates.forEach(function (el) {
      var s = scoreUsername(el, first, layout);
      if (s <= 0) { return; }
      // à score égal : le champ le plus proche du premier mot de passe (en nombre de <input> dans le conteneur)
      var dist = firstIndex >= 0 ? Math.abs(inputs.indexOf(el) - firstIndex) : 0;
      if (s > bestScore || (s === bestScore && dist < bestDistance)) { best = el; bestScore = s; bestDistance = dist; }
    });
    return best;
  }

  function describeField(el, kind, layout) {
    return {
      kind: kind,
      selectorPath: selectorPath(el),
      visible: isRendered(el, layout),
      autocomplete: autocompleteValue(el)
    };
  }

  // Analyse complète. Renvoie des entrées internes { container, fields:[{el, kind, desc}], desc }.
  function analyze() {
    var origin = pageOrigin();
    if (!isTopFrame || !origin || !doc.body) { return []; }
    var layout = hasLayout();
    var passwords = all(doc, 'input').filter(function (p) { return isPasswordField(p) && !inTemplate(p); });
    var groups = [];
    var byContainer = new Map();
    passwords.forEach(function (p) {
      var c = containerOf(p);
      var g = byContainer.get(c);
      if (!g) { g = { container: c, passwords: [] }; byContainer.set(c, g); groups.push(g); }
      g.passwords.push(p);
    });

    var entries = [];
    groups.forEach(function (g) {
      var container = g.container;
      var hint = RE_SIGNUP.test(containerText(container)) || RE_SIGNUP.test(submitText(container));
      var roles = classifyPasswords(g.passwords, layout, hint);
      var username = pickUsername(container, g.passwords, layout);
      var fields = [];
      if (username) { fields.push({ el: username, kind: 'username' }); }
      g.passwords.forEach(function (p) { fields.push({ el: p, kind: roles.get(p) }); });
      // ordre du document
      fields.sort(function (a, b) {
        var pos = a.el.compareDocumentPosition(b.el);
        return (pos & 4) ? -1 : (pos & 2) ? 1 : 0; // 4 = FOLLOWING
      });
      fields = fields.slice(0, MAX_FIELDS);
      var kinds = fields.map(function (f) { return f.kind; });
      var isSignup = kinds.indexOf('newPassword') !== -1 && kinds.indexOf('password') === -1;
      var isPasswordChange = kinds.indexOf('newPassword') !== -1 && kinds.indexOf('password') !== -1;
      var visiblePassword = g.passwords.some(function (p) { return isRendered(p, layout); });
      var rank = (visiblePassword ? 100 : 0) + (username ? 10 : 0) + (username && isRendered(username, layout) ? 5 : 0) - (isSignup ? 1 : 0);
      entries.push(makeEntry(container, fields, isSignup, isPasswordChange, origin, layout, rank));
    });

    // Formulaires « identifiant d'abord » : un champ autocomplete="username" sans mot de passe dans son conteneur.
    all(doc, 'input[autocomplete]').forEach(function (el) {
      if (!isTextLike(el) || inputType(el) === 'hidden' || inTemplate(el) || !hasToken(el, 'username')) { return; }
      var c = containerOf(el);
      if (byContainer.has(c)) { return; }
      if (all(c, 'input').some(isPasswordField)) { return; }
      if (entries.some(function (e) { return e.container === c; })) { return; }
      var rank = 20 + (isRendered(el, layout) ? 5 : 0);
      entries.push(makeEntry(c, [{ el: el, kind: 'username' }], false, false, origin, layout, rank));
    });

    entries.sort(function (a, b) {
      if (b.rank !== a.rank) { return b.rank - a.rank; }
      var pos = a.container.compareDocumentPosition(b.container);
      return (pos & 4) ? -1 : (pos & 2) ? 1 : 0;
    });
    return entries.slice(0, MAX_FORMS);
  }

  function makeEntry(container, fields, isSignup, isPasswordChange, origin, layout, rank) {
    fields.forEach(function (f) { f.desc = describeField(f.el, f.kind, layout); });
    return {
      container: container,
      fields: fields,
      rank: rank,
      desc: {
        origin: origin,
        formActionOrigin: formActionOrigin(container),
        form: localName(container) === 'form' ? selectorPath(container) : null,
        isSignup: isSignup,
        isPasswordChange: isPasswordChange,
        fields: fields.map(function (f) { return f.desc; })
      }
    };
  }

  function detect() {
    try { return analyze().map(function (e) { return e.desc; }); } catch (e) { return []; }
  }

  // ------------------------------------------------------------------ remplissage
  function setNativeValue(el, value) {
    if (!inputValueSet) { return false; }
    try { el.focus(); } catch (e) { /* ignore */ }
    inputValueSet.call(el, value);
    var ev;
    try {
      ev = InputEventCtor
        ? new InputEventCtor('input', { bubbles: true, cancelable: false, composed: true, inputType: 'insertText', data: value })
        : new EventCtor('input', { bubbles: true, cancelable: false });
    } catch (e) { ev = new EventCtor('input', { bubbles: true, cancelable: false }); }
    dispatchEvent.call(el, ev);
    dispatchEvent.call(el, new EventCtor('change', { bubbles: true, cancelable: false }));
    return true;
  }

  function fillable(f) {
    if (!f.desc.visible) { return 'hidden'; }
    if (f.el.disabled) { return 'disabled'; }
    if (f.el.readOnly) { return 'readonly'; }
    return null;
  }

  function fill(credential) {
    var result = { ok: false, filled: [], skipped: [], reason: null };
    try {
      if (!isTopFrame) { result.reason = 'frame'; return result; }
      if (!credential || typeof credential !== 'object') { result.reason = 'argument'; return result; }
      var origin = pageOrigin();
      if (!origin) { result.reason = 'origin'; return result; }
      if (typeof credential.origin !== 'string' || credential.origin !== origin) { result.reason = 'origin'; return result; }

      var entries = analyze();
      if (!entries.length) { result.reason = 'no-form'; return result; }
      var entry = null;
      if (typeof credential.form === 'string' && credential.form) {
        var target = byPath(credential.form);
        for (var i = 0; i < entries.length && target; i++) {
          if (entries[i].container === target || contains.call(entries[i].container, target)) { entry = entries[i]; break; }
        }
        if (!entry) { result.reason = 'no-form'; return result; }
      } else {
        entry = entries[0];
      }

      var wanted = {};
      if (typeof credential.username === 'string') { wanted.username = credential.username; }
      if (typeof credential.password === 'string') {
        if (entry.desc.isSignup) { wanted.newPassword = credential.password; wanted.confirmPassword = credential.password; }
        else { wanted.password = credential.password; }
      }
      if (typeof credential.newPassword === 'string') { wanted.newPassword = credential.newPassword; wanted.confirmPassword = credential.newPassword; }

      entry.fields.forEach(function (f) {
        if (!Object.prototype.hasOwnProperty.call(wanted, f.kind)) { return; }
        var why = fillable(f);
        if (why) { result.skipped.push({ kind: f.kind, reason: why }); return; }
        if (setNativeValue(f.el, wanted[f.kind])) { result.filled.push(f.kind); }
        else { result.skipped.push({ kind: f.kind, reason: 'setter' }); }
      });
      result.ok = result.filled.length > 0;
      if (!result.ok) { result.reason = 'nothing-to-fill'; }
      return result;
    } catch (e) {
      result.reason = 'error';
      return result;
    }
  }

  // ------------------------------------------------------------------ observation (SPA, focus)
  function fieldPathOf(el, entries) {
    if (!isElement(el)) { return null; }
    for (var i = 0; i < entries.length; i++) {
      for (var j = 0; j < entries[i].fields.length; j++) {
        if (entries[i].fields[j].el === el) { return entries[i].fields[j].desc.selectorPath; }
      }
    }
    return null;
  }

  function observe(callback) {
    if (typeof callback !== 'function') { return function () {}; }
    if (!isTopFrame) { return function () {}; }
    var last = null;
    var timer = null;
    var stopped = false;

    function emit(reason, focusedEl) {
      if (stopped) { return; }
      var entries;
      try { entries = analyze(); } catch (e) { entries = []; }
      var forms = entries.map(function (e) { return e.desc; });
      var json = JSONStringify(forms);
      var focused = fieldPathOf(focusedEl, entries);
      if (reason === 'mutation' && json === last) { return; }
      if (reason === 'initial' && json === last) { return; }
      last = json;
      try { callback(forms, { reason: reason, focused: focused }); } catch (e) { /* le rappel ne doit jamais casser la page */ }
    }
    function schedule() {
      if (timer !== null) { clearTimeoutFn.call(win, timer); }
      timer = setTimeoutFn.call(win, function () { timer = null; emit('mutation', doc.activeElement); }, OBSERVE_DEBOUNCE_MS);
    }
    function onFocus(e) { emit('focus', e.target); }
    function onBlur(e) {
      var entries;
      try { entries = analyze(); } catch (err) { entries = []; }
      var path = fieldPathOf(e.target, entries);
      if (!path || stopped) { return; }
      try { callback(entries.map(function (x) { return x.desc; }), { reason: 'blur', focused: null, left: path }); } catch (err) { /* ignore */ }
    }

    var mo = null;
    if (MutationObserverCtor) {
      mo = new MutationObserverCtor(schedule);
      var start = function () {
        if (stopped || !doc.documentElement) { return; }
        try {
          mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['type', 'autocomplete', 'style', 'class', 'hidden', 'disabled', 'readonly', 'aria-hidden', 'name', 'id'] });
        } catch (e) { /* ignore */ }
      };
      start();
    }
    addEventListener.call(doc, 'focusin', onFocus, true);
    addEventListener.call(doc, 'focusout', onBlur, true);
    var onReady = function () { emit('initial', doc.activeElement); };
    if (doc.readyState === 'loading') { addEventListener.call(doc, 'DOMContentLoaded', onReady, true); }
    else { setTimeoutFn.call(win, onReady, 0); }
    addEventListener.call(win, 'load', schedule, true);
    addEventListener.call(win, 'pageshow', schedule, true);
    addEventListener.call(win, 'hashchange', schedule, true);
    addEventListener.call(win, 'popstate', schedule, true);

    return function unsubscribe() {
      stopped = true;
      if (timer !== null) { clearTimeoutFn.call(win, timer); timer = null; }
      if (mo) { try { mo.disconnect(); } catch (e) { /* ignore */ } }
      removeEventListener.call(doc, 'focusin', onFocus, true);
      removeEventListener.call(doc, 'focusout', onBlur, true);
      removeEventListener.call(doc, 'DOMContentLoaded', onReady, true);
      removeEventListener.call(win, 'load', schedule, true);
      removeEventListener.call(win, 'pageshow', schedule, true);
      removeEventListener.call(win, 'hashchange', schedule, true);
      removeEventListener.call(win, 'popstate', schedule, true);
    };
  }

  // ------------------------------------------------------------------ capture de la soumission
  function valueOf(el) {
    try { return inputValueGet ? inputValueGet.call(el) : el.value; } catch (e) { return ''; }
  }

  function snapshot(entry) {
    var username = null, password = null, newPassword = null, confirm = null;
    entry.fields.forEach(function (f) {
      var v = valueOf(f.el);
      if (f.kind === 'username' && username === null && v !== '') { username = v; }
      if (f.kind === 'password' && password === null) { password = v; }
      if (f.kind === 'newPassword' && newPassword === null) { newPassword = v; }
      if (f.kind === 'confirmPassword' && confirm === null) { confirm = v; }
    });
    if (newPassword !== null && confirm !== null && confirm !== '' && confirm !== newPassword) { return null; } // confirmation différente : le site refusera
    if (newPassword === '') { newPassword = null; }
    if (password === '') { password = null; }
    if (password === null && newPassword === null) { return null; }
    return {
      origin: entry.desc.origin,
      formActionOrigin: entry.desc.formActionOrigin,
      form: entry.desc.form,
      username: username,
      password: password,
      newPassword: newPassword,
      isSignup: entry.desc.isSignup,
      isPasswordChange: entry.desc.isPasswordChange
    };
  }

  function captureSubmit(callback) {
    if (typeof callback !== 'function') { return function () {}; }
    if (!isTopFrame) { return function () {}; }
    var lastKey = null;
    var lastAt = 0;
    var stopped = false;

    function report(container) {
      if (stopped || !isElement(container)) { return; }
      var entries;
      try { entries = analyze(); } catch (e) { return; }
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (en.container === container || contains.call(en.container, container) || contains.call(container, en.container)) {
          var snap = snapshot(en);
          if (!snap) { continue; }
          var key = JSONStringify([snap.form, snap.username, snap.password, snap.newPassword]);
          var now = Now();
          if (key === lastKey && now - lastAt < SUBMIT_DEDUPE_MS) { return; }
          lastKey = key; lastAt = now;
          try { callback(snap); } catch (e) { /* ignore */ }
          return;
        }
      }
    }

    function onSubmit(e) {
      var t = e.target;
      if (isElement(t) && localName(t) === 'form') { report(t); }
    }
    function onClick(e) {
      var t = e.target;
      if (!isElement(t)) { return; }
      var btn = closest.call(t, 'button, input[type="submit"], input[type="image"], input[type="button"], [role="button"], a');
      if (!btn) { return; }
      var form = btn.form || closest.call(btn, 'form');
      if (form) {
        var type = lower(attr(btn, 'type') || '');
        var isSubmit = (localName(btn) === 'button' && (type === '' || type === 'submit')) ||
          (isInput(btn) && (type === 'submit' || type === 'image'));
        if (isSubmit) { report(form); }
        else if (RE_LOGIN_BUTTON.test(fold(btn.textContent + ' ' + (attr(btn, 'value') || '')))) { report(form); }
        return;
      }
      // Sans <form> : un bouton (ou un élément à rôle de bouton) du conteneur suffit ; un simple lien (« Mot de
      // passe oublié ? ») ne compte que si son texte ressemble à une connexion.
      if (localName(btn) === 'a' && attr(btn, 'role') !== 'button' &&
        !RE_LOGIN_BUTTON.test(fold(btn.textContent + ' ' + (attr(btn, 'aria-label') || '')))) { return; }
      report(containerOf(btn));
    }
    function onKey(e) {
      if (e.key !== 'Enter' || e.isComposing) { return; }
      var t = e.target;
      if (!isInput(t)) { return; }
      if (closest.call(t, 'form')) { return; } // la soumission implicite émettra « submit »
      var c = containerOf(t);
      if (all(c, 'input').some(isPasswordField)) { report(c); }
    }

    addEventListener.call(doc, 'submit', onSubmit, true);
    addEventListener.call(doc, 'click', onClick, true);
    addEventListener.call(doc, 'keydown', onKey, true);
    return function unsubscribe() {
      stopped = true;
      removeEventListener.call(doc, 'submit', onSubmit, true);
      removeEventListener.call(doc, 'click', onClick, true);
      removeEventListener.call(doc, 'keydown', onKey, true);
    };
  }

  // ------------------------------------------------------------------ exposition (verrouillée)
  var api = Object.freeze({
    version: VERSION,
    frame: isTopFrame ? 'top' : 'child',
    detect: detect,
    fill: fill,
    observe: observe,
    captureSubmit: captureSubmit
  });
  try {
    Object.defineProperty(win, '__qafilaForms', { value: api, writable: false, configurable: false, enumerable: false });
  } catch (e) {
    try { win.__qafilaForms = api; } catch (e2) { /* ignore */ }
  }
})();
