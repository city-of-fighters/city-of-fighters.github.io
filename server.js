// City of Fighters tournament server. Run: node server.js  (no npm install needed)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const B = require('./bracket');

const PORT = Number(process.env.PORT) || 3000;
const DATA = path.join(__dirname, 'data.json');
const PUB = path.join(__dirname, 'public');

const fresh = () => ({
  name: 'City of Fighters', game: 'Tekken 8', regOpen: true, streamMatch: null, players: [], matches: [],
  rules: [
    'Tekken 8, latest patch. Double elimination.',
    'Every match is first to 2 games. Every game is first to 3 rounds.',
    'Winner of a game must keep their character; loser may switch.',
    'Be on time: 10 minutes late to a called match is a loss.',
    'Pausing without a reason costs the round. Respect your opponent.',
  ].join('\n'),
});
let state = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : fresh();

const clients = new Set();
function save() {
  fs.writeFileSync(DATA + '.tmp', JSON.stringify(state, null, 1));
  fs.renameSync(DATA + '.tmp', DATA);
  for (const res of clients) res.write('data: update\n\n');
}

function view(admin) {
  const name = id => state.players.find(p => p.id === id)?.name ?? id;
  return {
    name: state.name, game: state.game, rules: state.rules, regOpen: state.regOpen, streamMatch: state.streamMatch,
    ftRounds: B.FT_ROUNDS, ftGames: B.FT_GAMES,
    players: state.players.map(p => admin ? p : { id: p.id, name: p.name }),
    matches: state.matches.map(m => ({ ...m, label: B.label(state.matches, m), ready: B.isReady(m),
      aName: m.a && name(m.a), bName: m.b && name(m.b) })),
    standings: B.standings(state.players, state.matches),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function register({ name, email, agree }) {
  name = String(name ?? '').trim(); email = String(email ?? '').trim().toLowerCase();
  if (!state.regOpen || state.matches.length) throw new Error('Registration is closed');
  if (name.length < 2 || name.length > 24) throw new Error('Gamer tag must be 2–24 characters');
  if (!EMAIL.test(email) || email.length > 120) throw new Error('Enter a valid email');
  if (agree !== true) throw new Error('You must accept the rules');
  if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('That gamer tag is taken');
  if (state.players.some(p => p.email === email)) throw new Error('That email is already registered');
  const p = { id: crypto.randomUUID().slice(0, 8), name, email, createdAt: new Date().toISOString() };
  state.players.push(p);
  // shortcut: no real email is sent yet (on-screen confirmation only); add SMTP/Resend here when wanted.
  console.log(`Registered ${name} <${email}>`);
  return { name: p.name, email: p.email, count: state.players.length };
}

// When the streamed match ends, put the winner's next match on stream (or any ready match).
function nextOnStream(id) {
  const m = state.matches.find(x => x.id === id);
  if (!m?.winner || state.streamMatch !== id) return;
  const ready = state.matches.filter(B.isReady);
  const next = ready.find(x => x.a === m.winner || x.b === m.winner) ?? ready[0];
  if (next) state.streamMatch = next.id;
}

const admin = {
  settings: b => {
    if (typeof b.name === 'string') state.name = b.name.slice(0, 60);
    if (typeof b.rules === 'string') state.rules = b.rules.slice(0, 5000);
    if (typeof b.regOpen === 'boolean') state.regOpen = b.regOpen;
  },
  removePlayer: b => {
    if (state.matches.length) throw new Error('Bracket already started');
    state.players = state.players.filter(p => p.id !== b.id);
  },
  shuffle: () => {
    if (state.matches.length) throw new Error('Bracket already started');
    state.players.sort(() => Math.random() - 0.5);
  },
  move: b => { // seeding: move player up/down
    if (state.matches.length) throw new Error('Bracket already started');
    const i = state.players.findIndex(p => p.id === b.id), j = i + (b.dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= state.players.length) return;
    [state.players[i], state.players[j]] = [state.players[j], state.players[i]];
  },
  start: () => {
    if (state.matches.length) throw new Error('Bracket already started');
    state.matches = B.build(state.players.map(p => p.id));
    state.regOpen = false;
  },
  resetBracket: () => { state.matches = []; state.streamMatch = null; },
  resetAll: () => { state = fresh(); },
  report: b => { B.report(state.matches, b.id, b.slot); nextOnStream(b.id); },
  reopen: b => B.reopen(state.matches, b.id),
  score: b => { B.score(state.matches, b.id, b.side, b.kind, b.delta > 0 ? 1 : -1); nextOnStream(b.id); },
  stream: b => { state.streamMatch = b.id || null; },
};

function readBody(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail(new Error('Bad JSON')); } });
  });
}

const PAGES = { '/': 'register.html', '/admin': 'admin.html', '/overlay': 'overlay.html', '/leaderboard': 'leaderboard.html' };
const send = (res, code, body, type = 'application/json') =>
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(type === 'application/json' ? JSON.stringify(body) : body);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && PAGES[url.pathname])
      return send(res, 200, fs.readFileSync(path.join(PUB, PAGES[url.pathname])), 'text/html; charset=utf-8');
    const asset = { '/style.css': 'text/css', '/logo.svg': 'image/svg+xml' }[url.pathname];
    if (req.method === 'GET' && asset) return send(res, 200, fs.readFileSync(path.join(PUB, url.pathname)), asset);
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, view(false));
    if (req.method === 'GET' && url.pathname === '/api/admin/state') return send(res, 200, view(true));
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }).write('retry: 2000\n\n');
      clients.add(res);
      return req.on('close', () => clients.delete(res));
    }
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const r = register(await readBody(req)); save(); return send(res, 200, r);
    }
    const act = url.pathname.match(/^\/api\/admin\/(\w+)$/)?.[1];
    if (req.method === 'POST' && act && Object.hasOwn(admin, act)) {
      admin[act](await readBody(req)); save(); return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  console.log(`City of Fighters running
  Control panel:  http://localhost:${PORT}/admin
  OBS scoreboard: http://localhost:${PORT}/overlay      (Browser Source 1920x1080)
  OBS standings:  http://localhost:${PORT}/leaderboard
  Player sign-up: http://${lan ?? 'localhost'}:${PORT}/   (same Wi-Fi)`);
});
