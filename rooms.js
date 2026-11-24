/* Private rooms (browser only). 2 to 4 friends share one daily puzzle and a synchronized 2-minute round.
 * Live room state lives in Firebase Realtime Database; each finished round is also logged to Historical_Scores with its room_number.
 * Rules for codes, capacity, timing and ranking are in rooms-logic.js. Setup is in SETUP.md. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var L = root.RoomLogic;
  var $ = function (id) { return document.getElementById(id); };
  var NICK_KEY = 'entendre_nick';
  var MESSAGES = {
    'no-room': 'No room has that number.',
    started: 'That game has already started.',
    expired: 'That room has closed.',
    full: 'That room is full (4 players).'
  };

  var db = null, uid = null, offset = 0, connecting = null;
  var code = null, isHost = false, roomRef = null, scheduled = false, lastRoom = null;
  var lobbyTick = null, resultsTick = null, busy = false, myDone = false;
  var myDetail = null, viewUid = null; // this player's breakdown and words after the round; the player whose List is open
  var roundInfo = null; // { date, a, b } for the room's puzzle, used to compare against today's daily scores

  function cfg() { return root.ENTENDRE_FIREBASE || {}; }
  function enabled() { var c = cfg(); return !!(c.apiKey && c.databaseURL && root.firebase && root.firebase.database); }
  function serverNow() { return Date.now() + offset; }
  function stamp() { return root.firebase.database.ServerValue.TIMESTAMP; }

  // Signs in anonymously once, and keeps the server clock offset so every phone starts at the same moment.
  function connect() {
    if (connecting) return connecting;
    connecting = new Promise(function (resolve, reject) {
      if (!enabled()) { reject(new Error('Private rooms are not set up yet.')); return; }
      if (!root.firebase.apps.length) root.firebase.initializeApp(cfg());
      db = root.firebase.database();
      db.ref('.info/serverTimeOffset').on('value', function (s) { offset = s.val() || 0; });
      root.firebase.auth().signInAnonymously().then(function (c) { uid = c.user.uid; resolve(); }, reject);
    });
    return connecting;
  }

  function showOnly(id) {
    ['roomChoice', 'roomForm', 'lobby', 'roomResults'].forEach(function (x) { $(x).hidden = x !== id; });
  }
  function closeToStart() { showOnly(null); $('start').hidden = false; }

  function setErr(msg) { $('roomFormErr').textContent = msg || ''; }
  function setBusy(on) { busy = on; $('roomFormGo').disabled = on; }

  // ----- Create and join -----

  // Reserves a code for today: the transaction only succeeds when nobody has taken it for this date.
  function reserveCode(date, tries) {
    var c = L.randomRoomCode();
    if (c === L.EXCLUDED_CODE || tries <= 0) return Promise.reject(new Error('No room number free right now. Try again.'));
    return db.ref('roomCodes/' + date + '/' + c).transaction(function (cur) {
      return cur === null ? true : undefined;
    }).then(function (tx) {
      return tx.committed ? c : reserveCode(date, tries - 1);
    });
  }

  function createRoom(name) {
    var date = root.EntendreGame.localDateString(new Date());
    return connect().then(function () { return root.EntendreReady; }).then(function () {
      var puzzle = root.EntendreGame.todayPuzzle();
      return reserveCode(date, 20).then(function (c) {
        code = c; isHost = true; roomRef = db.ref('rooms/' + c);
        var players = {}; players[uid] = { name: name, joinedAt: stamp() };
        return roomRef.set({ date: date, hostId: uid, status: 'waiting', puzzleA: puzzle.a, puzzleB: puzzle.b, createdAt: stamp(), players: players })
          .then(function () {
            roomRef.onDisconnect().remove(); // the room closes if the host drops out before the start
            roomRef.child('players/' + uid).onDisconnect().remove();
          });
      });
    });
  }

  function joinRoom(c, name) {
    return connect().then(function () {
      var ref = db.ref('rooms/' + c);
      return ref.once('value').then(function (s) {
        var reason = L.canJoin(s.val(), uid, serverNow());
        if (reason) throw new Error(MESSAGES[reason]);
        code = c; isHost = false; roomRef = ref;
        return ref.child('players/' + uid).set({ name: name, joinedAt: stamp() });
      }).then(function () {
        ref.child('players/' + uid).onDisconnect().remove();
      });
    });
  }

  // ----- Lobby -----

  function openLobby() {
    scheduled = false; lastRoom = null; myDone = false;
    $('start').hidden = true;
    $('lobbyCode').textContent = code;
    $('lobbyStart').hidden = !isHost;
    showOnly('lobby');
    roomRef.on('value', onRoomChange);
    clearInterval(lobbyTick);
    lobbyTick = setInterval(updateLobbyStatus, 1000);
  }

  function renderPlayers(players, hostId) {
    var ul = $('lobbyPlayers'); ul.innerHTML = '';
    Object.keys(players || {}).forEach(function (id) {
      var li = document.createElement('li');
      li.textContent = (players[id].name || 'player') + (id === hostId ? ' (host)' : '') + (id === uid ? ' (you)' : '');
      ul.appendChild(li);
    });
  }

  function updateLobbyStatus() {
    if (!lastRoom || lastRoom.status !== 'waiting') return;
    var n = L.playerCount(lastRoom.players);
    var left = Math.max(0, Math.ceil((lastRoom.createdAt + L.LOBBY_MS - serverNow()) / 1000));
    var text = n < L.MIN_PLAYERS ? 'Waiting for at least ' + L.MIN_PLAYERS + ' players.' : (isHost ? 'Ready when you are.' : 'Waiting for the host to start.');
    $('lobbyStatus').textContent = text + ' Room closes in ' + left + 's.';
    $('lobbyStart').disabled = !L.canStart(lastRoom.players, lastRoom.status);
    if (isHost && left <= 0) expireLobby();
  }

  // Closes a lobby that was not started in time. Only the host's client removes it, once the server says it is still waiting.
  function expireLobby() {
    if (!roomRef) return;
    roomRef.transaction(function (cur) {
      if (cur && cur.status === 'waiting' && L.lobbyExpired(cur.createdAt, serverNow())) return null;
      return undefined;
    });
  }

  function start() {
    if (!roomRef || !isHost) return;
    roomRef.transaction(function (cur) {
      if (!cur || !L.canStart(cur.players, cur.status)) return undefined;
      cur.status = 'playing';
      cur.startAt = serverNow() + L.START_DELAY_MS;
      return cur;
    }).then(function (tx) {
      if (tx.committed) roomRef.onDisconnect().cancel(); // a started room stays open if the host drops
    });
  }

  // ----- Room updates -----

  function onRoomChange(snap) {
    var data = snap.val();
    lastRoom = data;
    if (!data) { kicked(); return; }
    if (data.status === 'waiting') {
      renderPlayers(data.players, data.hostId);
      updateLobbyStatus();
      return;
    }
    if (data.status === 'playing' && data.startAt && !scheduled) scheduleRound(data);
    if (myDone) renderResults();
  }

  // Every phone starts the round at the same server time. The round ends at startAt + 2 minutes for everyone.
  function scheduleRound(data) {
    scheduled = true;
    clearInterval(lobbyTick);
    var localStart = data.startAt - offset;
    var deadline = data.startAt + L.ROUND_MS - offset;
    var roundCode = code;
    roundInfo = { date: data.date, a: data.puzzleA, b: data.puzzleB };
    $('lobbyStatus').textContent = 'Starting…';
    var wait = Math.max(0, localStart - Date.now());
    setTimeout(function () {
      if (code !== roundCode) return;
      showOnly(null);
      root.EntendreGame.startRoom(roundCode, data.puzzleA, data.puzzleB, deadline);
    }, wait);
  }

  // A player who gave up or ran out of time reports their score, breakdown and words; the results card waits for everyone (or the grace period).
  // detail: { b: the daily-style breakdown, words: [{w, t}] } where t is A, B or AB.
  function finished(total, detail) {
    if (!roomRef) return;
    myDone = true;
    myDetail = detail || { b: null, words: [] };
    roomRef.child('players/' + uid).update({
      score: total,
      finishedAt: stamp(),
      breakdown: myDetail.b || null,
      words: myDetail.words.length ? myDetail.words : null
    });
    var ul = $('roomBreakdown'); ul.innerHTML = '';
    if (myDetail.b) fillRows(ul, root.Scoring.breakdownRows(myDetail.b));
    // Compares this room score with today's daily scores (the daily game only; room scores are not in the daily curve).
    if (roundInfo && root.scoreStats && root.EntendreGame && root.EntendreGame.drawCurve) {
      var ri = roundInfo;
      root.scoreStats(ri.date, ri.a, ri.b, total).then(function (s) {
        root.EntendreGame.drawCurve(s, total, { svg: $('roomCurve'), beat: $('roomBeat'), box: $('roomCurveBox') });
      });
    }
    $('end').hidden = true;
    renderResults();
    clearInterval(resultsTick);
    resultsTick = setInterval(renderResults, 1000);
  }

  function fillRows(ul, rows) {
    rows.forEach(function (r) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.textContent = r[0];
      var v = document.createElement('strong'); v.textContent = r[1];
      li.appendChild(a); li.appendChild(v); ul.appendChild(li);
    });
  }

  // The List is open only after the round has ended for everyone (or the grace period has passed).
  function renderResults() {
    if (!lastRoom || !lastRoom.startAt) return;
    var players = lastRoom.players || {};
    var ready = L.resultsReady(players, lastRoom.startAt, serverNow());
    if (!ready) viewUid = null;
    showOnly('roomResults');
    var list = L.rankPlayers(players);
    var ol = $('roomRank'); ol.innerHTML = '';
    list.forEach(function (p) {
      var li = document.createElement('li');
      var text = document.createElement('span');
      text.textContent = p.name + (p.uid === uid ? ' (you)' : '') + ' — ' + (p.score === null ? 'no score' : p.score);
      li.appendChild(text);
      if (ready && p.score !== null) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'room-list-btn'; btn.textContent = 'List';
        btn.setAttribute('data-uid', p.uid);
        li.appendChild(btn);
      }
      ol.appendChild(li);
    });
    var missing = list.filter(function (p) { return p.score === null; }).length;
    $('roomWait').textContent = ready ? 'Round over' : 'Waiting for ' + missing + (missing === 1 ? ' player' : ' players') + '…';
    $('roomMine').hidden = !myDetail;
    var viewing = !!(viewUid && ready && players[viewUid]);
    $('roomMain').hidden = viewing;
    $('roomList').hidden = !viewing;
    if (ready) clearInterval(resultsTick);
  }

  // Shows one player's breakdown and words. Only reachable from a finished round's results.
  function openList(id) {
    var players = (lastRoom && lastRoom.players) || {};
    var p = players[id];
    if (!p || !L.resultsReady(players, lastRoom.startAt, serverNow()) || p.score === null) return;
    viewUid = id;
    $('roomListName').textContent = (p.name || 'player') + (id === uid ? ' (you)' : '') + '’s list';
    var ul = $('roomListBreak'); ul.innerHTML = '';
    if (p.breakdown) fillRows(ul, root.Scoring.breakdownRows(p.breakdown));
    var words = $('roomListWords'); words.innerHTML = '';
    (p.words || []).forEach(function (item) {
      var li = document.createElement('li');
      var w = document.createElement('span'); w.textContent = item.w;
      var t = document.createElement('span'); t.className = 'tag ' + item.t;
      t.textContent = item.t === 'AB' ? 'Entendre' : item.t;
      li.appendChild(w); li.appendChild(t); words.appendChild(li);
    });
    if (!(p.words || []).length) {
      var none = document.createElement('li'); none.textContent = 'No words entered.'; words.appendChild(none);
    }
    renderResults();
  }

  // The room went away: the host left, the lobby expired, or it was removed while waiting.
  function kicked() {
    var wasIn = !!code;
    cleanup();
    if (!wasIn) return;
    showOnly('roomChoice');
    $('roomNote').textContent = 'That room has closed.';
    $('start').hidden = true;
  }

  function cleanup() {
    clearInterval(lobbyTick); clearInterval(resultsTick);
    if (roomRef) roomRef.off();
    code = null; roomRef = null; isHost = false; scheduled = false; lastRoom = null; myDone = false;
    myDetail = null; viewUid = null; roundInfo = null;
  }

  // Detaches listeners before writing, so the removal does not bounce back as "room closed" on this phone.
  function leave() {
    var ref = roomRef, host = isHost;
    cleanup();
    if (ref) {
      if (host) { ref.onDisconnect().cancel(); ref.remove(); }
      else {
        var me = ref.child('players/' + uid);
        me.onDisconnect().cancel();
        me.remove();
      }
    }
    closeToStart();
  }

  // ----- Buttons -----

  var formMode = 'create';
  $('privateRoom').addEventListener('click', function () {
    $('start').hidden = true;
    $('roomNote').textContent = enabled() ? '' : 'Private rooms are not set up yet.';
    showOnly('roomChoice');
  });
  $('privateRoomEnd').addEventListener('click', function () {
    $('end').hidden = true;
    $('roomNote').textContent = enabled() ? '' : 'Private rooms are not set up yet.';
    showOnly('roomChoice');
  });
  $('roomChoiceClose').addEventListener('click', closeToStart);
  $('roomCreate').addEventListener('click', function () { openForm('create'); });
  $('roomJoin').addEventListener('click', function () { openForm('join'); });
  $('roomFormClose').addEventListener('click', function () { showOnly('roomChoice'); });

  function openForm(mode) {
    formMode = mode;
    $('roomFormTitle').textContent = mode === 'create' ? 'Create room' : 'Join room';
    $('roomFormGo').textContent = mode === 'create' ? 'Create' : 'Join';
    $('roomCodeInput').hidden = mode === 'create';
    $('roomCodeInput').value = '';
    $('roomName').value = localStorage.getItem(NICK_KEY) || '';
    setErr('');
    showOnly('roomForm');
    $('roomName').focus();
  }

  $('roomFormGo').addEventListener('click', function () {
    if (busy) return;
    var name = $('roomName').value.trim();
    if (!name) { setErr('Enter a nickname.'); return; }
    var c = $('roomCodeInput').value.trim();
    if (formMode === 'join' && !L.isRoomCode(c)) { setErr('Enter the 5-digit room number.'); return; }
    try { localStorage.setItem(NICK_KEY, name); } catch (e) { /* private mode */ }
    setErr(''); setBusy(true);
    var go = formMode === 'create' ? createRoom(name) : joinRoom(c, name);
    go.then(openLobby, function (e) {
      cleanup();
      setErr(e && e.message ? e.message : 'Something went wrong.');
    }).then(function () { setBusy(false); });
  });

  $('lobbyStart').addEventListener('click', start);
  $('lobbyLeave').addEventListener('click', leave);
  $('roomResultsClose').addEventListener('click', function () { viewUid = null; showOnly(null); });
  $('roomRank').addEventListener('click', function (e) {
    var id = e.target && e.target.getAttribute && e.target.getAttribute('data-uid');
    if (id) openList(id);
  });
  $('roomListBack').addEventListener('click', function () { viewUid = null; renderResults(); });
  $('roomResultsLeave').addEventListener('click', leave);

  root.EntendreRooms = { finished: finished, enabled: enabled };
})(typeof window !== 'undefined' ? window : globalThis);
