// Player Profile stats for the season, worked out from its finished start.gg events (Joseph's rules, November 2026).
// events: [{ name, standings: [{ placement, tag }], sets: [{ a, b, ga, gb }] }] with gamer tags; a score of -1 is a DQ.
// The event's name says what it is: "Last Chance Qualifier"/"LCQ", "Main Event", otherwise a qualifier.
const SEASON_POINTS = [25, 15, 10, 7, 6, 5, 4, 3]; // qualifiers, 1st to 8th; +1 for the top 8 and +1 for taking part
const eventKind = name => (/last\s*chance|\blcq\b/i.test(name) ? 'lcq' : /\bmain\b/i.test(name) ? 'main' : 'qualifier');

function seasonStats(events) {
  const P = new Map();
  const get = tag => { const k = tag.toLowerCase(); if (!P.has(k)) P.set(k, { k, won: 0, played: 0, best: null, points: 0, qualBest: null, lcq: null, attended: 0, went: { qualifier: 0, lcq: 0, main: 0 }, beat: new Map() }); return P.get(k); };
  for (const e of events) {
    const kind = eventKind(e.name), present = new Set(); // attended: played at least one set that wasn't their DQ
    for (const s of e.sets) {
      if (!s.a || !s.b) continue;
      const A = get(s.a), Bp = get(s.b);
      if (s.ga >= 0) present.add(A.k);
      if (s.gb >= 0) present.add(Bp.k);
      if (s.ga < 0 || s.gb < 0) continue; // a DQ has no games
      A.won += s.ga; A.played += s.ga + s.gb; Bp.won += s.gb; Bp.played += s.ga + s.gb; // win rate counts games, not sets
      if (kind === 'qualifier' && s.ga !== s.gb) { const [w, l] = s.ga > s.gb ? [A, Bp] : [Bp, A]; w.beat.set(l.k, (w.beat.get(l.k) ?? 0) + 1); }
    }
    for (const { placement, tag } of e.standings) {
      if (!tag || !present.has(tag.toLowerCase())) continue;
      const p = get(tag);
      p.attended++; p.went[kind]++;
      p.best = Math.min(p.best ?? placement, placement);
      if (kind === 'qualifier') { p.points += (SEASON_POINTS[placement - 1] ?? 0) + (placement <= 8 ? 1 : 0) + 1; p.qualBest = Math.min(p.qualBest ?? placement, placement); }
      if (kind === 'lcq') p.lcq = placement;
    }
  }
  // Seeds 1–8: the qualifier points. Ties: head-to-head among the tied players, then their best qualifier placing
  // (a decider match, the last tie-breaker, is played on the day). Everyone else: their LCQ placing, 1st to 8th.
  const all = [...P.values()], h2h = (p, group) => group.reduce((n, o) => n + (p.beat.get(o.k) ?? 0), 0);
  const byPoints = all.filter(p => p.points > 0).sort((x, y) => y.points - x.points);
  const ranked = [];
  for (let i = 0; i < byPoints.length;) {
    const group = byPoints.filter(p => p.points === byPoints[i].points);
    ranked.push(...group.sort((x, y) => h2h(y, group) - h2h(x, group) || (x.qualBest ?? 99) - (y.qualBest ?? 99) || x.k.localeCompare(y.k)));
    i += group.length;
  }
  const seed = new Map(ranked.slice(0, 8).map((p, i) => [p.k, i + 1]));
  for (const p of all) if (!seed.has(p.k) && p.lcq && p.lcq <= 8) seed.set(p.k, p.lcq);
  return Object.fromEntries(all.filter(p => p.attended).map(p => [p.k, { games: [p.won, p.played], best: p.best, seed: seed.get(p.k) ?? null,
    points: p.points, att: [p.attended, events.length], went: p.went }]));
}
if (typeof module === 'object') module.exports = { seasonStats, eventKind }; // Node (tests)
