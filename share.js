/* Entendre share: builds the end-of-game share text and sends it via Web Share, the clipboard,
   or a selectable box as a last resort. Plain browser script, defines global `shareResult`.
   buildShareText is pure and exported for tests (module.exports in Node). */
(function (root) {
  'use strict';
  var SITE_URL = 'https://devjfok.github.io/entendre/';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /* breakdown: the object returned by Scoring.breakdown(state). dateLabel: e.g. 'November 22'. */
  function buildShareText(breakdown, dateLabel, siteUrl) {
    var url = siteUrl == null ? SITE_URL : siteUrl;
    return [
      url,
      dateLabel,
      // 🟡 = Colors-only (category A) words, 🟢 = Foods-only (category B) words,
      // ✨ = entendres (both categories). Each line shows its count and the points it earned.
      '🟡 ' + breakdown.aOnlyCount + ' (' + (breakdown.aOnlyCount * 10) + ') ' +
        '🟢 ' + breakdown.bOnlyCount + ' ' +
        '✨ ' + breakdown.entendreCount + ' (' + (breakdown.entendreCount * 10) + ') ' +
        '🔥 x' + Math.pow(2, breakdown.entendreCount),
      'Final score: ' + breakdown.total
    ].join('\n');
  }

  // UTC, to match the daily puzzle date.
  function dateLabelFor(d) { return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }

  var api = { buildShareText: buildShareText, dateLabelFor: dateLabelFor, SITE_URL: SITE_URL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  var CONFIRM_MS = 2000;
  var CONFIRM_LABEL = 'Copied — paste it into a text';
  var originalLabel = null, labelTimer = null;

  function flashButton(btn, label) {
    if (!btn) return;
    if (originalLabel === null) originalLabel = btn.textContent;
    btn.textContent = label;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(function () { btn.textContent = originalLabel; }, CONFIRM_MS);
  }

  // Hidden textarea + execCommand. Returns true when the browser reports success.
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // Resolves to true on success, false otherwise.
  function copyText(text) {
    var clip = root.navigator && root.navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      return Promise.resolve()
        .then(function () { return clip.writeText(text); })
        .then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function showTextBox(text, btn) {
    if (!btn || !btn.parentNode) return;
    var box = document.getElementById('shareBox');
    if (!box) {
      box = document.createElement('textarea');
      box.id = 'shareBox';
      box.readOnly = true;
      box.rows = 4;
      box.setAttribute('aria-label', 'Share text, select and copy');
      box.style.cssText = 'width:100%;margin-top:10px;font:inherit;font-size:.9rem;box-sizing:border-box;';
      btn.parentNode.insertBefore(box, btn.nextSibling);
    }
    box.value = text;
    box.hidden = false;
    box.focus();
    box.select();
  }

  function copyOrShow(text, btn) {
    copyText(text).then(function (ok) {
      if (ok) flashButton(btn, CONFIRM_LABEL);
      else showTextBox(text, btn);
    });
  }

  // Wraps navigator.share so a synchronous throw becomes a rejection.
  function systemShare(text) {
    try { return root.navigator.share({ text: text }); }
    catch (e) { return Promise.reject(e); }
  }

  // Phones use the system share sheet. Computers always get the text in a selectable box and on the clipboard,
  // because desktop browsers may report Web Share as available but open nothing visible.
  function isTouchDevice() {
    var nav = root.navigator || {};
    return (nav.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad|iPod/i.test(nav.userAgent || '');
  }

  function shareResult(state, puzzle) {
    // puzzle is unused: the share date is today's local date, per the spec.
    var text = buildShareText(root.Scoring.breakdown(state), dateLabelFor(new Date()));
    var btn = document.getElementById('share');
    // Call navigator.share synchronously so it stays inside the click's user gesture.
    if (isTouchDevice() && root.navigator && typeof root.navigator.share === 'function') {
      systemShare(text).catch(function (err) {
        if (err && err.name === 'AbortError') return; // user dismissed the share sheet
        copyOrShow(text, btn);
      });
      return;
    }
    showTextBox(text, btn);
    copyText(text).then(function (ok) { if (ok) flashButton(btn, CONFIRM_LABEL); });
  }

  root.shareResult = shareResult;
})(typeof window !== 'undefined' ? window : globalThis);
