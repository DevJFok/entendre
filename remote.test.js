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
console.log('all remote tests passed');
