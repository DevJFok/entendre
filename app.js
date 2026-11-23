/* Entendre game screen. Pure flow logic (checkCandidate) is exported for tests; DOM code runs only in a browser. */
(function (root) {
  'use strict';
  var ScoringRef = (typeof module !== 'undefined' && module.exports && typeof require === 'function' && typeof Scoring === 'undefined')
    ? require('./scoring.js') : root.Scoring;

  var MESSAGES = {
    empty: 'type something first',
    duplicate: 'already used',
    notword: 'not a word',
    nofit: "doesn't fit either category",
    pluralEntered: 'plural form already entered',
    singularEntered: 'singular form already entered',
    banned: 'Invalid entry'
  };

  // A singular and its plural share one key (see remote.js), so only the first of the pair can score.
  function pairReason(state, word, pairOf) {
    var key = pairOf(word);
    var hit = state.submitted.some(function (s) { return pairOf(s) === key; });
    if (!hit) return null;
    return word === key ? 'pluralEntered' : 'singularEntered';
  }

  /* Runs the ordered checks. dictionaryCheck(word) -> Promise<bool>; fitCheck(word) -> Promise<{fitA,fitB}>.
     Returns {accepted, reason, type, word, message}. */
  async function checkCandidate(state, raw, dictionaryCheck, fitCheck, pairOf, isBanned) {
    pairOf = pairOf || function (w) { return w; };
    var word = String(raw == null ? '' : raw).trim().toLowerCase();
    function rej(reason) { return { accepted: false, reason: reason, type: null, word: word, message: MESSAGES[reason] }; }
    if (!word) return rej('empty');
    if (isBanned && isBanned(word)) return rej('banned'); // ban_list words are refused and never reviewed
    if (state.submitted.indexOf(word) !== -1) return rej('duplicate');
    var paired = pairReason(state, word, pairOf);
    if (paired) return rej(paired);
    if (!(await dictionaryCheck(word))) return rej('notword');
    var fits = await fitCheck(word);
    // re-check duplicate in case state changed while awaiting
    if (state.submitted.indexOf(word) !== -1) return rej('duplicate');
    paired = pairReason(state, word, pairOf);
    if (paired) return rej(paired);
    var r = ScoringRef.submitWord(state, word, !!fits.fitA, !!fits.fitB);
    if (!r.accepted) return rej(r.reason);
    return { accepted: true, reason: null, type: r.type, word: word, message: '' };
  }

  // Uses New York time so every player gets the same puzzle, and the day flips at midnight Eastern to match the Archive tab.
  function localDateString(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  var api = { checkCandidate: checkCandidate, localDateString: localDateString, MESSAGES: MESSAGES, pairReason: pairReason };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  root.EntendreGame = api;
  var DURATION_MS = 120000;
  var $ = function (id) { return document.getElementById(id); };
  var state = ScoringRef.createState();
  var puzzle = null; // chosen in begin(), once the word sheets have loaded
  var over = false, busy = false, msgTimer = null;
  var roundDate = null; // the date a round is recorded under: today for daily and endless, the archive date for archive plays
  var input = $('input'), form = $('form'), list = $('words');
  input.disabled = true; $('enter').disabled = true;

  function showMsg(t) {
    $('msg').textContent = t;
    clearTimeout(msgTimer);
    if (t) msgTimer = setTimeout(function () { $('msg').textContent = ''; }, 2200);
  }

  function render() {
    var b = ScoringRef.breakdown(state);
    $('aScore').textContent = '+ ' + b.aOnlyPoints;
    $('mult').textContent = 'x ' + b.multiplier;
    $('entendre').textContent = 'Entendre x' + Math.pow(2, b.entendreCount);
  }

  function addLine(word, type) {
    var li = document.createElement('li');
    var w = document.createElement('span'); w.textContent = word;
    var t = document.createElement('span'); t.className = 'tag ' + type;
    t.textContent = type === 'AB' ? 'Entendre' : (type === 'A' ? 'A' : 'B');
    li.appendChild(w); li.appendChild(t);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (over || busy) return;
    busy = true;
    try {
      var res = await checkCandidate(state, input.value, root.Words.isDictionaryWord, async function (w) {
        var r = await Promise.all([root.Words.fits(w, puzzle.categoryA.term), root.Words.fits(w, puzzle.categoryB.term)]);
        return { fitA: r[0], fitB: r[1] };
      }, root.EntendreRemote && root.EntendreRemote.canonical, function (w) {
        return !!(root.EntendreRemote && root.EntendreRemote.blocked && root.EntendreRemote.blocked.has(w));
      });
      if (!res.accepted && (res.reason === 'notword' || res.reason === 'nofit') && root.ReviewQueue) {
        root.ReviewQueue.add(res.word, puzzle.categoryA.term + ',' + puzzle.categoryB.term);
      }
      if (over && res.accepted) return; // (cannot un-score; end screen reads state anyway)
      if (res.accepted) { addLine(res.word, res.type); render(); input.value = ''; showMsg(''); }
      else showMsg(res.message);
    } catch (err) { showMsg('something went wrong'); }
    finally { busy = false; if (!over) input.focus(); }
  }
  form.addEventListener('submit', onSubmit);

  function endGame() {
    over = true;
    input.disabled = true; $('enter').disabled = true;
    if (root.ReviewQueue) root.ReviewQueue.flush();
    var b = ScoringRef.breakdown(state);
    $('finalTotal').textContent = ScoringRef.total(state);
    var rows = [
      ['A-only words', b.aOnlyCount + ' (' + (b.aOnlyCount * 10) + ' pts)'],
      ['B-only words', String(b.bOnlyCount)],
      ['Entendre words', b.entendreCount + ' (+' + (b.entendreCount * 10) + ' pts)'],
      ['Entendre multiplier', 'x ' + b.entendreMultiplier]
    ];
    var ul = $('breakdown'); ul.innerHTML = '';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.textContent = r[0];
      var v = document.createElement('strong'); v.textContent = r[1];
      li.appendChild(a); li.appendChild(v); ul.appendChild(li);
    });
    $('end').hidden = false;
    if (root.postScore) root.postScore(roundDate, puzzle.categoryA.term, puzzle.categoryB.term, ScoringRef.total(state));
  }

  // If an in-flight submit resolves right at expiry, it is scored before the overlay reads state: wait for busy to clear.
  function finishWhenIdle() { if (busy) setTimeout(finishWhenIdle, 30); else endGame(); }

  var deadline = 0, iv = null;
  function tick() {
    if (over) return;
    var left = Math.max(0, deadline - Date.now());
    var s = Math.ceil(left / 1000);
    $('timer').textContent = Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    $('timer').classList.toggle('low', s <= 10);
    if (left <= 0) { clearInterval(iv); input.disabled = true; $('enter').disabled = true; finishWhenIdle(); }
  }
  // Starts a round with the given puzzle and a fresh 2-minute timer. daily: true also records the day's categories in the archive.
  // daily is kept for the call sites; the Archive tab is maintained by hand, so the game only reads it.
  function startRound(p, daily, date) {
    clearInterval(iv);
    puzzle = p;
    roundDate = date || localDateString(new Date());
    state = ScoringRef.createState();
    over = false; busy = false;
    list.innerHTML = '';
    input.value = ''; showMsg('');
    $('end').hidden = true; $('reopen').hidden = true; $('archiveOverlay').hidden = true;
    $('catA').textContent = p.categoryA.label;
    $('catB').textContent = p.categoryB.label;
    render();
    input.disabled = false; $('enter').disabled = false;
    deadline = Date.now() + DURATION_MS;
    iv = setInterval(tick, 250);
    tick();
    input.focus();
  }

  // Today's categories come from the Archive tab when it has them; otherwise the built-in daily draw is used.
  function scheduledFor(date) {
    var r = (root.EntendreRemote && root.EntendreRemote.archive || []).filter(function (x) { return x.date === date; })[0];
    if (!r) return null;
    var cur = root.EntendreRemote.curated;
    return cur[r.a] && cur[r.b] ? puzzleFor(r.a, r.b) : null;
  }

  // Runs once the word sheets are loaded (or have failed to load).
  (root.EntendreReady || Promise.resolve()).then(function () {
    var today = localDateString(new Date());
    startRound(scheduledFor(today) || root.Puzzles.dailyPuzzle(today), true, today);
  });

  function labelOf(term) {
    var p = root.Puzzles.pool.filter(function (x) { return x.term === term; })[0];
    return p ? p.label : term;
  }
  function puzzleFor(a, b) {
    return { categoryA: { label: labelOf(a), term: a }, categoryB: { label: labelOf(b), term: b } };
  }

  $('share').addEventListener('click', function () { root.shareResult && root.shareResult(state, puzzle); });

  // Popup buttons: endless picks the best-overlap pair (same every time); archive lists past daily games.
  $('endless').addEventListener('click', function () {
    var pair = root.Puzzles.bestPair(root.EntendreRemote ? root.EntendreRemote.curated : {});
    if (!pair) { showMsg('no endless game available yet'); return; }
    startRound(puzzleFor(pair[0], pair[1]), false);
  });
  $('archive').addEventListener('click', function () {
    var today = localDateString(new Date());
    var rows = ((root.EntendreRemote && root.EntendreRemote.archive) || []).filter(function (r) { return r.date <= today; });
    if (!rows.length) { showMsg('no archive yet'); return; }
    var ul = $('archiveList'); ul.innerHTML = '';
    rows.slice().reverse().forEach(function (r) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn red';
      btn.textContent = r.date + ': ' + labelOf(r.a) + ' + ' + labelOf(r.b);
      btn.addEventListener('click', function () { startRound(puzzleFor(r.a, r.b), false, r.date); });
      li.appendChild(btn); ul.appendChild(li);
    });
    $('archiveOverlay').hidden = false;
  });
  $('closeArchive').addEventListener('click', function () { $('archiveOverlay').hidden = true; });
  // X closes the popup and keeps the finished game on screen. Results brings the popup back.
  $('closeEnd').addEventListener('click', function () { $('end').hidden = true; $('reopen').hidden = false; });
  $('reopen').addEventListener('click', function () { $('end').hidden = false; $('reopen').hidden = true; });

  // keep the input visible above the on-screen keyboard
  if (root.visualViewport) {
    var fit = function () {
      $('game').style.height = root.visualViewport.height + 'px';
      root.scrollTo(0, 0);
    };
    root.visualViewport.addEventListener('resize', fit);
    root.visualViewport.addEventListener('scroll', fit);
  }
  input.focus();
})(typeof window !== 'undefined' ? window : globalThis);
