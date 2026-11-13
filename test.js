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
// Custom match (open): no game limit, ends only on report, keeps its score through a reopen.
{
  const cm = [{ id: 'C1', side: 'W', round: 1, a: 'x', b: 'y', winner: null, loser: null, ga: 0, gb: 0, ra: 0, rb: 0, winTo: null, loseTo: null, auto: false, skipped: false, open: true, title: 'FT10' }];
  for (let i = 0; i < 10 * B.FT_ROUNDS; i++) B.score(cm, 'C1', 'a', 'round', 1);
  B.score(cm, 'C1', 'b', 'game', 1);
  assert.deepStrictEqual([cm[0].ga, cm[0].gb, cm[0].winner, B.finished(cm)], [10, 1, null, false]);
  assert.strictEqual(B.label(cm, cm[0]), 'FT10');
  B.report(cm, 'C1', 'a'); assert.strictEqual(B.finished(cm), true);
  B.reopen(cm, 'C1'); assert.deepStrictEqual([cm[0].ga, cm[0].winner], [10, null]);
}
const { pictureDarkShare } = require('./public/obs');
const rgba = (n, v) => new Uint8ClampedArray(n * 4).fill(v);
assert.strictEqual(pictureDarkShare(rgba(100, 18)), 1, 'a capture card\'s near-black counts as dark');
assert.strictEqual(pictureDarkShare(rgba(100, 200)), 0);
const logo = rgba(100, 0); logo.fill(255, 0, 8);
assert.strictEqual(pictureDarkShare(logo), 0.98, 'share of dark pixels');
// Same camera in two OBS sources: Keep puts the kept one in the other's place in every scene, then deletes the other.
(async () => {
  const { OBSRemote } = require('./public/obs');
  const scenes = { Main: [{ sourceName: 'Commentator Camera', sceneItemId: 1, sceneItemIndex: 0, sceneItemEnabled: false }, { sourceName: 'Brio_Playercam', sceneItemId: 2, sceneItemIndex: 1, sceneItemEnabled: true }],
    HUD: [{ sourceName: 'Brio_Playercam', sceneItemId: 1, sceneItemIndex: 0, sceneItemEnabled: true }] };
  const inputs = ['Commentator Camera', 'Brio_Playercam'], tf = {};
  const o = new OBSRemote();
  o.call = async (type, d) => {
    if (type === 'GetSceneList') return { scenes: Object.keys(scenes).map(sceneName => ({ sceneName })) };
    if (type === 'GetSceneItemList') return { sceneItems: scenes[d.sceneName].map(x => ({ ...x })) };
    if (type === 'GetSceneItemTransform') return { sceneItemTransform: { positionX: 20, cropLeft: 960, sourceWidth: 1920 } };
    if (type === 'CreateSceneItem') { const id = 100 + scenes[d.sceneName].length; scenes[d.sceneName].push({ sourceName: d.sourceName, sceneItemId: id, sceneItemIndex: scenes[d.sceneName].length, sceneItemEnabled: d.sceneItemEnabled }); return { sceneItemId: id }; }
    if (type === 'SetSceneItemTransform') { tf[d.sceneName] = d.sceneItemTransform; return {}; }
    if (type === 'SetSceneItemIndex') return {};
    if (type === 'SetSceneItemEnabled') { scenes[d.sceneName].find(x => x.sceneItemId === d.sceneItemId).sceneItemEnabled = d.sceneItemEnabled; return {}; }
    if (type === 'RemoveInput') { inputs.splice(inputs.indexOf(d.inputName), 1); for (const s of Object.values(scenes)) s.splice(0, s.length, ...s.filter(x => x.sourceName !== d.inputName)); return {}; }
    if (type === 'GetInputList') return { inputs: inputs.map(inputName => ({ inputName })) };
    throw new Error('unexpected ' + type);
  };
  await o.mergeCamera('Commentator Camera', 'Brio_Playercam');
  assert.deepStrictEqual(inputs, ['Commentator Camera']);
  assert.deepStrictEqual(scenes.Main.map(x => [x.sourceName, x.sceneItemEnabled]), [['Commentator Camera', true]], 'hidden in Main where the other showed: now shown in its place');
  assert.deepStrictEqual(tf.Main, { positionX: 20, cropLeft: 960 });
  assert.deepStrictEqual(scenes.HUD.map(x => [x.sourceName, x.sceneItemEnabled]), [['Commentator Camera', true]]);
  assert.deepStrictEqual(tf.HUD, { positionX: 20, cropLeft: 960 }, 'same place and crop, read-only fields left out');
  console.log('all bracket tests passed');
})().catch(e => { console.error(e); process.exit(1); });
