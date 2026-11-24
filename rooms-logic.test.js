const test = require('node:test');
const assert = require('node:assert');
const R = require('./rooms-logic.js');

test('random codes are 5 digits and never 00001', () => {
  for (let i = 0; i < 2000; i++) {
    const c = R.randomRoomCode();
    assert.match(c, /^\d{5}$/);
    assert.notStrictEqual(c, '00001');
  }
  assert.strictEqual(R.randomRoomCode(() => 0), '00002');
  assert.strictEqual(R.randomRoomCode(() => 0.9999999), '99999');
});

test('pickCode skips taken codes and the daily code', () => {
  const taken = new Set(['00002', '00003']);
  assert.strictEqual(R.pickCode(c => taken.has(c), () => 0, 5), null); // every try lands on 00002
  let calls = 0;
  const seq = ['00001', '00003', '00004'];
  const rand = () => { const c = seq[calls++]; return (Number(c) - 2) / 99998; };
  assert.strictEqual(R.pickCode(c => taken.has(c), rand, 5), '00004');
});

test('isRoomCode rejects the daily code and non-numbers', () => {
  assert.strictEqual(R.isRoomCode('12345'), true);
  assert.strictEqual(R.isRoomCode('00001'), false);
  assert.strictEqual(R.isRoomCode('1234'), false);
  assert.strictEqual(R.isRoomCode('abcde'), false);
});

test('start needs 2 to 4 players while waiting', () => {
  const p = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['u' + i, { name: 'p' + i }]));
  assert.strictEqual(R.canStart(p(1), 'waiting'), false);
  assert.strictEqual(R.canStart(p(2), 'waiting'), true);
  assert.strictEqual(R.canStart(p(4), 'waiting'), true);
  assert.strictEqual(R.canStart(p(2), 'playing'), false);
});

test('join is refused for missing, started, expired or full rooms', () => {
  const now = 1000000;
  const p = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['u' + i, { name: 'p' + i }]));
  assert.strictEqual(R.canJoin(null, 'x', now), 'no-room');
  assert.strictEqual(R.canJoin({ status: 'playing', createdAt: now, players: p(1) }, 'x', now), 'started');
  assert.strictEqual(R.canJoin({ status: 'waiting', createdAt: now - R.LOBBY_MS, players: p(1) }, 'x', now), 'expired');
  assert.strictEqual(R.canJoin({ status: 'waiting', createdAt: now, players: p(4) }, 'x', now), 'full');
  assert.strictEqual(R.canJoin({ status: 'waiting', createdAt: now, players: p(4) }, 'u1', now), null); // already inside
  assert.strictEqual(R.canJoin({ status: 'waiting', createdAt: now, players: p(2) }, 'x', now), null);
});

test('ranking sorts by score and puts missing scores last', () => {
  const r = R.rankPlayers({ a: { name: 'Ann', score: 50 }, b: { name: 'Bo' }, c: { name: 'Cy', score: 120 } });
  assert.deepStrictEqual(r.map(x => x.name), ['Cy', 'Ann', 'Bo']);
  assert.strictEqual(r[2].score, null);
});

test('results wait for every score, then fall back after the grace period', () => {
  const start = 0;
  const players = { a: { score: 10 }, b: { name: 'x' } };
  assert.strictEqual(R.resultsReady(players, start, R.ROUND_MS), false);
  assert.strictEqual(R.resultsReady(players, start, R.ROUND_MS + R.RESULT_GRACE_MS), true);
  assert.strictEqual(R.resultsReady({ a: { score: 1 }, b: { score: 2 } }, start, 5), true);
});
