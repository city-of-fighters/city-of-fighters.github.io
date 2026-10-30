// Talks to the Supabase database (see supabase/city-of-fighters.sql). The publishable key is meant to be public;
// the tables are only reachable through functions, and admin ones need the control panel password.
const API = 'https://glqxyghdcindimggnwml.supabase.co/rest/v1/rpc/';
const KEY = 'sb_publishable_OatiT521MtUNk6gLQIa0yQ_67echjry';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Device storage choice from the first-start screen (consent.js). The desktop app keeps its data on the user's own PC.
function consentChoice() {
  if (/Electron/.test(navigator.userAgent)) return 'all';
  try { return localStorage.getItem('cofConsent'); } catch { return 'none'; }
}
const canSave = () => consentChoice() === 'all';

async function rpc(fn, body = {}) {
  const r = await fetch(API + fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(r.status === 404 ? 'The database is not set up yet (run supabase/city-of-fighters.sql).' : d?.message || `Server error ${r.status}`);
  return d;
}

// Same shape the pages used from the old local server: players in seeding order, labelled matches, standings.
// Registration: 'none' (no tournament), 'soon' (opens at regAt), 'open' or 'closed'. Uses the database clock.
function regState(d, now) {
  const status = d.status ?? (d.matches.length ? 'running' : 'setup');
  if (status === 'none') return 'none';
  if (status !== 'setup' || d.matches.length || !d.regOpen) return 'closed';
  if (d.regMode === 'at' && d.regAt && new Date(now ?? Date.now()) < new Date(d.regAt)) return 'soon';
  return 'open';
}

function view({ data, players, now }) {
  const byId = new Map(players.map(p => [p.id, p]));
  const ordered = data.order.map(id => byId.get(id)).filter(Boolean);
  const name = id => byId.get(id)?.name ?? id;
  return {
    ...data, raw: data, ftRounds: B.FT_ROUNDS, ftGames: B.FT_GAMES, players: ordered,
    matches: data.matches.map(m => ({ ...m, label: B.label(data.matches, m), ready: B.isReady(m), aName: m.a && name(m.a), bName: m.b && name(m.b),
      aTeam: byId.get(m.a)?.team ?? null, bTeam: byId.get(m.b)?.team ?? null, aPlayer: byId.get(m.a) ?? null, bPlayer: byId.get(m.b) ?? null })),
    standings: B.standings(ordered, data.matches), finished: B.finished(data.matches),
    format: data.format ?? 'double', screen: data.screen ?? 'scoreboard', // older saves have neither
    status: data.status ?? (data.matches.length ? 'running' : 'setup'), regState: regState(data, now),
  };
}

// Player photos are optional. photoOf() returns the photo (a data URL) once it has loaded, else null and starts loading it;
// when it arrives, a 'cof-photo' event tells the page to draw again. Each photo version loads only once.
const photoCache = new Map();
function photoOf(p) {
  if (!p?.photo) return null;
  const k = p.id + ':' + p.photo;
  if (!photoCache.has(k)) {
    photoCache.set(k, null);
    rpc('cof_photo', { p_id: p.id }).then(d => { photoCache.set(k, d || null); dispatchEvent(new Event('cof-photo')); }, () => {});
  }
  return photoCache.get(k);
}
const photoImg = (p, cls = 'photo') => { const src = photoOf(p); return src ? `<img class="${cls}" src="${src}" alt="">` : ''; }; // nothing at all without a photo

// Redraw every 1.5 s; skips a tick while a request is still running.
function live(draw) {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await draw(); } catch (e) { console.error(e); } busy = false; };
  tick();
  setInterval(tick, 1500);
}
