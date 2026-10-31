// Control logic shared by the control panel (admin.html) and the phone remote (phone.html).
// Each page has #login, #pw, #loginErr and #toast, and defines draw() which sets S (using adminGet()).
// Logging in swaps the password for a token (the database allows 3 wrong passwords per 15 minutes).
const $ = id => document.getElementById(id);
const btn = (label, act, data = {}, cls = 'small') => `<button class="${cls}" data-act="${act}" data-body='${esc(JSON.stringify(data))}'>${label}</button>`;
let S, token = '';
try { token = localStorage.getItem('cofToken') || ''; } catch {}
// Kept on the device only if the visitor allowed saving; otherwise the login lasts until the page is closed.
const saveToken = t => { token = t; try { t && canSave() ? localStorage.setItem('cofToken', t) : localStorage.removeItem('cofToken'); } catch {} };

async function adminGet() {
  try { return await rpc('cof_admin_get', { p_token: token }); }
  catch (e) { if (/log in/i.test(e.message)) { saveToken(''); document.body.classList.add('locked'); } throw e; }
}
async function logout() { await rpc('cof_logout', { p_token: token }).catch(() => {}); saveToken(''); location.reload(); }

function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => (t.style.display = 'none'), 3000); }

const notStarted = d => { if (d.matches.length) throw new Error('Bracket already started'); };
const actions = {
  settings: (d, b) => {
    if (typeof b.name === 'string') d.name = b.name.slice(0, 60);
    if (typeof b.rules === 'string') d.rules = b.rules.slice(0, 5000);
    if (typeof b.regOpen === 'boolean') d.regOpen = b.regOpen;
    if (typeof b.game === 'string') d.game = b.game.slice(0, 40);
    if (b.regMode === 'open' || b.regMode === 'at') d.regMode = b.regMode;
    if ('regAt' in b) d.regAt = b.regAt && !isNaN(new Date(b.regAt)) ? new Date(b.regAt).toISOString() : null;
    if ('eventAt' in b) d.eventAt = b.eventAt && !isNaN(new Date(b.eventAt)) ? new Date(b.eventAt).toISOString() : null;
  },
  end: d => { Object.assign(d, { status: 'none', regOpen: false, streamMatch: null, screen: 'scoreboard' }); },
  shuffle: d => { notStarted(d); d.order.sort(() => Math.random() - 0.5); },
  move: (d, b) => { // seeding: move player up/down
    notStarted(d);
    const i = d.order.indexOf(b.id), j = i + (b.dir < 0 ? -1 : 1);
    if (i >= 0 && j >= 0 && j < d.order.length) [d.order[i], d.order[j]] = [d.order[j], d.order[i]];
  },
  start: (d, b) => {
    notStarted(d);
    d.format = B.FORMATS[b.format] ? b.format : 'double';
    d.matches = B.build(d.order, d.format);
    Object.assign(d, { regOpen: false, screen: 'scoreboard', status: 'running' });
  },
  resetBracket: d => { Object.assign(d, { matches: [], streamMatch: null, screen: 'scoreboard', status: 'setup' }); },
  report: (d, b) => played(d, () => B.report(d.matches, b.id, b.slot)),
  reopen: (d, b) => B.reopen(d.matches, b.id),
  score: (d, b) => played(d, () => B.score(d.matches, b.id, b.side, b.kind, b.delta > 0 ? 1 : -1)),
  stream: (d, b) => { d.streamMatch = b.id || null; },
  result: (d, b) => played(d, () => { // quick final score for a match played off stream, e.g. 2–1
    const m = d.matches.find(x => x.id === b.id);
    if (!m || !B.isReady(m)) throw new Error('Match is not ready');
    const ga = Number(b.ga), gb = Number(b.gb);
    if (Math.max(ga, gb) !== B.FT_GAMES || Math.min(ga, gb) < 0 || Math.min(ga, gb) >= B.FT_GAMES) throw new Error('Bad score');
    Object.assign(m, { ga, gb, ra: 0, rb: 0 });
    B.report(d.matches, m.id, ga > gb ? 'a' : 'b');
  }),
  screen: (d, b) => { if (SCREENS[b.screen]) d.screen = b.screen; }, // what the OBS page shows
  startgg: (d, b) => { // start.gg link (startgg.js): settings, linked players, sets already reported
    if (b.off) { delete d.startgg; return; }
    const g = d.startgg ??= { entrants: {}, sent: {} };
    for (const k of ['slug', 'eventId', 'title', 'auto']) if (b.set && k in b.set) g[k] = b.set[k];
    Object.assign(g.entrants ??= {}, b.entrants);
    Object.assign(g.sent ??= {}, b.sent);
    for (const id of b.unsent ?? []) delete g.sent[id];
    if (b.seed && !d.matches.length) d.order = [...b.seed, ...d.order.filter(id => !b.seed.includes(id))];
  },
  deploy: (d, b) => { // Stream tab: put the previewed layout (and match) live on OBS
    if (SCREENS[b.screen]) d.screen = b.screen;
    if ('match' in b) d.streamMatch = b.match || null;
  },
};
// Settings for a brand-new tournament (the database clears players and results first).
function newTournament(b) {
  const at = b.regMode === 'at' && b.regAt && !isNaN(new Date(b.regAt)) ? new Date(b.regAt).toISOString() : null;
  if (b.regMode === 'at' && !at) throw new Error('Pick the date and time registration opens');
  const eventAt = b.eventAt && !isNaN(new Date(b.eventAt)) ? new Date(b.eventAt).toISOString() : null;
  return { status: 'setup', regOpen: true, regMode: at ? 'at' : 'open', regAt: at, eventAt,
    name: String(b.name || 'City of Fighters').slice(0, 60), game: String(b.game || 'Tekken 8').slice(0, 40),
    format: B.FORMATS[b.format] ? b.format : 'double', createdAt: new Date().toISOString(), ...(b.rules ? { rules: String(b.rules).slice(0, 5000) } : {}) };
}
const SCREENS = { scoreboard: 'Scoreboard', bracket: 'Bracket', standings: 'Standings', podium: 'Podium' };
// After a result: show the podium the moment the tournament is decided. The finished match stays on stream
// (the OBS page shows the winner, then "waiting") until the coordinator puts the next one on.
function played(d, fn) {
  const was = B.finished(d.matches);
  fn();
  if (!was && B.finished(d.matches)) Object.assign(d, { screen: 'podium', status: 'finished' });
  if (was && !B.finished(d.matches)) d.status = 'running';
}

// Undo steps back through this device's own last 20 actions (kept in memory, so the overlays
// don't have to download them). Removing a player and "Reset everything" can't be undone.
const undoStack = [];

// Clicks run one at a time, each on fresh data, so fast "+ round" presses are never lost.
let queue = Promise.resolve();
const post = (act, body = {}) => (queue = queue.then(async () => {
  let decided = false;
  try {
    if (act === 'removePlayer') await rpc('cof_admin_remove', { p_token: token, p_id: body.id });
    else if (act === 'create') await rpc('cof_admin_reset', { p_token: token, p_data: newTournament(body) });
    else {
      const d = (await adminGet()).data;
      if (act === 'undo') {
        if (!undoStack.length) throw new Error('Nothing to undo');
        const prev = undoStack.pop();
        if (d.startgg) prev.startgg = d.startgg; else delete prev.startgg; // the start.gg link isn't undone: it must see the undo to reset the set
        try { await rpc('cof_admin_save', { p_token: token, p_data: prev }); } catch (e) { undoStack.push(prev); throw e; }
      } else {
        const before = structuredClone(d);
        actions[act](d, body);
        await rpc('cof_admin_save', { p_token: token, p_data: d });
        if (act !== 'startgg') undoStack.push(before); // undo is for results, not for start.gg bookkeeping
        if (undoStack.length > 20) undoStack.shift();
        decided = !B.finished(before.matches) && B.finished(d.matches);
      }
    }
    await draw();
    if (decided) sendWinnerMail(); // the champion was just decided: email the winner banner (not awaited)
  } catch (e) { toast(e.message); }
}));

async function sendWinnerMail(force = false) {
  try { const sent = await mailWinner(force); toast(`🏆 Winner banner emailed to ${sent.join(' & ')}`); }
  catch (e) { toast('Winner email: ' + e.message); }
}

let polling = false;
const startPolling = () => { if (!polling) { polling = true; live(draw); } };

$('login').onsubmit = async e => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    const r = await rpc('cof_login', { p_pw: $('pw').value });
    if (!r.ok) return ($('loginErr').textContent = r.error);
    saveToken(r.token); $('pw').value = '';
    await draw(); startPolling();
  } catch (err) { $('loginErr').textContent = err.message; }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || (b.dataset.confirm && !confirm(b.dataset.confirm))) return;
  post(b.dataset.act, b.dataset.body ? JSON.parse(b.dataset.body) : {});
});

// Call at the end of the page script, after draw() exists.
const boot = () => { if (token) draw().then(startPolling, () => {}); };

// Installable as an app (see manifest.webmanifest and sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
