// Run: node remote.test.js
const assert = require('assert');
const { parseCsv, buildLists, remote, curatedHas } = require('./remote.js');

const csv = [
  'category,word,type,status',
  '"water,talking",babble,dictionary,approved',
  'water,rain,dictionary,approved',
  'talking,talk,dictionary,approved',
  'water,oldword,dictionary,pending',
  ',,,',
].join('\n');
const block = 'word,note\n,Add one word per row.\nspamword,\n';

buildLists(parseCsv(csv), parseCsv(block));
assert.ok(remote.curated.water.has('babble'), 'multi-category word is in water');
assert.ok(remote.curated.talking.has('babble'), 'multi-category word is in talking');
assert.ok(remote.curated.water.has('rain') && !remote.curated.talking.has('rain'), 'single-category word stays single');
assert.ok(!remote.curated.water.has('oldword'), 'pending words are not loaded');
assert.ok(remote.approved.has('babble') && remote.approved.has('talk'));
assert.ok(remote.blocked.has('spamword') && !remote.blocked.has(''), 'blocklist loads, empty rows ignored');
assert.ok(curatedHas(remote.curated.talking, 'talks') && !curatedHas(remote.curated.talking, 'stop'));
// Singular and plural columns link each pair to one key.
const pairCsv = [
  'category,word,type,status,plural form,singular form',
  'food,apple,dictionary,approved,apples,',
  'food,apples,dictionary,approved,,apple',
  'food,box,dictionary,approved,boxes,',
  'food,boxes,dictionary,approved,,box',
  'food,bread,dictionary,approved,,',
].join('\n');
buildLists(parseCsv(pairCsv), parseCsv(block));
const { canonicalForm, parseArchive, isoDate } = require('./remote.js');
assert.equal(canonicalForm('apples'), 'apple');
assert.equal(canonicalForm('apple'), 'apple');
assert.equal(canonicalForm('boxes'), 'box');
assert.equal(canonicalForm('bread'), 'bread', 'word with no pair maps to itself');
assert.equal(canonicalForm('unknownword'), 'unknownword');
// Archive tab: dates as M/D/YYYY (as typed in the sheet) or YYYY-MM-DD; rows without both categories are skipped.
const archiveRows = parseCsv('date,category_a,category_b\n11/22/2026,color,food\nnot-a-date,x,y\n11/23/2026,water,talking\n11/24/2026,,\n2026-11-25,tree,fruit\n');
assert.deepStrictEqual(parseArchive(archiveRows), [
  { date: '2026-11-22', a: 'color', b: 'food' },
  { date: '2026-11-23', a: 'water', b: 'talking' },
  { date: '2026-11-25', a: 'tree', b: 'fruit' },
], 'M/D/YYYY and ISO dates both read; blanks and bad dates skipped');
assert.equal(isoDate('1/5/2026'), '2026-01-05');
console.log('all remote tests passed');
