const test = require('node:test');
const assert = require('node:assert');
const Scoring = require('./scoring.js');

test('density is zero for no scores', () => {
  assert.deepStrictEqual(Scoring.density([], [0, 5]), [0, 0]);
});

test('density peaks near the middle of a cluster and is smooth', () => {
  const scores = [40, 45, 50, 50, 55, 60];
  const xs = [];
  for (let x = 0; x <= 100; x += 1) xs.push(x);
  const ys = Scoring.density(scores, xs);
  const peak = xs[ys.indexOf(Math.max(...ys))];
  assert.ok(peak >= 45 && peak <= 55, 'peak at ' + peak);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1]) < 0.05, 'jump at ' + i);
});

test('density integrates to about 1 over a wide range', () => {
  const scores = [10, 20, 30, 35, 80];
  const xs = [];
  for (let x = -200; x <= 300; x += 0.5) xs.push(x);
  const ys = Scoring.density(scores, xs);
  const area = ys.reduce((t, y) => t + y * 0.5, 0);
  assert.ok(Math.abs(area - 1) < 0.02, 'area ' + area);
});

test('breakdown rows match the daily results layout', () => {
  const rows = Scoring.breakdownRows({ aOnlyCount: 2, bOnlyCount: 3, entendreCount: 1, entendreMultiplier: 2 });
  assert.deepStrictEqual(rows[0], ['A-only words', '2 (20 pts)']);
  assert.deepStrictEqual(rows[2], ['Entendre words', '1 (+10 pts)']);
  assert.deepStrictEqual(rows[3], ['Entendre multiplier', 'x 2']);
});
