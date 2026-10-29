// Run: node test.js — plays random full tournaments and checks double-elimination rules.
const assert = require('assert');
const B = require('./public/bracket');

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

// Other formats: play random tournaments to the end and check each format's rules.
function playOut(ms, reopenSometimes) {
  let ready, guard = 0;
  while ((ready = ms.filter(B.isReady)).length) {
    const m = ready[Math.floor(Math.random() * ready.length)], side = Math.random() < 0.5 ? 'a' : 'b';
    B.report(ms, m.id, side);
    if (reopenSometimes && Math.random() < 0.15 && !ms.some(x => x.round > m.round && x.side === 'R')) { B.reopen(ms, m.id); B.report(ms, m.id, side); }
    assert(guard++ < 2000);
  }
}
for (let n = 2; n <= 20; n++) for (let t = 0; t < 10; t++) {
  const ids = Array.from({ length: n }, (_, i) => 'p' + i), players = ids.map(id => ({ id, name: id }));

  const se = B.build(ids, 'single'); playOut(se, true);
  assert(B.finished(se), `single n=${n} finished`);
  const ss = B.standings(players, se);
  assert.strictEqual(ss[0].place, 1); assert.strictEqual(ss[0].l, 0);
  assert(ss.slice(1).every(r => r.l === 1), `single n=${n}: everyone else out after 1 loss`);

  const rr = B.build(ids, 'robin');
  assert.strictEqual(rr.length, n * (n - 1) / 2, 'robin: every pair once');
  assert.strictEqual(new Set(rr.map(m => [m.a, m.b].sort().join())).size, rr.length);
  assert(!B.finished(rr)); playOut(rr);
  assert(B.finished(rr));
  const rs = B.standings(players, rr);
  assert(rs.every(r => r.w + r.l === n - 1) && rs[0].place === 1 && rs.reduce((a, r) => a + r.pts, 0) === rr.length * 3);

  const sw = B.build(ids, 'swiss'), of = sw[0].of; playOut(sw, true);
  assert(B.finished(sw), `swiss n=${n} finished`);
  for (let r = 1; r <= of; r++) {
    const inRound = sw.filter(m => m.round === r).flatMap(m => [m.a, m.b]).filter(x => x !== 'BYE');
    assert.strictEqual(inRound.length, n, `swiss n=${n} round ${r}: everyone plays (or has the bye) once`);
    assert.strictEqual(new Set(inRound).size, inRound.length);
  }
  assert.strictEqual(B.standings(players, sw).reduce((a, r) => a + r.w, 0), sw.length, 'swiss: one win per match (byes too)');
}
console.log('all bracket tests passed');
