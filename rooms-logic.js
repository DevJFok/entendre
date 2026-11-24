/* Private room rules, pure functions only (tested in rooms-logic.test.js). Browser code lives in rooms.js. */
(function (root) {
  'use strict';
  var EXCLUDED_CODE = '00001'; // reserved for the daily game (room_number in Historical_Scores)
  var MAX_PLAYERS = 4, MIN_PLAYERS = 2;
  var LOBBY_MS = 120000;      // a room that has not started within 2 minutes closes
  var START_DELAY_MS = 3000;  // gives every phone time to receive the start before the round begins
  var ROUND_MS = 120000;      // the shared round length
  var RESULT_GRACE_MS = 15000; // results show after this even if a player never reported a score

  function pad5(n) { return ('0000' + n).slice(-5); }

  // A random 5-digit code from 00002 to 99999. The daily game's 00001 can never be produced.
  function randomRoomCode(rand) {
    var r = typeof rand === 'function' ? rand() : Math.random();
    return pad5(2 + Math.floor(r * 99998));
  }

  // Returns a code that taken(code) says is free, or null if every try hit a taken code.
  function pickCode(taken, rand, maxTries) {
    for (var i = 0; i < (maxTries || 20); i++) {
      var c = randomRoomCode(rand);
      if (c !== EXCLUDED_CODE && !taken(c)) return c;
    }
    return null;
  }

  function isRoomCode(s) { return /^\d{5}$/.test(String(s)) && String(s) !== EXCLUDED_CODE; }

  function playerCount(players) { return Object.keys(players || {}).length; }

  function lobbyExpired(createdAt, now) { return now - createdAt >= LOBBY_MS; }

  function canStart(players, status) {
    var n = playerCount(players);
    return status === 'waiting' && n >= MIN_PLAYERS && n <= MAX_PLAYERS;
  }

  // Why someone cannot join, or null when they can.
  function canJoin(room, uid, now) {
    if (!room) return 'no-room';
    if (room.status !== 'waiting') return 'started';
    if (lobbyExpired(room.createdAt, now)) return 'expired';
    if (playerCount(room.players) >= MAX_PLAYERS && !(room.players && room.players[uid])) return 'full';
    return null;
  }

  // Players sorted by score, highest first. Players with no score yet go last.
  function rankPlayers(players) {
    var list = Object.keys(players || {}).map(function (uid) {
      var p = players[uid] || {};
      return { uid: uid, name: p.name || 'player', score: typeof p.score === 'number' ? p.score : null };
    });
    list.sort(function (a, b) {
      if (a.score === null && b.score === null) return a.name < b.name ? -1 : 1;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
    return list;
  }

  // Results show once every player has a score, or after the round plus a grace period.
  function resultsReady(players, startAt, now) {
    var endAt = startAt + ROUND_MS;
    if (now >= endAt + RESULT_GRACE_MS) return true;
    return Object.keys(players || {}).every(function (uid) { return typeof (players[uid] || {}).score === 'number'; });
  }

  var api = {
    EXCLUDED_CODE: EXCLUDED_CODE, MAX_PLAYERS: MAX_PLAYERS, MIN_PLAYERS: MIN_PLAYERS,
    LOBBY_MS: LOBBY_MS, START_DELAY_MS: START_DELAY_MS, ROUND_MS: ROUND_MS, RESULT_GRACE_MS: RESULT_GRACE_MS,
    randomRoomCode: randomRoomCode, pickCode: pickCode, isRoomCode: isRoomCode, playerCount: playerCount,
    lobbyExpired: lobbyExpired, canStart: canStart, canJoin: canJoin, rankPlayers: rankPlayers, resultsReady: resultsReady
  };
  root.RoomLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
