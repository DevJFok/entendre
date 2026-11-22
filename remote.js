/* Entendre remote data. Loads the word and ban lists from Google Sheets (read-only, link-viewable).
 * Falls back silently to the bundled data if a sheet can't be read.
 * Sets globalThis.EntendreReady, a promise that resolves once loading finishes either way. */
(function (root) {
  'use strict';
  var CONFIG = {
    wordsSheetId: '12vHqO51gMYOVlvb9UtITqnml6jExnSM6Vk84YYOdKJY',
    blocklistSheetId: '1gj3A8qo98yoE2KBt40IZdqn5nGDnlyjPmdyb5C9Ezu0'
  };

  function csvUrl(id) { return 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv'; }

  // Minimal CSV parser: handles quoted fields and doubled quotes.
  function parseCsv(text) {
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function norm(w) { return String(w || '').trim().toLowerCase(); }

  var remote = { curated: {}, approved: new Set(), blocked: new Set(), singular: Object.create(null), loaded: false, error: null };

  // Each word maps to one key per singular/plural pair: the singular form when the sheet lists one, else the word itself.
  function canonicalForm(w) { w = norm(w); return remote.singular[w] || w; }

  function labelFor(term) { return term.charAt(0).toUpperCase() + term.slice(1); }

  function buildLists(wordRows, blockRows) {
    var header = wordRows[0].map(function (h) { return h.trim().toLowerCase(); });
    var ci = header.indexOf('category'), wi = header.indexOf('word'), si = header.indexOf('status');
    var pi = header.indexOf('plural form'), sgi = header.indexOf('singular form');
    wordRows.slice(1).forEach(function (r) {
      var cats = String(r[ci] || '').split(',').map(norm).filter(Boolean);
      var word = norm(r[wi]), status = norm(r[si]);
      if (!cats.length || !word || status !== 'approved') return;
      // One row per word; its category cell can list several categories, separated by commas.
      cats.forEach(function (cat) { (remote.curated[cat] = remote.curated[cat] || new Set()).add(word); });
      remote.approved.add(word);
      var plural = pi >= 0 ? norm(r[pi]) : '', singular = sgi >= 0 ? norm(r[sgi]) : '';
      if (singular) remote.singular[word] = singular;
      if (plural) remote.singular[plural] = word;
    });
    var bh = blockRows[0].map(function (h) { return h.trim().toLowerCase(); });
    var bi = bh.indexOf('word');
    blockRows.slice(1).forEach(function (r) { var w = norm(r[bi]); if (w) remote.blocked.add(w); });
  }

  // A plural or -ed/-ing form counts as its base word, for curated lists.
  function curatedHas(set, w) {
    if (set.has(w)) return true;
    if (w.length > 3 && w.endsWith('s') && set.has(w.slice(0, -1))) return true;
    if (w.length > 4 && w.endsWith('es') && set.has(w.slice(0, -2))) return true;
    if (w.length > 4 && w.endsWith('ed') && set.has(w.slice(0, -2))) return true;
    if (w.length > 5 && w.endsWith('ing') && set.has(w.slice(0, -3))) return true;
    return false;
  }

  function registerWithPuzzles() {
    if (!root.Puzzles || !root.Puzzles.addCategories) return;
    var cats = Object.keys(remote.curated).map(function (k) { return { label: labelFor(k), term: k }; });
    root.Puzzles.addCategories(cats, remote.curated);
  }

  function wrapWords() {
    var W = root.Words;
    var origDict = W.isDictionaryWord, origFits = W.fits;
    W.isDictionaryWord = function (w) {
      w = norm(w);
      if (remote.blocked.has(w)) return Promise.resolve(false);
      if (remote.approved.has(w)) return Promise.resolve(true);
      return origDict(w);
    };
    W.fits = function (w, term) {
      w = norm(w);
      if (remote.blocked.has(w)) return Promise.resolve(false);
      if (remote.curated[term]) return Promise.resolve(curatedHas(remote.curated[term], w));
      return origFits(w, term);
    };
    W.remote = remote;
  }

  async function load() {
    try {
      var responses = await Promise.all([fetch(csvUrl(CONFIG.wordsSheetId)), fetch(csvUrl(CONFIG.blocklistSheetId))]);
      if (!responses[0].ok || !responses[1].ok) throw new Error('sheet not readable');
      var texts = await Promise.all([responses[0].text(), responses[1].text()]);
      buildLists(parseCsv(texts[0]), parseCsv(texts[1]));
      remote.loaded = true;
    } catch (err) {
      remote.error = String(err && err.message || err); // offline or sheet not shared: use bundled data
    }
    wrapWords();
    registerWithPuzzles();
  }

  root.EntendreReady = (typeof document !== "undefined") ? load() : Promise.resolve(); // browser only
  remote.canonical = canonicalForm;
  root.EntendreRemote = remote;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseCsv: parseCsv, curatedHas: curatedHas, buildLists: buildLists, canonicalForm: canonicalForm, remote: remote };
})(typeof window !== 'undefined' ? window : globalThis);
