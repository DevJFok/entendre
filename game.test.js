// Run: node game.test.js
const Scoring = require('./scoring.js'); globalThis.Scoring = Scoring;
require('./words.js'); require('./puzzles.js');
const { checkCandidate, localDateString } = require('./app.js');
const assert = require('assert');
(async () => {
  const P = Puzzles.dailyPuzzle('2026-11-22');
  const dict = w => Words.isDictionaryWord(w);
  const fit = async w => ({ fitA: await Words.fits(w, 'color'), fitB: await Words.fits(w, 'food') });
  const s = Scoring.createState();
  let calls = 0; const cdict = w => { calls++; return dict(w); };
  let r = await checkCandidate(s, '   ', cdict, fit); assert.equal(r.reason, 'empty'); assert.equal(calls, 0);
  r = await checkCandidate(s, ' Red ', cdict, fit); assert(r.accepted); assert.equal(r.type, 'A'); assert.equal(r.word, 'red');
  r = await checkCandidate(s, 'RED', cdict, fit); assert.equal(r.reason, 'duplicate'); assert.equal(calls, 1);
  r = await checkCandidate(s, 'zzqxv', cdict, fit); assert.equal(r.reason, 'notword'); assert.equal(r.message, 'not a word');
  r = await checkCandidate(s, 'stop', cdict, fit); assert.equal(r.reason, 'nofit'); assert.equal(r.message, "doesn't fit either category");
  r = await checkCandidate(s, 'bread', cdict, fit); assert(r.accepted); assert.equal(r.type, 'B');
  r = await checkCandidate(s, 'orange', cdict, fit); assert(r.accepted); assert.equal(r.type, 'AB');
  const b = Scoring.breakdown(s);
  assert.equal(b.aOnlyPoints, 20); assert.equal(b.multiplier, 3); assert.equal(b.entendreCount, 1);
  assert.equal(Scoring.total(s), 20 * 3 * 2); assert.equal(s.submitted.length, 3);
  assert.equal(Math.pow(2, b.entendreCount), 2);
  assert.equal(localDateString(new Date(2026, 0, 5)), '2026-01-05');
  assert(P.categoryA.label && P.categoryB.term);
  console.log('all game.test.js checks passed');
})().catch(e => { console.error(e); process.exit(1); });
