/* Entendre review backend. Bound to the "Entendre Words" spreadsheet (Extensions > Apps Script).
 *
 * doPost: the game sends rejected player words here (up to 50 per request, at most 50 per device per day).
 *         New words are appended to review_list with an empty review_status and category_to_add.
 *         review_list columns: A word, B puzzle_categories, C review_status, D category suggestion, E category_to_add,
 *         F plural form, G singular form, H AI suggestions, I plural/singular suggestion.
 * processReviewList (every minute): "approve" rows with category_to_add move to word_list (with ancestor categories
 *         from categories_list, plus any plural/singular the reviewer typed in E:F). "reject" rows move to ban_list.
 */

var WORDS_SHEET_ID = '12vHqO51gMYOVlvb9UtITqnml6jExnSM6Vk84YYOdKJY';
var REVIEW_SHEET = 'review_list', WORD_SHEET = 'word_list', CATS_SHEET = 'categories_list', BAN_SHEET = 'ban_list';
var ARCHIVE_SHEET_ID = '1t81EHCzezSIF8Q1jeZd-gbf0b27fS6DhG-0VT88TpLw';
var DAILY_CAP = 50, BATCH_MAX = 50;

// ---------- Intake from the game ----------

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.action === 'archive') return archiveDay(body);
    if (body.action === 'score') return scoreRound(body);
    var device = String(body.device || '').slice(0, 100);
    var words = Array.isArray(body.words) ? body.words.slice(0, BATCH_MAX) : [];
    if (!device || !words.length) return json({ ok: false, error: 'nothing to add' });

    var props = PropertiesService.getScriptProperties();
    var capKey = 'cap:' + device + ':' + todayUtc();
    var used = Number(props.getProperty(capKey) || 0);
    var room = DAILY_CAP - used;
    if (room <= 0) return json({ ok: false, error: 'daily limit reached' });

    var ss = SpreadsheetApp.openById(WORDS_SHEET_ID);
    var review = ss.getSheetByName(REVIEW_SHEET);
    var existingReview = {};
    var reviewLast = lastFilledRow(review, 1);
    var reviewRows = reviewLast > 1 ? review.getRange(2, 1, reviewLast - 1, 2).getValues() : [];
    reviewRows.forEach(function (r) { existingReview[norm(r[0]) + '|' + norm(r[1])] = true; });
    var known = knownWords(ss);
    var blocked = blockedWords(ss);

    var rows = [], added = 0, skipped = 0;
    words.forEach(function (item) {
      var word = norm(item && item.word), cats = norm(item && item.categories);
      var key = word + '|' + cats;
      var ok = /^[a-z]+$/.test(word) && word.length >= 2 && word.length <= 30 && cats && added < room;
      if (!ok || blocked[word] || known[word] || existingReview[key]) { skipped++; return; }
      existingReview[key] = true;
      rows.push([word, cats, '', '', '']);
      added++;
    });
    if (rows.length) review.getRange(reviewLast + 1, 1, rows.length, 5).setValues(rows);
    if (added) props.setProperty(capKey, String(used + added));
    return json({ ok: true, added: added, skipped: skipped });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- Archive and scores ----------

// Dates are compared as YYYY-MM-DD. The sheet may hold them as M/D/YYYY text or as real dates.
function isoDate(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Writes a YYYY-MM-DD date as M/D/YYYY text, to match the Archive tab.
function sheetDate(iso) {
  var p = iso.split('-');
  return Number(p[1]) + '/' + Number(p[2]) + '/' + p[0];
}

// Fills in today's categories on the Archive tab. An existing row keeps its categories; a missing date is added.
function archiveDay(body) {
  var ss = SpreadsheetApp.openById(ARCHIVE_SHEET_ID);
  var sheet = ss.getSheetByName('Archive');
  var tz = ss.getSpreadsheetTimeZone();
  var date = isoDate(body.date, tz), a = norm(body.category_a), b = norm(body.category_b);
  if (!date || !/^[a-z]+$/.test(a) || !/^[a-z]+$/.test(b)) return json({ ok: false, error: 'bad archive entry' });
  var last = sheet.getLastRow();
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (isoDate(rows[i][0], tz) !== date) continue;
      if (norm(rows[i][1]) && norm(rows[i][2])) return json({ ok: true, added: 0 });
      sheet.getRange(i + 2, 2, 1, 2).setValues([[a, b]]);
      return json({ ok: true, added: 0, filled: true });
    }
  }
  var row = sheet.getRange(last + 1, 1, 1, 3);
  row.setNumberFormat('@');
  row.setValues([[sheetDate(date), a, b]]);
  return json({ ok: true, added: 1 });
}

// Records one finished round in Historical_Scores: date, the two categories, the score, and the mode (daily, archive or endless).
function scoreRound(body) {
  var ss = SpreadsheetApp.openById(ARCHIVE_SHEET_ID);
  var tz = ss.getSpreadsheetTimeZone();
  var date = isoDate(body.date, tz), a = norm(body.category_a), b = norm(body.category_b);
  var score = Math.round(Number(body.score)), mode = norm(body.mode);
  if (!date || !/^[a-z]+$/.test(a) || !/^[a-z]+$/.test(b) || !isFinite(score) || score < 0 || score > 100000 ||
      ['daily', 'archive', 'endless'].indexOf(mode) === -1) {
    return json({ ok: false, error: 'bad score entry' });
  }
  var sheet = ss.getSheetByName('Historical_Scores');
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1).setNumberFormat('@');
  sheet.getRange(row, 1, 1, 5).setValues([[sheetDate(date), a, b, score, mode]]);
  return json({ ok: true, added: 1 });
}

// Read side for the results curve. Returns only aggregates for today's daily game (matched by date and both categories):
// how many scores there are, their mean and standard deviation, and the share of them below the player's score.
// The player's own score is not in the sheet yet when this runs, so it is never counted in its own curve.
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action !== 'stats') return json({ ok: false, error: 'unknown action' });
    var ss = SpreadsheetApp.openById(ARCHIVE_SHEET_ID);
    var tz = ss.getSpreadsheetTimeZone();
    var date = isoDate(p.date, tz), a = norm(p.a), b = norm(p.b), me = Number(p.score);
    if (!date || !a || !b) return json({ ok: false, error: 'bad stats request' });
    var sheet = ss.getSheetByName('Historical_Scores');
    var last = sheet.getLastRow();
    var scores = [];
    if (last > 1) {
      sheet.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
        var s = Number(r[3]);
        if (norm(r[4]) === 'daily' && isoDate(r[0], tz) === date && norm(r[1]) === a && norm(r[2]) === b && isFinite(s)) scores.push(s);
      });
    }
    var n = scores.length, mean = 0, sd = 0, beat = null;
    if (n) {
      mean = scores.reduce(function (t, s) { return t + s; }, 0) / n;
      sd = Math.sqrt(scores.reduce(function (t, s) { return t + (s - mean) * (s - mean); }, 0) / n);
      if (isFinite(me)) beat = scores.filter(function (s) { return s < me; }).length / n;
    }
    return json({ ok: true, n: n, mean: mean, sd: sd, beat: beat });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ---------- Approval flow ----------

// Runs every minute from a time-based trigger (see installReviewTrigger), so it has the owner's permissions.
// Approved rows move to word_list, rejected rows move to ban_list, and both leave review_list.
// Only columns A to D are rewritten, so the plural/singular formulas in E and F are never shifted.
function processReviewList() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var ss = SpreadsheetApp.openById(WORDS_SHEET_ID);
    var sheet = ss.getSheetByName(REVIEW_SHEET);
    var last = lastFilledRow(sheet, 1);
    if (last < 2) return;
    // A:I is the review entry, the category suggestion (D), the reviewer's category_to_add (E), plural/singular (F:G), and the AI suggestions (H:I). All move together.
    var data = sheet.getRange(2, 1, last - 1, 9).getValues();
    var keep = [];
    data.forEach(function (r) {
      var word = norm(r[0]), status = norm(r[2]), toAdd = norm(r[4]);
      if (word && status === 'reject') {
        addToBanList(ss, word);
      } else if (word && status === 'approve' && toAdd) {
        var cats = expandCategories(ss, toAdd.split(','));
        // The reviewer types the plural (E) and/or singular (F) when they apply; each one is added as its own row.
        var forms = [word];
        if (norm(r[5])) forms.push(norm(r[5]));
        if (norm(r[6])) forms.push(norm(r[6]));
        addToWordList(ss, forms, cats, typeOf(cats));
      } else {
        keep.push(r);
        return;
      }
    });
    // Rewrite the remaining rows at the top, then clear what is left below them.
    if (keep.length) sheet.getRange(2, 1, keep.length, 9).setValues(keep);
    var clearFrom = keep.length + 2;
    if (clearFrom <= last) sheet.getRange(clearFrom, 1, last - clearFrom + 1, 9).clearContent();
  } finally {
    lock.releaseLock();
  }
}

// Run this once from the Apps Script editor (select installReviewTrigger, then Run) and approve the permissions.
function installReviewTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processReviewList') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processReviewList').timeBased().everyMinutes(1).create();
}

// category_to_add may hold several comma-separated categories. Each one adds its ancestors from categories_list.
function expandCategories(ss, list) {
  var ancestors = treeAncestors(ss);
  var out = {};
  list.forEach(function (raw) {
    var c = norm(raw);
    if (!c) return;
    out[c] = true;
    (ancestors[c] || []).forEach(function (a) { out[a] = true; });
  });
  return Object.keys(out).sort();
}

// Reads the tree (level1 > level2 > level3) and maps each category to all of its ancestors.
function treeAncestors(ss) {
  var values = ss.getSheetByName(CATS_SHEET).getRange(2, 1, Math.max(1, ss.getSheetByName(CATS_SHEET).getLastRow() - 1), 3).getValues();
  var path = ['', '', ''], map = {};
  values.forEach(function (r) {
    var levels = [norm(r[0]), norm(r[1]), norm(r[2])];
    var last = -1;
    for (var i = 0; i < 3; i++) {
      if (levels[i]) { path[i] = levels[i]; for (var j = i + 1; j < 3; j++) path[j] = ''; last = i; }
    }
    if (last < 0) return;
    var node = path[last];
    map[node] = path.slice(0, last).filter(Boolean);
  });
  return map;
}

// Same order as the sheet builder: brand, then name, then slang, else dictionary.
function typeOf(cats) {
  var order = [['brand', 'brand'], ['name', 'name'], ['slang', 'slang']];
  for (var i = 0; i < order.length; i++) if (cats.indexOf(order[i][0]) !== -1) return order[i][1];
  return 'dictionary';
}

// Adds each form (the word, plus any plural/singular the reviewer typed) to word_list.
// If a form is already there, its categories are merged instead of adding a second row.
function addToWordList(ss, forms, cats, type) {
  var sheet = ss.getSheetByName(WORD_SHEET);
  var rowsAll = sheet.getRange(2, 1, Math.max(1, lastWordRow(sheet) - 1), 4).getValues();
  forms.forEach(function (w) {
    var hit = -1;
    for (var i = 0; i < rowsAll.length; i++) if (norm(rowsAll[i][1]) === w) { hit = i; break; }
    if (hit !== -1) {
      var merged = {};
      norm(rowsAll[hit][0]).split(',').concat(cats).forEach(function (x) { if (x) merged[x] = true; });
      var joined = Object.keys(merged).sort().join(',');
      sheet.getRange(hit + 2, 1).setValue(joined);
      rowsAll[hit][0] = joined;
    } else {
      sheet.getRange(lastWordRow(sheet) + 1, 1, 1, 4).setValues([[cats.join(','), w, type, 'approved']]);
      rowsAll.push([cats.join(','), w, type, 'approved']);
    }
  });
}

// ---------- Helpers ----------

// The plural/singular formulas run down to row 5000, so getLastRow() is not usable.
// Find the last row that has a value in the given column (1 = word column A on review_list, 2 = word column B on word_list).
function lastFilledRow(sheet, col) {
  var vals = sheet.getRange(1, col, 5000, 1).getValues();
  for (var i = vals.length - 1; i >= 1; i--) if (norm(vals[i][0])) return i + 1;
  return 1;
}
function lastWordRow(sheet) { return lastFilledRow(sheet, 2); }

function knownWords(ss) {
  var sheet = ss.getSheetByName(WORD_SHEET), out = {};
  sheet.getRange(2, 2, Math.max(1, lastWordRow(sheet) - 1), 1).getValues().forEach(function (r) { out[norm(r[0])] = true; });
  return out;
}

function blockedWords(ss) {
  var out = {};
  var sheet = ss.getSheetByName(BAN_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) { var w = norm(r[0]); if (w) out[w] = true; });
  return out;
}

// Adds one word to ban_list unless it is already there.
function addToBanList(ss, word) {
  var sheet = ss.getSheetByName(BAN_SHEET);
  var existing = blockedWords(ss);
  if (existing[word]) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 1).setValues([[word]]);
}

function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function todayUtc() { return Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'); }
function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
