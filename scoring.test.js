const assert = require('assert');
const Scoring = require('./scoring.js');

function test(name, fn) { fn(); console.log('pass: ' + name); }

test('worked example: A + B + entendre = 80 (B adds 1; entendre adds 1 to the multiplier and doubles the total)', () => {
  const s = Scoring.createState();
  assert.strictEqual(Scoring.submitWord(s, 'lemon', true, false).type, 'A');
  assert.strictEqual(Scoring.submitWord(s, 'bread', false, true).type, 'B');
  assert.strictEqual(Scoring.submitWord(s, 'orange', true, true).type, 'AB');
  assert.strictEqual(Scoring.total(s), 80);
  const b = Scoring.breakdown(s);
  assert.deepStrictEqual(b, { aOnlyCount: 1, aOnlyPoints: 20, bOnlyCount: 1, entendreCount: 1, multiplier: 2, entendreMultiplier: 2, total: 80 });
});

test('duplicates rejected incl. case/whitespace', () => {
  const s = Scoring.createState();
  assert.ok(Scoring.submitWord(s, 'lemon', true, false).accepted);
  for (const w of ['lemon', 'LEMON', '  Lemon  ']) {
    const r = Scoring.submitWord(s, w, true, false);
    assert.deepStrictEqual(r, { accepted: false, reason: 'duplicate', type: null });
  }
  assert.strictEqual(s.submitted.length, 1);
});

test('nofit rejected', () => {
  const s = Scoring.createState();
  assert.deepStrictEqual(Scoring.submitWord(s, 'rock', false, false), { accepted: false, reason: 'nofit', type: null });
});

test('empty rejected', () => {
  const s = Scoring.createState();
  for (const w of ['', '   ', null, undefined]) {
    assert.deepStrictEqual(Scoring.submitWord(s, w, true, true), { accepted: false, reason: 'empty', type: null });
  }
});

test('zero words total is 0', () => {
  assert.strictEqual(Scoring.total(Scoring.createState()), 0);
});

test('three entendres raise the multiplier to 3 (x8 doubling); two B words then make it 5', () => {
  const s = Scoring.createState();
  ['a', 'b', 'c'].forEach(w => Scoring.submitWord(s, w, true, true));
  assert.strictEqual(Scoring.total(s), 30 * 3 * 8, 'each entendre adds 1 to the multiplier');
  Scoring.submitWord(s, 'd', false, true); // B only
  Scoring.submitWord(s, 'e', false, true); // B only
  // base 30, multiplier 5, x8
  assert.strictEqual(Scoring.total(s), 30 * 5 * 8);
  assert.strictEqual(s.entendreCount, 3);
});

test('rejected word does not change state', () => {
  const s = Scoring.createState();
  Scoring.submitWord(s, 'lemon', true, false);
  const before = JSON.stringify(s);
  Scoring.submitWord(s, 'lemon', true, false);
  Scoring.submitWord(s, 'rock', false, false);
  Scoring.submitWord(s, '', true, true);
  assert.strictEqual(JSON.stringify(s), before);
});
console.log('all tests passed');
