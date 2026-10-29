// Run: node test.js — plays random full tournaments and checks double-elimination rules.
const assert = require('assert');
const B = require('./bracket');

for (let n = 2; n <= 33; n++) for (let t = 0; t < 20; t++) {
  const ids = Array.from({ length: n }, (_, i) => 'p' + i);
  const ms = B.build(ids);
  let guard = 0, ready;
  while ((ready = ms.filter(B.isReady)).length) {
    const m = ready[0], side = Math.random() < 0.5 ? 'a' : 'b';
    if (Math.random() < 0.3) { // play it out round by round
      while (!m.winner) B.score(ms, m.id, Math.random() < 0.7 ? side : (side === 'a' ? 'b' : 'a'), 'round', 1);
      assert.strictEqual(m[side === 'a' ? 'ga' : 'gb'] >= 2 || m.winner !== m[side], true);
    } else B.report(ms, m.id, side);
    if (Math.random() < 0.2) { B.reopen(ms, m.id); B.report(ms, m.id, side); }
    assert(guard++ < 1000);
  }
  const s = B.standings(ids.map(id => ({ id, name: id })), ms);
  const losses = Object.fromEntries(s.map(r => [r.id, r.l]));
  assert.strictEqual(s[0].place, 1, `n=${n} has a champion`);
  assert.strictEqual(s[1].place, 2);
  assert(s.every(r => r.place !== null), 'everyone placed');
  assert(s.slice(1).every(r => losses[r.id] === 2), `n=${n} everyone but champ out on 2 losses`);
  assert(losses[s[0].id] <= 1);
}

// Reopen blocked once a later match was played.
const ms = B.build(['a', 'b', 'c', 'd']);
B.report(ms, 'W1-0', 'a'); B.report(ms, 'W1-1', 'a'); B.report(ms, 'W2-0', 'a');
assert.throws(() => B.reopen(ms, 'W1-0'));
console.log('all bracket tests passed');
