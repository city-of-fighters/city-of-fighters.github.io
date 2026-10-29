// Tournament logic: double or single elimination brackets, round robin and Swiss.
// Slots hold a player id, 'BYE', or null (not decided yet).
// Elimination matches have side 'W' / 'L' / 'GF'; round robin and Swiss matches have side 'R'.
const FT_ROUNDS = 3; // a game is first to 3 rounds
const FT_GAMES = 2;  // a match is first to 2 games
const POINTS_WIN = 3; // round robin / Swiss: points per match won (byes count as a win)
const FORMATS = { double: 'Double elimination', single: 'Single elimination', robin: 'Round robin (points)', swiss: 'Swiss (points)' };

function seedOrder(n) {
  let order = [1, 2];
  while (order.length < n) order = order.flatMap(s => [s, order.length * 2 + 1 - s]);
  return order;
}

function newMatch(id, side, round) {
  return { id, side, round, a: null, b: null, winner: null, loser: null,
           ga: 0, gb: 0, ra: 0, rb: 0, winTo: null, loseTo: null, auto: false, skipped: false };
}

function build(playerIds, format = 'double') {
  if (playerIds.length < 2) throw new Error('Need at least 2 players');
  if (!FORMATS[format]) throw new Error('Unknown tournament type');
  if (format === 'robin') return robin(playerIds);
  if (format === 'swiss') {
    const matches = [];
    swissRound(matches, playerIds, 1, Math.max(1, Math.ceil(Math.log2(playerIds.length))));
    return matches;
  }
  const double = format === 'double';
  let n = 4;
  while (n < playerIds.length) n *= 2;
  const k = Math.log2(n);
  const m = {};
  const add = (id, side, round) => (m[id] = newMatch(id, side, round));

  for (let r = 1; r <= k; r++)
    for (let i = 0; i < n / 2 ** r; i++) add(`W${r}-${i}`, 'W', r);
  if (double) {
    for (let j = 1; j <= k - 1; j++)
      for (const r of [2 * j - 1, 2 * j])
        for (let i = 0; i < n / 2 ** (j + 1); i++) add(`L${r}-${i}`, 'L', r);
    add('GF1', 'GF', 1);
    add('GF2', 'GF', 2);
  }

  for (let r = 1; r <= k; r++) {
    const cnt = n / 2 ** r;
    for (let i = 0; i < cnt; i++) {
      const x = m[`W${r}-${i}`];
      x.winTo = r < k ? { id: `W${r + 1}-${i >> 1}`, slot: i % 2 } : double ? { id: 'GF1', slot: 0 } : null;
      // later-round losers drop in reversed order to avoid instant rematches
      if (double) x.loseTo = r === 1 ? { id: `L1-${i >> 1}`, slot: i % 2 } : { id: `L${2 * (r - 1)}-${cnt - 1 - i}`, slot: 1 };
    }
  }
  const lastL = double ? 2 * (k - 1) : 0;
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

// Everyone plays everyone once (circle method). With an odd count one player sits out each round.
function robin(ids) {
  const p = ids.length % 2 ? [...ids, null] : [...ids];
  const n = p.length, matches = [];
  for (let r = 1; r < n; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = p[i], b = p[n - 1 - i];
      if (a && b) matches.push({ ...newMatch(`R${r}-${i}`, 'R', r), a, b, fmt: 'robin' });
    }
    p.splice(1, 0, p.pop()); // rotate everyone but the first player
  }
  return matches;
}

// Points table for round robin / Swiss: wins (byes included), games, and who already met whom.
function tally(ids, matches) {
  const t = new Map(ids.map(id => [id, { pts: 0, gw: 0, gl: 0, bye: false, met: new Set() }]));
  for (const m of matches) {
    if (m.a !== 'BYE' && m.b !== 'BYE' && t.has(m.a) && t.has(m.b)) { t.get(m.a).met.add(m.b); t.get(m.b).met.add(m.a); }
    if (m.a === 'BYE' || m.b === 'BYE') t.get(m.a === 'BYE' ? m.b : m.a).bye = true;
    if (!m.winner) continue;
    const w = t.get(m.winner), l = t.get(m.loser);
    const [wg, lg] = m.winner === m.a ? [m.ga, m.gb] : [m.gb, m.ga];
    if (w) { w.pts += POINTS_WIN; w.gw += wg; w.gl += lg; }
    if (l) { l.gw += lg; l.gl += wg; }
  }
  return t;
}

// Next Swiss round: players with similar points meet, avoiding rematches where possible.
function swissRound(matches, ids, round, total) {
  const t = tally(ids, matches);
  const order = [...ids].sort((x, y) => t.get(y).pts - t.get(x).pts || t.get(y).gw - t.get(x).gw || ids.indexOf(x) - ids.indexOf(y));
  const add = (a, b, i) => matches.push({ ...newMatch(`R${round}-${i}`, 'R', round), a, b, fmt: 'swiss', of: total });
  let i = 0;
  if (order.length % 2) { // lowest-ranked player without a bye yet gets one (counts as a win)
    const bye = [...order].reverse().find(id => !t.get(id).bye) ?? order.at(-1);
    order.splice(order.indexOf(bye), 1);
    add(bye, 'BYE', i++);
  }
  while (order.length) {
    const a = order.shift();
    const j = order.findIndex(b => !t.get(a).met.has(b));
    add(a, order.splice(j < 0 ? 0 : j, 1)[0], i++);
  }
  settle(matches);
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
  // Swiss: when a round is complete, pair the next one.
  if (m.fmt === 'swiss' && m.round < m.of && !matches.some(x => x.round === m.round && !x.winner)
      && !matches.some(x => x.round === m.round + 1)) {
    const ids = [...new Set(matches.filter(x => x.round === 1).flatMap(x => [x.a, x.b]))].filter(x => x !== 'BYE');
    swissRound(matches, ids, m.round + 1, m.of);
  }
}

// Undo a result. Fails if a later match that used it was already played (auto BYE wins are undone too).
function reopen(matches, id) {
  const m = byId(matches, id);
  if (!m || !m.winner || m.auto) throw new Error('Match has no result');
  if (m.fmt === 'swiss') { // later rounds were paired from this result: drop them if nobody played yet
    const later = matches.filter(x => x.round > m.round);
    if (later.some(x => x.winner && !x.auto)) throw new Error('Reopen the later rounds first');
    for (const x of later) matches.splice(matches.indexOf(x), 1);
  }
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

const isDouble = matches => matches.some(m => m.side === 'GF');
const isPoints = matches => matches.some(m => m.side === 'R');
const lastRound = (matches, side) => Math.max(...matches.filter(x => x.side === side).map(x => x.round));

function label(matches, m) {
  if (m.id === 'GF1') return 'Grand Final';
  if (m.id === 'GF2') return 'Grand Final Reset';
  if (m.side === 'R') return m.of ? `Round ${m.round} of ${m.of}` : `Round ${m.round}`;
  const last = lastRound(matches, m.side);
  if (!isDouble(matches)) return ['Final', 'Semifinal', 'Quarterfinal'][last - m.round] ?? `Round ${m.round}`;
  const name = m.side === 'W' ? 'Winners' : 'Losers';
  if (m.round === last) return `${name} Final`;
  if (m.round === last - 1) return `${name} Semis`;
  return `${name} Round ${m.round}`;
}

// The match whose winner is champion, once it is decided (elimination formats).
function championMatch(matches) {
  if (isDouble(matches)) return matches.find(m => m.winner && (m.id === 'GF2' || (m.id === 'GF1' && m.winner === m.a)));
  return matches.find(m => m.side === 'W' && m.round === lastRound(matches, 'W') && m.winner);
}

function finished(matches) {
  if (!matches.length) return false;
  if (!isPoints(matches)) return !!championMatch(matches);
  const swiss = matches.find(m => m.fmt === 'swiss');
  return matches.every(m => m.winner) && (!swiss || lastRound(matches, 'R') === swiss.of);
}

// Elimination: placing = 1 + number of players knocked out later (players still in have none yet).
// Round robin / Swiss: ranked live by points, then games won, then game difference.
function standings(players, matches) {
  const rows = new Map(players.map(p => [p.id, { id: p.id, name: p.name, w: 0, l: 0, gw: 0, gl: 0, pts: 0, out: null, place: null }]));
  const points = isPoints(matches), double = isDouble(matches);
  for (const m of matches.filter(m => m.winner && (!m.auto || points))) {
    const [W, L] = [rows.get(m.winner), rows.get(m.loser)];
    const [wg, lg] = m.winner === m.a ? [m.ga, m.gb] : [m.gb, m.ga];
    if (W) { W.w++; W.gw += wg; W.gl += lg; W.pts += POINTS_WIN; }
    if (L) {
      L.l++; L.gw += lg; L.gl += wg;
      if (m.side === 'L' || (m.side === 'W' && !double)) L.out = m.round;
      if (m.id === 'GF2' || (m.id === 'GF1' && m.winner === m.a)) L.out = 100;
    }
  }
  const list = [...rows.values()];
  if (points) {
    const better = (o, r) => o.pts > r.pts || (o.pts === r.pts && o.gw > r.gw);
    if (matches.length) for (const r of list) r.place = 1 + list.filter(o => better(o, r)).length;
    return list.sort((x, y) => y.pts - x.pts || y.gw - x.gw || (y.gw - y.gl) - (x.gw - x.gl));
  }
  const champ = championMatch(matches);
  if (champ && rows.get(champ.winner)) rows.get(champ.winner).out = 101;
  for (const r of list) r.place = r.out === null ? null : 1 + list.filter(o => o.out === null || o.out > r.out).length;
  return list.sort((x, y) => (x.place ?? 0) - (y.place ?? 0) || y.w - x.w || (y.gw - y.gl) - (x.gw - x.gl));
}

const B = { build, report, reopen, score, label, standings, finished, isReady, FT_ROUNDS, FT_GAMES, FORMATS };
if (typeof module === 'object') module.exports = B; // Node (tests); in the browser B is a global
