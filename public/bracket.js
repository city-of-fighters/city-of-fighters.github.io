// Double-elimination bracket. Slots hold a player id, 'BYE', or null (not decided yet).
const FT_ROUNDS = 3; // a game is first to 3 rounds
const FT_GAMES = 2;  // a match is first to 2 games

function seedOrder(n) {
  let order = [1, 2];
  while (order.length < n) order = order.flatMap(s => [s, order.length * 2 + 1 - s]);
  return order;
}

function newMatch(id, side, round) {
  return { id, side, round, a: null, b: null, winner: null, loser: null,
           ga: 0, gb: 0, ra: 0, rb: 0, winTo: null, loseTo: null, auto: false, skipped: false };
}

function build(playerIds) {
  if (playerIds.length < 2) throw new Error('Need at least 2 players');
  let n = 4;
  while (n < playerIds.length) n *= 2;
  const k = Math.log2(n);
  const m = {};
  const add = (id, side, round) => (m[id] = newMatch(id, side, round));

  for (let r = 1; r <= k; r++)
    for (let i = 0; i < n / 2 ** r; i++) add(`W${r}-${i}`, 'W', r);
  for (let j = 1; j <= k - 1; j++)
    for (const r of [2 * j - 1, 2 * j])
      for (let i = 0; i < n / 2 ** (j + 1); i++) add(`L${r}-${i}`, 'L', r);
  add('GF1', 'GF', 1);
  add('GF2', 'GF', 2);

  for (let r = 1; r <= k; r++) {
    const cnt = n / 2 ** r;
    for (let i = 0; i < cnt; i++) {
      const x = m[`W${r}-${i}`];
      x.winTo = r < k ? { id: `W${r + 1}-${i >> 1}`, slot: i % 2 } : { id: 'GF1', slot: 0 };
      // later-round losers drop in reversed order to avoid instant rematches
      x.loseTo = r === 1 ? { id: `L1-${i >> 1}`, slot: i % 2 } : { id: `L${2 * (r - 1)}-${cnt - 1 - i}`, slot: 1 };
    }
  }
  const lastL = 2 * (k - 1);
  for (let r = 1; r <= lastL; r++) {
    const j = Math.ceil(r / 2), cnt = n / 2 ** (j + 1);
    for (let i = 0; i < cnt; i++)
      m[`L${r}-${i}`].winTo = r === lastL ? { id: 'GF1', slot: 1 }
        : r % 2 ? { id: `L${r + 1}-${i}`, slot: 0 } : { id: `L${r + 1}-${i >> 1}`, slot: i % 2 };
  }

  seedOrder(n).forEach((seed, pos) => {
    m[`W1-${pos >> 1}`][pos % 2 ? 'b' : 'a'] = playerIds[seed - 1] ?? 'BYE';
  });
  const matches = Object.values(m);
  settle(matches);
  return matches;
}

const byId = (matches, id) => matches.find(x => x.id === id);
const put = (matches, to, val) => { if (to) byId(matches, to.id)[to.slot ? 'b' : 'a'] = val; };

function finish(matches, m, slot, auto = false) {
  m.winner = m[slot];
  m.loser = m[slot === 'a' ? 'b' : 'a'];
  m.auto = auto;
  put(matches, m.winTo, m.winner);
  put(matches, m.loseTo, m.loser);
  if (m.id === 'GF1') {
    const gf2 = byId(matches, 'GF2');
    if (slot === 'b') { gf2.a = m.a; gf2.b = m.b; } // losers-side player won: bracket reset
    else gf2.skipped = true;
  }
}

// Auto-advance anyone facing a BYE.
function settle(matches) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of matches) {
      if (m.winner || m.skipped || m.a === null || m.b === null) continue;
      if (m.a === 'BYE' || m.b === 'BYE') { finish(matches, m, m.a === 'BYE' ? 'b' : 'a', true); changed = true; }
    }
  }
}

const isReady = m => !m.winner && !m.skipped && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE';

function report(matches, id, slot) {
  const m = byId(matches, id);
  if (!m || !isReady(m)) throw new Error('Match is not ready');
  finish(matches, m, slot);
  settle(matches);
}

// Undo a result. Fails if a later match that used it was already played (auto BYE wins are undone too).
function reopen(matches, id) {
  const m = byId(matches, id);
  if (!m || !m.winner) throw new Error('Match has no result');
  const undo = x => {
    const dests = [x.winTo, x.loseTo].filter(Boolean).map(t => [t, byId(matches, t.id)]);
    for (const [, d] of dests) if (d.winner) { if (d.auto) undo(d); else throw new Error(`Reopen ${d.id} first`); }
    if (x.id === 'GF1') {
      const gf2 = byId(matches, 'GF2');
      if (gf2.winner) throw new Error('Reopen GF2 first');
      Object.assign(gf2, { a: null, b: null, skipped: false });
    }
    for (const [t] of dests) put(matches, t, null);
    Object.assign(x, { winner: null, loser: null, auto: false });
  };
  undo(m);
  if (m.ga >= FT_GAMES || m.gb >= FT_GAMES) Object.assign(m, { ga: 0, gb: 0, ra: 0, rb: 0 });
}

// kind 'round' or 'game', delta +1/-1. Hitting FT_ROUNDS wins a game, FT_GAMES wins the match.
function score(matches, id, side, kind, delta) {
  const m = byId(matches, id);
  if (!m || !isReady(m)) throw new Error('Match is not ready');
  if (!['a', 'b'].includes(side)) throw new Error('Bad side');
  const g = 'g' + side, r = 'r' + side;
  if (kind === 'round') m[r] = Math.max(0, m[r] + delta);
  else if (kind === 'game') m[g] = Math.max(0, m[g] + delta);
  else throw new Error('Bad kind');
  if (m[r] >= FT_ROUNDS) { m[g]++; m.ra = m.rb = 0; }
  if (m[g] >= FT_GAMES) report(matches, id, side);
}

function label(matches, m) {
  if (m.id === 'GF1') return 'Grand Final';
  if (m.id === 'GF2') return 'Grand Final Reset';
  const last = Math.max(...matches.filter(x => x.side === m.side).map(x => x.round));
  const name = m.side === 'W' ? 'Winners' : 'Losers';
  if (m.round === last) return `${name} Final`;
  if (m.round === last - 1) return `${name} Semis`;
  return `${name} Round ${m.round}`;
}

// Placing: 1 + number of players knocked out later. Players still in have no placing yet.
function standings(players, matches) {
  const rows = new Map(players.map(p => [p.id, { id: p.id, name: p.name, w: 0, l: 0, gw: 0, gl: 0, out: null }]));
  const done = matches.filter(m => m.winner && !m.auto);
  for (const m of done) {
    const [W, L] = [rows.get(m.winner), rows.get(m.loser)];
    const [wg, lg] = m.winner === m.a ? [m.ga, m.gb] : [m.gb, m.ga];
    if (W) { W.w++; W.gw += wg; W.gl += lg; }
    if (L) {
      L.l++; L.gw += lg; L.gl += wg;
      if (m.side === 'L') L.out = m.round;
      if (m.id === 'GF2' || (m.id === 'GF1' && m.winner === m.a)) L.out = 100;
    }
  }
  const champ = matches.find(m => m.winner && (m.id === 'GF2' || (m.id === 'GF1' && m.winner === m.a)));
  if (champ && rows.get(champ.winner)) rows.get(champ.winner).out = 101;
  const list = [...rows.values()];
  for (const r of list) r.place = r.out === null ? null : 1 + list.filter(o => o.out === null || o.out > r.out).length;
  return list.sort((x, y) => (x.place ?? 0) - (y.place ?? 0) || y.w - x.w || (y.gw - y.gl) - (x.gw - x.gl));
}

const B = { build, report, reopen, score, label, standings, isReady, FT_ROUNDS, FT_GAMES };
if (typeof module === 'object') module.exports = B; // Node (tests); in the browser B is a global
