// Run: node share.test.js
const assert = require('assert');
const { buildShareText, dateLabelFor } = require('./share.js');

function test(name, fn) { fn(); console.log('pass: ' + name); }

test('worked example produces exact share text', () => {
  const breakdown = { aOnlyCount: 1, aOnlyPoints: 20, bOnlyCount: 1, entendreCount: 1, multiplier: 1, total: 40 };
  const text = buildShareText(breakdown, 'November 22');
  assert.strictEqual(text, [
    'Play: https://devjfok.github.io/entendre/',
    'November 22',
    '\u{1F7E1} 1 (10) \u{1F7E2} 1 ✨ 1 (10) \u{1F525} x2',
    'Final score: 40'
  ].join('\n'));
  assert.deepStrictEqual(text.split('\n').length, 4);
});

test('share text starts with Play: before the site link', () => {
  const breakdown = { aOnlyCount: 0, aOnlyPoints: 0, bOnlyCount: 0, entendreCount: 0, multiplier: 1, total: 0 };
  assert.ok(buildShareText(breakdown, 'January 5').startsWith('Play: https://devjfok.github.io/entendre/\nJanuary 5\n'));
});

test('dateLabelFor uses month name and day of month', () => {
  assert.strictEqual(dateLabelFor(new Date('2026-11-22T15:00:00-05:00')), 'November 22');
  assert.strictEqual(dateLabelFor(new Date('2026-01-05T15:00:00-05:00')), 'January 5');
});

console.log('all share tests passed');

test('user example: one Colors word, one Foods word, no entendres', () => {
  const breakdown = { aOnlyCount: 1, bOnlyCount: 1, entendreCount: 0, multiplier: 2, total: 20 };
  assert.strictEqual(buildShareText(breakdown, 'November 22'), [
    'Play: https://devjfok.github.io/entendre/',
    'November 22',
    '\u{1F7E1} 1 (10) \u{1F7E2} 1 ✨ 0 (0) \u{1F525} x1',
    'Final score: 20'
  ].join('\n'));
});
