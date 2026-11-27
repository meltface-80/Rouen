// @ts-check
/*
 * i18n.js — the site's languages, on every page: Mandarin's site's script (which began as this site's), since 2.0.8.
 *
 * The page is written in English. Each text to translate carries data-i18n="key"; an attribute to translate is named
 * in data-i18n-attr="attribute:key" (several joined by ";"). The language chosen in the top bar's selector
 * (#lang-select) is kept in localStorage ("rouen-lang"); on a first visit the browser's own language is taken when it
 * is one of the nine (nb and nn are Norsk), else English. Each language's words are docs/i18n/<lang>.json, a flat
 * { key: html } object (made in 2.0.8 from the one-page site's own dictionary). A key a language
 * lacks keeps the English, the page's own text. No framework: plain script, for GitHub Pages.
 */
(function () {
  "use strict";
  /** The nine, in the selector's order. */
  var LANGS = ["en", "fr", "de", "es", "it", "nl", "sv", "da", "no"];
  var STORE = "rouen-lang";
  var script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  var base = script && script.src ? script.src : location.href;
  var sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("lang-select"));

  /** @type {Element[]} */
  var texts = Array.prototype.slice.call(document.querySelectorAll("[data-i18n]"));
  texts.forEach(function (el) { el.setAttribute("data-i18n-en", el.innerHTML); });

  /** @type {{ el: Element, attr: string, key: string, en: string }[]} */
  var attrs = [];
  Array.prototype.slice.call(document.querySelectorAll("[data-i18n-attr]")).forEach(function (/** @type {Element} */ el) {
    (el.getAttribute("data-i18n-attr") || "").split(";").forEach(function (pair) {
      var i = pair.indexOf(":");
      if (i < 1) return;
      var attr = pair.slice(0, i).trim();
      attrs.push({ el: el, attr: attr, key: pair.slice(i + 1).trim(), en: el.getAttribute(attr) || "" });
    });
  });

  /** @type {Record<string, Promise<Record<string, string>>>} */
  var loaded = {};
  /** A language's words; none for English, and none (so English) when its file can't be had. @param {string} lang */
  function words(lang) {
    if (lang === "en") return Promise.resolve({});
    if (!loaded[lang]) {
      loaded[lang] = fetch(new URL("i18n/" + lang + ".json", base).href)
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) { return d && typeof d === "object" ? d : {}; }, function () { return {}; });
    }
    return loaded[lang];
  }

  var asked = 0;
  /** Shows the page in a language, and remembers it. @param {string} lang */
  function apply(lang) {
    if (LANGS.indexOf(lang) === -1) lang = "en";
    var mine = ++asked;
    try { localStorage.setItem(STORE, lang); } catch (e) { /* private browsing: this page only */ }
    if (sel) sel.value = lang;
    return words(lang).then(function (dict) {
      if (mine !== asked) return;  // another language was chosen meanwhile
      /** @param {string} key @param {string} en */
      var said = function (key, en) { var t = dict[key]; return typeof t === "string" && t ? t : en; };
      texts.forEach(function (el) {
        var t = said(el.getAttribute("data-i18n") || "", el.getAttribute("data-i18n-en") || "");
        if (el.innerHTML !== t) el.innerHTML = t;
      });
      attrs.forEach(function (a) { a.el.setAttribute(a.attr, said(a.key, a.en)); });
      document.documentElement.lang = lang;
      document.documentElement.setAttribute("data-lang", lang);
    });
  }

  /** The language to start in: the one chosen before, else the browser's when it is one of the nine, else English. */
  function first() {
    var kept = "";
    try { kept = localStorage.getItem(STORE) || ""; } catch (e) { /* none kept */ }
    if (LANGS.indexOf(kept) !== -1) return kept;
    var n = (navigator.language || "").slice(0, 2).toLowerCase();
    if (n === "nb" || n === "nn") n = "no";
    return LANGS.indexOf(n) !== -1 ? n : "en";
  }

  if (sel) sel.addEventListener("change", function () { apply(sel.value); });
  apply(first());
})();
