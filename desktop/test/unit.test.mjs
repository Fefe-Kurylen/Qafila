// Tests unitaires (node --test) : liste blanche du lecteur, CSP des pages locales, adresses d'icônes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scripts = require('../main/scripts.js');
const { safeFaviconURL } = require('../main/favicon.js');

test('lecteur : aucun attribut on*, aucun lien javascript:, aucune balise script', () => {
  const tree = { t: 'article', a: {}, c: [
    'a <b> & "c"',
    { t: 'img', a: { src: 'https://example.org/a.png', onerror: 'alert(1)', alt: '"><script>' }, c: [] },
    { t: 'img', a: { src: 'javascript:alert(1)' }, c: [] },
    { t: 'img', a: { src: 'data:image/svg+xml;base64,PHN2Zz4=' }, c: [] },
    { t: 'a', a: { href: 'javascript:alert(1)', onclick: 'x' }, c: ['lien'] },
    { t: 'a', a: { href: 'https://example.org/x' }, c: ['ok'] },
    { t: 'script', a: {}, c: ['alert(1)'] },
    { t: 'iframe', a: { src: 'https://evil.example' }, c: [] },
    { t: 'custom-el', a: { onmouseover: 'x' }, c: ['déballé'] },
    { t: 'p onclick="x"', a: {}, c: ['balise forgée'] },
  ] };
  const html = scripts.renderReaderTree(tree);
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<script|<iframe|svg\+xml/i);
  assert.match(html, /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.match(html, /<a href="https:\/\/example.org\/x" rel="noreferrer">ok<\/a>/);
  assert.match(html, /déballé/);
  assert.match(html, /balise forgée/);
});

test('lecteur et pages locales : CSP sans script', () => {
  const page = scripts.readerPage({ title: 't', byline: '', host: 'example.org', tree: 'x' }, false);
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'/);
  assert.doesNotMatch(page, /<base\s/i);
  for (const html of [scripts.errorPage({ title: 'e', message: 'm', url: 'https://x' }), scripts.startPage({ dark: false })]) {
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  }
});

test('icônes : seulement http, https et data:image', () => {
  assert.equal(safeFaviconURL('file://attacker.example/share/a.ico'), null);
  assert.equal(safeFaviconURL('file:///C:/x.png'), null);
  assert.equal(safeFaviconURL('javascript:alert(1)'), null);
  assert.equal(safeFaviconURL('data:text/html,<script>'), null);
  assert.equal(safeFaviconURL('https://example.org/favicon.ico'), 'https://example.org/favicon.ico');
  assert.equal(safeFaviconURL('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});
