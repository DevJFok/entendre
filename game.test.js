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
  // Singular/plural pairs score once: the second form is refused with the message for the form already used.
{
  const remoteMod = require('./remote.js');
  const { canonicalForm } = remoteMod;
  remoteMod.buildLists(remoteMod.parseCsv(['category,word,type,status,plural form,singular form', 'food,apple,dictionary,approved,apples,', 'food,apples,dictionary,approved,,apple'].join('\n')), remoteMod.parseCsv('word\n'));
  const pairFit = async w => ({ fitA: true, fitB: false });
  const dictAll = async () => true;
  const st = Scoring.createState();
  let r = await checkCandidate(st, 'apples', dictAll, pairFit, canonicalForm);
  assert(r.accepted, 'first form scores');
  r = await checkCandidate(st, 'apple', dictAll, pairFit, canonicalForm);
  assert.equal(r.reason, 'pluralEntered'); assert.equal(r.message, 'plural form already entered');
  const st2 = Scoring.createState();
  await checkCandidate(st2, 'apple', dictAll, pairFit, canonicalForm);
  r = await checkCandidate(st2, 'apples', dictAll, pairFit, canonicalForm);
  assert.equal(r.reason, 'singularEntered'); assert.equal(r.message, 'singular form already entered');
  assert.equal(Scoring.breakdown(st2).aOnlyCount, 1, 'pair scores once');
  r = await checkCandidate(st2, 'apple', dictAll, pairFit, canonicalForm);
  assert.equal(r.reason, 'duplicate', 'exact repeat keeps the original message');
}
// Words on ban_list are refused with "Invalid entry" and are not sent for review.
{
  const st3 = Scoring.createState();
  const anyFit = async () => ({ fitA: true, fitB: true });
  const r = await checkCandidate(st3, 'Spamword', async () => true, anyFit, undefined, w => w === 'spamword');
  assert.equal(r.reason, 'banned'); assert.equal(r.message, 'Invalid entry'); assert.equal(r.accepted, false);
  assert.equal(Scoring.breakdown(st3).aOnlyCount, 0, 'banned word does not score');
}
// Endless: the pair with the most shared words wins; a category inside another (fruit inside food) is skipped.
{
  const set = (...w) => new Set(w);
  const curated = {
    food: set('apple', 'pear', 'plum', 'lime', 'bread', 'rice'),
    fruit: set('apple', 'pear', 'plum', 'lime'),   // fully inside food: that pair is skipped
    color: set('apple', 'lime', 'plum', 'red', 'blue'),   // shares 3 with food
    water: set('apple', 'lake', 'lime', 'plum', 'rain', 'river'), // shares 3 with food, more entries in total
    tiny: set('apple', 'pear'),                    // under 3 entries: never chosen
  };
  const best = Puzzles.bestPair(curated);
  assert.deepStrictEqual(best.slice().sort(), ['food', 'water'], 'most shared words, then most entries');
  assert.equal(Puzzles.bestPair({ a: set('x'), b: set('y') }), null, 'no viable pair gives null');
}
console.log('all game.test.js checks passed');
})().catch(e => { console.error(e); process.exit(1); });
