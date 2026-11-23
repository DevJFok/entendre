/* Entendre review backend. Bound to the "Entendre Words" spreadsheet (Extensions > Apps Script).
 *
 * doPost: the game sends rejected player words here (up to 50 per request, at most 50 per device per day).
 *         New words are appended to review_list with an empty review_status and category_to_add.
 * onEdit: when a reviewer sets review_status to "approve" AND fills category_to_add, the word moves to
 *         word_list (with its ancestor categories from categories_list, plus its plural), and the review row is removed.
 *         "reject" rows stay in review_list.
 */

var WORDS_SHEET_ID = '12vHqO51gMYOVlvb9UtITqnml6jExnSM6Vk84YYOdKJY';
var REVIEW_SHEET = 'review_list', WORD_SHEET = 'word_list', CATS_SHEET = 'categories_list', BAN_SHEET = 'ban_list';
var DAILY_CAP = 50, BATCH_MAX = 50;

// ---------- Intake from the game ----------

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents || '{}');
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
      rows.push([word, cats, '', '']);
      added++;
    });
    if (rows.length) review.getRange(reviewLast + 1, 1, rows.length, 4).setValues(rows);
    if (added) props.setProperty(capKey, String(used + added));
    return json({ ok: true, added: added, skipped: skipped });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- Approval flow ----------

// Runs when someone edits the spreadsheet by hand.
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== REVIEW_SHEET || e.range.getRow() < 2) return;
  var row = e.range.getRow();
  var status = norm(sheet.getRange(row, 3).getValue());
  var toAdd = norm(sheet.getRange(row, 4).getValue());
  if (status !== 'approve' && status !== 'reject') return;
  if (status === 'approve' && !toAdd) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var word = norm(sheet.getRange(row, 1).getValue());
    var ss = SpreadsheetApp.openById(WORDS_SHEET_ID);
    if (status === 'reject') {
      // Rejected words go to ban_list (word only) and leave the review queue.
      addToBanList(ss, word);
      sheet.deleteRow(row);
      return;
    }
    var cats = expandCategories(ss, toAdd.split(','));
    var type = typeOf(cats);
    addToWordList(ss, word, cats, type);
    sheet.deleteRow(row);
  } finally {
    lock.releaseLock();
  }
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

// Adds the word and its plural to word_list. If the word is already there, its categories are merged instead.
function addToWordList(ss, word, cats, type) {
  var sheet = ss.getSheetByName(WORD_SHEET);
  var rowsAll = sheet.getRange(2, 1, Math.max(1, lastWordRow(sheet) - 1), 4).getValues();
  var entries = [[word, cats, type]];
  var p = pluralOf(word, type);
  if (p) entries.push([p, cats, type]);

  entries.forEach(function (entry) {
    var w = entry[0], c = entry[1], t = entry[2];
    var hit = -1;
    for (var i = 0; i < rowsAll.length; i++) if (norm(rowsAll[i][1]) === w) { hit = i; break; }
    if (hit !== -1) {
      var existing = norm(rowsAll[hit][0]).split(',').filter(Boolean);
      var merged = {};
      existing.concat(c.split(',')).forEach(function (x) { if (x) merged[x] = true; });
      var joined = Object.keys(merged).sort().join(',');
      sheet.getRange(hit + 2, 1).setValue(joined);
      rowsAll[hit][0] = joined;
    } else {
      sheet.getRange(lastWordRow(sheet) + 1, 1, 1, 4).setValues([[c, w, t, 'approved']]);
      rowsAll.push([c, w, t, 'approved']);
    }
  });
}

// Plural rules copied from the sheet builder. Uncountable and invariant words get none.
var IRREGULAR = { mouse: 'mice', goose: 'geese', potato: 'potatoes', tomato: 'tomatoes', wolf: 'wolves' };
var INVARIANT = ['sheep', 'deer', 'moose', 'bison', 'salmon', 'trout', 'tuna', 'cod', 'bass', 'shrimp', 'fish', 'buffalo'];
var UNCOUNTABLE = ('water rice salt sugar flour butter honey cream bread rain sleet hail mist fog dew steam vapor brine slush drizzle downpour babble burble murmur gossip banter chatter jaw yak fly tea sea ocean tide wet damp moist soak drench spill pour gush spray splash surf swell current drip leak flood deluge').split(' ');

function pluralOf(w, type) {
  if (type === 'dictionary' && UNCOUNTABLE.indexOf(w) !== -1) return null;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (INVARIANT.indexOf(w) !== -1) return null;
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
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
