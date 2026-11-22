// Run: node words.test.js
require('./words.js'); require('./puzzles.js');
(async () => {
  let ok = 0, total = 0;
  const chk = async (name, exp, p) => { const a = await p; total++; if (a === exp) ok++; console.log((a === exp ? 'PASS ' : 'FAIL ') + name + ' expected ' + exp + ' actual ' + a); };
  for (const [w, e] of [['red',true],['orange',true],['blue',true],['teal',true],['lemon',false],['apple',false]]) await chk('Colors/' + w, e, Words.fits(w, 'color'));
  for (const [w, e] of [['apple',true],['bread',true],['orange',true],['cheese',true],['red',false],['stop',false]]) await chk('Foods/' + w, e, Words.fits(w, 'food'));
  await chk('dict zzqxv', false, Words.isDictionaryWord('zzqxv'));
  await chk('dict apple', true, Words.isDictionaryWord('apple'));
  await chk('dict apples', true, Words.isDictionaryWord('apples'));
  await chk('dict Apple (non-lowercase)', false, Words.isDictionaryWord('Apple'));
  await chk('Foods/apples', true, Words.fits('apples', 'food'));
  // extras
  for (const [w, t, e] of [['dog','animal',true],['robin','bird',true],['france','country',true],['guitar','musical instrument',true],['car','vehicle',true],['stop','color',false],['oak','tree',true],['rose','flower',true],['gold','metal',true],['ruby','gem',true]]) await chk(t + '/' + w, e, Words.fits(w, t));
  const d1 = JSON.stringify(Puzzles.dailyPuzzle('2026-11-22')), d2 = JSON.stringify(Puzzles.dailyPuzzle('2026-11-22'));
  total++; if (d1 === d2) ok++; console.log('deterministic', d1 === d2, d1);
  let allDistinct = true; for (let i = 1; i <= 365; i++) { const p = Puzzles.dailyPuzzle('2026-' + String(1 + (i % 12)).padStart(2,'0') + '-' + String(1 + (i % 28)).padStart(2,'0') + '#' + i); if (p.categoryA.term === p.categoryB.term) allDistinct = false; }
  total++; if (allDistinct) ok++; console.log('distinct categories', allDistinct, 'pool', Puzzles.pool.length);
  const missing = Puzzles.pool.filter(c => !Words.hasCategory(c.term)); console.log('pool terms missing data:', missing.length);
  console.log(ok + '/' + total + ' passed');
})();
