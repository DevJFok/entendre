/* Entendre review queue. Sends words players tried that were rejected (not a word, or not a fit) to the
 * review sheet, along with the two categories of that day's puzzle. Words on the ban list are never sent.
 * Batches of up to 50 per request, and at most 50 words per device per day.
 * Does nothing until CONFIG.endpoint is set to the deployed Apps Script web app URL. */
(function (root) {
  'use strict';
  var CONFIG = { endpoint: 'https://script.google.com/macros/s/AKfycbyi7vjwKRMYlcCgBXT69zPY4qghXJXrsR2fcCh8IKdSg5eJami5YQOBt4NLf5AiorcaCQ/exec', batchSize: 50, dailyCap: 50 };
  var DEVICE_KEY = 'entendre_device', SENT_KEY = 'entendre_logged';

  function isLoggable(word) { return /^[a-z]+$/.test(word) && word.length >= 2 && word.length <= 30; }

  function batches(items, size) {
    var out = [];
    for (var i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  function todayUtc(now) { return new Date(now()).toISOString().slice(0, 10); }

  // Builds a queue. Options are injectable so the logic can be tested without a browser.
  function createQueue(opts) {
    var endpoint = opts.endpoint, batchSize = opts.batchSize, dailyCap = opts.dailyCap;
    var storage = opts.storage, doFetch = opts.fetch, isBlocked = opts.isBlocked, now = opts.now;
    var pending = [], seen = Object.create(null);

    function getStored(key, fallback) {
      try { var v = storage && storage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    }
    function setStored(key, value) { try { storage && storage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }

    function deviceId() {
      var id = getStored(DEVICE_KEY, null);
      if (!id) {
        id = 'd' + now().toString(36) + Math.random().toString(36).slice(2, 12);
        setStored(DEVICE_KEY, id);
      }
      return id;
    }

    // Count of words this device has logged today (UTC), kept across visits.
    function loggedToday() {
      var rec = getStored(SENT_KEY, null), day = todayUtc(now);
      return rec && rec.date === day ? rec.count : 0;
    }

    function add(rawWord, puzzleCategories) {
      var word = String(rawWord == null ? '' : rawWord).trim().toLowerCase();
      if (!isLoggable(word)) return false;
      if (isBlocked && isBlocked(word)) return false;
      var key = word + '|' + puzzleCategories;
      if (seen[key]) return false;
      if (loggedToday() >= dailyCap) return false;
      seen[key] = true;
      pending.push({ word: word, categories: puzzleCategories });
      setStored(SENT_KEY, { date: todayUtc(now), count: loggedToday() + 1 });
      if (pending.length >= batchSize) flush();
      return true;
    }

    // Sends everything queued, in batches. Failed batches go back in the queue for the next flush.
    function flush() {
      if (!endpoint || !pending.length || !doFetch) return Promise.resolve();
      var toSend = pending.splice(0, pending.length);
      var jobs = batches(toSend, batchSize).map(function (chunk) {
        return Promise.resolve(doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // plain text avoids a CORS preflight
          body: JSON.stringify({ device: deviceId(), words: chunk }),
          keepalive: true
        })).catch(function () { pending.push.apply(pending, chunk); });
      });
      return Promise.all(jobs).then(function () {});
    }

    return { add: add, flush: flush, pendingCount: function () { return pending.length; }, deviceId: deviceId };
  }

  var api = { createQueue: createQueue, batches: batches, isLoggable: isLoggable, CONFIG: CONFIG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // Browser instance: uses the ban list loaded by remote.js and the device's local storage.
  // Records the day's categories in the archive sheet, once per device per day. The sheet ignores repeat dates too.
  root.postArchive = function (date, a, b) {
    if (!CONFIG.endpoint || !root.fetch) return;
    var storage = root.localStorage;
    try { if (storage.getItem('entendre_archived') === date) return; } catch (e) { /* private mode */ }
    root.fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'archive', date: date, category_a: a, category_b: b }),
      keepalive: true
    }).then(function () { try { storage.setItem('entendre_archived', date); } catch (e) { /* ignore */ } }, function () {});
  };

  // Records a finished round in Historical_Scores: date, the two categories, the score, the mode, and room_number
  // (00001 for daily, the 5-digit code for a private room, blank otherwise).
  root.postScore = function (date, a, b, score, mode, room) {
    if (!CONFIG.endpoint || !root.fetch) return;
    root.fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'score', date: date, category_a: a, category_b: b, score: score, mode: mode, room_number: room || '' }),
      keepalive: true
    }).catch(function () {});
  };

  // Reads today's daily-game stats for the results curve. Resolves with {n, mean, sd, beat}, or null if the read fails.
  root.scoreStats = function (date, a, b, score) {
    if (!CONFIG.endpoint || !root.fetch) return Promise.resolve(null);
    var q = '?action=stats&date=' + encodeURIComponent(date) + '&a=' + encodeURIComponent(a) +
      '&b=' + encodeURIComponent(b) + '&score=' + encodeURIComponent(score);
    return root.fetch(CONFIG.endpoint + q)
      .then(function (r) { return r.json(); })
      .then(function (j) { return j && j.ok ? j : null; }, function () { return null; });
  };

  root.ReviewQueue = createQueue({
    endpoint: CONFIG.endpoint,
    batchSize: CONFIG.batchSize,
    dailyCap: CONFIG.dailyCap,
    storage: root.localStorage,
    fetch: root.fetch ? root.fetch.bind(root) : null,
    now: function () { return Date.now(); },
    isBlocked: function (w) { return !!(root.EntendreRemote && root.EntendreRemote.blocked && root.EntendreRemote.blocked.has(w)); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
