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
  var wordLog = []; // accepted words with their type (A, B or AB), in the order entered: sent to a private room at the end
  var puzzle = null; // chosen in begin(), once the word sheets have loaded
  var over = false, busy = false, msgTimer = null;
  var roundDate = null; // the date a round is recorded under: today for daily and endless, the archive date for archive plays
  var roundMode = 'endless'; // daily, archive or endless: sent with every score; only the daily round shows the results curve
  var isDaily = false;
  var started = false; // false until the player picks Play today or a round from the archive; the start buttons show until then
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

  // Feedback for an accepted word. A: catA pulses with a gentle note. B: catB pulses with the same note a whole step up.
  // Entendre: both cards pulse, the entendre box jumps and slams down with sparkles, and a rising chime plays.
  var audioCtx = null;
  function tone(ctx, freq, start, dur, vol, wave) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(start); o.stop(start + dur + 0.05);
  }
  function playSound(type) {
    try {
      audioCtx = audioCtx || new (root.AudioContext || root.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      if (type === 'AB') {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(audioCtx, f, t + i * 0.09, 0.5, 0.18, 'triangle'); });
      } else if (type === 'A') {
        tone(audioCtx, 523.25, t, 0.35, 0.12, 'sine');            // C5
      } else if (type === 'B') {
        tone(audioCtx, 523.25 * Math.pow(2, 2 / 12), t, 0.35, 0.12, 'sine'); // D5, a whole step above C5
      }
    } catch (err) { /* no audio available: the game still works */ }
  }
  function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function sparkle(host, count) {
    for (var i = 0; i < count; i++) {
      var s = document.createElement('span');
      s.className = 'spark';
      var ang = (i / count) * Math.PI * 2 + Math.random() * 0.4, dist = 60 + Math.random() * 50;
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      var size = 8 + Math.random() * 10;
      s.style.width = s.style.height = size.toFixed(1) + 'px';
      s.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      host.appendChild(s);
      setTimeout(function (el) { return function () { el.remove(); }; }(s), 1200);
    }
  }
  function celebrate(type) {
    if (type === 'A' || type === 'AB') restartAnim($('catA'), 'pulse');
    if (type === 'B' || type === 'AB') restartAnim($('catB'), 'pulse');
    if (type === 'AB') { restartAnim($('entendre'), 'burst'); sparkle($('entendre'), 12); }
    playSound(type);
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
      if (res.accepted) { wordLog.push({ w: res.word, t: res.type }); addLine(res.word, res.type); render(); input.value = ''; showMsg(''); celebrate(res.type); }
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
    var ul = $('breakdown'); ul.innerHTML = '';
    ScoringRef.breakdownRows(b).forEach(function (r) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.textContent = r[0];
      var v = document.createElement('strong'); v.textContent = r[1];
      li.appendChild(a); li.appendChild(v); ul.appendChild(li);
    });
    $('end').hidden = false; $('reopen').hidden = true; $('giveUp').hidden = true;
    showCurve(ScoringRef.total(state));
    if (roomCode && root.EntendreRooms) root.EntendreRooms.finished(ScoringRef.total(state), { b: b, words: wordLog.slice() });
  }

  // Results curve: only for today's daily game. Reads the earlier scores first, draws the curve without this player,
  // then sends this player's score so it counts for later players.
  function showCurve(total) {
    var box = $('curveBox');
    if (!isDaily) { box.hidden = true; $('beatLine').textContent = ''; if (root.postScore) root.postScore(roundDate, puzzle.categoryA.term, puzzle.categoryB.term, total, roundMode, roomCode); return; }
    box.hidden = false;
    $('beatLine').textContent = 'checking today’s scores…';
    var date = roundDate, a = puzzle.categoryA.term, b = puzzle.categoryB.term;
    var read = root.scoreStats ? root.scoreStats(date, a, b, total) : Promise.resolve(null);
    return read
      .then(function (s) { try { drawCurve(s, total); } catch (e) { drawCurve(null, total); } })
      .then(function () { if (root.postScore) root.postScore(date, a, b, total, 'daily'); });
  }

  // Draws a smooth bell curve of today's logged daily scores (the real results, from the sheet), with the player's score marked.
  // The curve runs from 0 to the highest score among the logged scores and this player's score, so the marker is always on it.
  function drawCurve(s, total) {
    var svg = $('curve'), beat = $('beatLine');
    var W = 140, BASE = 72, TOP = 12, STEPS = 70;
    svg.innerHTML = '';
    if (!s) { $('curveBox').hidden = true; beat.textContent = ''; return; }
    if (!s.n) { $('curveBox').hidden = true; beat.textContent = 'You’re the first player today.'; return; }
    beat.textContent = s.beat == null ? '' : 'You beat ' + Math.round(s.beat * 100) + '% of players today';
    var scores = (s.scores || []).slice();
    if (scores.length < 2) { $('curveBox').hidden = true; return; }
    $('curveBox').hidden = false;

    var hi = Math.max(1, total, scores[scores.length - 1]);
    var xs = [], i;
    for (i = 0; i <= STEPS; i++) xs.push(hi * i / STEPS);
    var ys = ScoringRef.density(scores, xs);
    var peak = Math.max.apply(null, ys) || 1;
    var k = (BASE - TOP) / peak;
    var pts = xs.map(function (x, j) { return [(W * j / STEPS), BASE - ys[j] * k]; });
    var line = pts.map(function (p, j) { return (j ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var parts = [];
    parts.push('<path class="curve-area" d="' + line + ' L' + W + ',' + BASE + ' L0,' + BASE + ' Z"></path>');
    parts.push('<path class="curve-line" d="' + line + '"></path>');

    var ux = W * total / hi;
    var uy = BASE - ScoringRef.density(scores, [total])[0] * k;
    parts.push('<line class="curve-you" x1="' + ux.toFixed(1) + '" y1="' + (TOP + 6) + '" x2="' + ux.toFixed(1) + '" y2="' + BASE + '"></line>');
    parts.push('<circle class="curve-dot" cx="' + ux.toFixed(1) + '" cy="' + uy.toFixed(1) + '" r="2.6"></circle>');
    parts.push('<text class="curve-you-label" x="' + Math.min(W - 10, Math.max(10, ux)).toFixed(1) + '" y="' + (TOP - 2) + '" text-anchor="middle">you</text>');
    parts.push('<text class="curve-text" x="0" y="' + (BASE + 10) + '">0</text>');
    parts.push('<text class="curve-text" x="' + W + '" y="' + (BASE + 10) + '" text-anchor="end">' + hi + '</text>');
    svg.innerHTML = parts.join('');
  }

  // If an in-flight submit resolves right at expiry, it is scored before the overlay reads state: wait for busy to clear.
  function finishWhenIdle() { if (busy) setTimeout(finishWhenIdle, 30); else endGame(); }

  // deadline is null for endless: no timer, the round ends only when the player gives up.
  var deadline = 0, iv = null, roomCode = null;
  function tick() {
    if (over || deadline === null) return;
    var left = Math.max(0, deadline - Date.now());
    var s = Math.ceil(left / 1000);
    $('timer').textContent = Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    $('timer').classList.toggle('low', s <= 10);
    if (left <= 0) { clearInterval(iv); input.disabled = true; $('enter').disabled = true; finishWhenIdle(); }
  }
  // Starts a round with the given puzzle. Daily, archive and room rounds use a 2-minute timer; endless has none.
  // opts.deadline (ms) sets the end time for a private room, so every player in the room ends together.
  // opts.roomCode marks a private room round, which is reported to the room and not to the daily curve.
  function startRound(p, mode, date, opts) {
    opts = opts || {};
    clearInterval(iv);
    puzzle = p;
    roundDate = date || localDateString(new Date());
    state = ScoringRef.createState();
    wordLog = [];
    over = false; busy = false;
    list.innerHTML = '';
    input.value = ''; showMsg('');
    $('end').hidden = true; $('reopen').hidden = false; $('archivePage').hidden = true;
    $('start').hidden = true; started = true; roundMode = mode; isDaily = mode === 'daily';
    roomCode = mode === 'room' ? (opts.roomCode || null) : null;
    $('endless').hidden = mode === 'room'; $('archive').hidden = mode === 'room'; $('privateRoomEnd').hidden = mode === 'room';
    $('catA').textContent = p.categoryA.label;
    $('catB').textContent = p.categoryB.label;
    render();
    input.disabled = false; $('enter').disabled = false;
    if (mode === 'endless') {
      deadline = null;
      $('timer').textContent = 'no limit';
      $('timer').classList.remove('low');
    } else {
      deadline = opts.deadline || (Date.now() + DURATION_MS);
      iv = setInterval(tick, 250);
      tick();
    }
    input.focus();
  }

  // Today's categories come from the Archive tab when it has them; otherwise the built-in daily draw is used.
  function scheduledFor(date) {
    var r = (root.EntendreRemote && root.EntendreRemote.archive || []).filter(function (x) { return x.date === date; })[0];
    if (!r) return null;
    var cur = root.EntendreRemote.curated;
    return cur[r.a] && cur[r.b] ? puzzleFor(r.a, r.b) : null;
  }

  // Play today: starts the daily round and timer once the word sheets are loaded (or have failed to load).
  function startToday() {
    (root.EntendreReady || Promise.resolve()).then(function () {
      var today = localDateString(new Date());
      startRound(scheduledFor(today) || root.Puzzles.dailyPuzzle(today), 'daily', today);
    });
  }
  $('playToday').addEventListener('click', startToday);

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
    startRound(puzzleFor(pair[0], pair[1]), 'endless');
  });
  // Archive list: shared by the start screen's Play archive button and the results popup's Play archive button.
  function openArchive() {
    var today = localDateString(new Date());
    var rows = ((root.EntendreRemote && root.EntendreRemote.archive) || []).filter(function (r) { return r.date <= today; });
    if (!rows.length) { showMsg('no archive yet'); return; }
    var ul = $('archiveList'); ul.innerHTML = '';
    rows.slice().reverse().forEach(function (r) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'archive-row';
      var dateEl = document.createElement('span'); dateEl.className = 'archive-date'; dateEl.textContent = r.date;
      var catsEl = document.createElement('span'); catsEl.className = 'archive-cats';
      catsEl.textContent = labelOf(r.a) + ' + ' + labelOf(r.b);
      btn.appendChild(dateEl); btn.appendChild(catsEl);
      btn.addEventListener('click', function () { startRound(puzzleFor(r.a, r.b), 'archive', r.date); });
      li.appendChild(btn); ul.appendChild(li);
    });
    $('end').hidden = true;
    $('start').hidden = true;
    $('archivePage').hidden = false;
  }
  $('archive').addEventListener('click', openArchive);
  $('playArchive').addEventListener('click', openArchive);
  function setHowTo(open) { $('howTo').hidden = !open; }
  $('howToBtn').addEventListener('click', function () { setHowTo(true); });
  $('howToOk').addEventListener('click', function () { setHowTo(false); });
  $('howToClose').addEventListener('click', function () { setHowTo(false); });
  // Back to where the player came from: the start buttons before any round, the results card after one.
  $('closeArchive').addEventListener('click', function () {
    $('archivePage').hidden = true;
    if (started) $('end').hidden = false; else $('start').hidden = false;
  });
  // X closes the popup and keeps the finished game on screen. Results brings the popup back.
  $('closeEnd').addEventListener('click', function () { $('end').hidden = true; $('reopen').hidden = false; });
  // Results: during a round it asks to give up; after the round it brings the results card back.
  $('reopen').addEventListener('click', function () {
    if (!over) { $('giveUp').hidden = false; return; }
    $('end').hidden = false; $('reopen').hidden = true;
  });
  $('giveUpNo').addEventListener('click', function () { $('giveUp').hidden = true; input.focus(); });
  $('giveUpYes').addEventListener('click', function () {
    $('giveUp').hidden = true;
    if (over) return;
    clearInterval(iv); input.disabled = true; $('enter').disabled = true;
    finishWhenIdle();
  });

  // Used by private rooms (rooms.js): start the shared round at the room's end time, and read today's puzzle for a new room.
  root.EntendreGame.startRoom = function (code, a, b, deadline) {
    startRound(puzzleFor(a, b), 'room', localDateString(new Date()), { deadline: deadline, roomCode: code });
  };
  root.EntendreGame.todayPuzzle = function () {
    var today = localDateString(new Date());
    var p = scheduledFor(today) || root.Puzzles.dailyPuzzle(today);
    return { a: p.categoryA.term, b: p.categoryB.term };
  };

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
