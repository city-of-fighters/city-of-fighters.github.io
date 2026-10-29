// Talks to the Supabase database (see supabase/city-of-fighters.sql). The publishable key is meant to be public;
// the tables are only reachable through functions, and admin ones need the control panel password.
const API = 'https://glqxyghdcindimggnwml.supabase.co/rest/v1/rpc/';
const KEY = 'sb_publishable_OatiT521MtUNk6gLQIa0yQ_67echjry';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function rpc(fn, body = {}) {
  const r = await fetch(API + fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(r.status === 404 ? 'The database is not set up yet (run supabase/city-of-fighters.sql).' : d?.message || `Server error ${r.status}`);
  return d;
}

// Same shape the pages used from the old local server: players in seeding order, labelled matches, standings.
function view({ data, players }) {
  const byId = new Map(players.map(p => [p.id, p]));
  const ordered = data.order.map(id => byId.get(id)).filter(Boolean);
  const name = id => byId.get(id)?.name ?? id;
  return {
    ...data, raw: data, ftRounds: B.FT_ROUNDS, ftGames: B.FT_GAMES, players: ordered,
    matches: data.matches.map(m => ({ ...m, label: B.label(data.matches, m), ready: B.isReady(m), aName: m.a && name(m.a), bName: m.b && name(m.b) })),
    standings: B.standings(ordered, data.matches), finished: B.finished(data.matches),
    format: data.format ?? 'double', screen: data.screen ?? 'scoreboard', // older saves have neither
  };
}

// Redraw every 1.5 s; skips a tick while a request is still running.
function live(draw) {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await draw(); } catch (e) { console.error(e); } busy = false; };
  tick();
  setInterval(tick, 1500);
}
