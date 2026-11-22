// Run: node review-queue.test.js
const assert = require('assert');
const { createQueue, batches, isLoggable } = require('./review-queue.js');

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
function fakeFetch(log) {
  return (url, init) => { log.push({ url, body: JSON.parse(init.body), headers: init.headers }); return Promise.resolve({ ok: true }); };
}
// Distinct letters-only words: 'aa', 'ab', ... so every test word is loggable.
const uniq = i => { let n = i + 1, out = ''; while (n > 0) { out = String.fromCharCode(97 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); } return 'q' + out; };
const now = () => Date.UTC(2026, 10, 22, 12, 0, 0);
const blocked = new Set(['spamword']);
const base = (calls, storage) => ({
  endpoint: 'https://example.test/exec', batchSize: 50, dailyCap: 50,
  storage: storage || memoryStorage(), fetch: fakeFetch(calls), now, isBlocked: w => blocked.has(w)
});

assert.ok(isLoggable('lemon') && !isLoggable('a b') && !isLoggable('') && !isLoggable('x'.repeat(31)));
assert.deepStrictEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

(async () => {
  // Normalizes, skips blocked words, dedupes repeats within a puzzle.
  let calls = [];
  let q = createQueue(base(calls));
  assert.ok(q.add('  Zebra ', 'color,animal'), 'accepted');
  assert.ok(!q.add('zebra', 'color,animal'), 'repeat is deduped');
  assert.ok(q.add('zebra', 'food,fruit'), 'same word under other puzzle categories is kept');
  assert.ok(!q.add('spamword', 'color,animal'), 'blocklisted word is never logged');
  assert.ok(!q.add('ab3', 'color,animal'), 'non-letter input is not logged');
  assert.equal(q.pendingCount(), 2);

  // Sends in one request with the category pair, as plain text.
  await q.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepStrictEqual(calls[0].body.words, [{ word: 'zebra', categories: 'color,animal' }, { word: 'zebra', categories: 'food,fruit' }]);
  assert.equal(q.pendingCount(), 0);

  // Daily cap: 50 logged words per device per day, and the count survives a reload.
  calls = [];
  const storage = memoryStorage();
  q = createQueue(base(calls, storage));
  for (let i = 0; i < 50; i++) assert.ok(q.add(uniq(i), 'color,food'), 'word ' + i);
  // Batch of 50 sent as soon as the queue fills.
  await new Promise(r => setImmediate(r));
  assert.equal(calls.length, 1); assert.equal(calls[0].body.words.length, 50);
  assert.ok(!q.add('fresh', 'color,food'), 'cap reached for today');
  const q2 = createQueue(base(calls, storage));
  assert.ok(!q2.add('another', 'color,food'), 'cap holds after reload');

  // Batches of at most 50 per request.
  calls = [];
  q = createQueue(base(calls));
  for (let i = 0; i < 50; i++) q.add(uniq(i), 'color,food');
  await q.flush();
  assert.equal(calls.length, 1, 'no more than 50 per request');

  // Failed sends go back in the queue; nothing is sent without an endpoint.
  calls = [];
  const failing = Object.assign(base(calls), { fetch: () => Promise.reject(new Error('offline')) });
  q = createQueue(failing);
  q.add('lemon', 'color,food');
  await q.flush();
  assert.equal(q.pendingCount(), 1, 'failed word kept for the next flush');
  const offline = Object.assign(base(calls), { endpoint: '' });
  q = createQueue(offline);
  q.add('lemon', 'color,food');
  await q.flush();
  assert.equal(calls.length, 0, 'no endpoint configured: nothing sent');

  console.log('all review-queue tests passed');
})().catch(e => { console.error(e); process.exit(1); });
