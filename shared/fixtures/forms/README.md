# Fixtures « formulaires »

Chaque page `<nom>.html` est accompagnée de `<nom>.expected.json` :

```json
{ "url": "URL sous laquelle charger la page (son origine compte)",
  "description": "ce que la page exerce",
  "detect": [ … ce que doit renvoyer window.__qafilaForms.detect(), à l'identique … ] }
```

Les trois plateformes (jsdom ici, WKWebView, Android WebView, Electron) doivent produire **exactement** ce
tableau pour chaque page : mêmes `kind`, mêmes `selectorPath`, mêmes drapeaux. Voir `shared/FORMS.md` §3 pour
les règles et `shared/test/forms.test.mjs` pour l'exécution de référence. Aucune page ne charge de ressource
distante ; les scripts inclus (`react-controlled.html`) imitent un cadriciel, rien de plus.
