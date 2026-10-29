// Control logic shared by the control panel (admin.html) and the phone remote (phone.html).
// Each page has #login, #pw, #loginErr and #toast, and defines draw() which sets S.
const $ = id => document.getElementById(id);
const btn = (label, act, data = {}, cls = 'small') => `<button class="${cls}" data-act="${act}" data-body='${esc(JSON.stringify(data))}'>${label}</button>`;
let S, pw = '';
try { pw = sessionStorage.getItem('cofPw') || ''; } catch {}

function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => (t.style.display = 'none'), 3000); }

const notStarted = d => { if (d.matches.length) throw new Error('Bracket already started'); };
// When the streamed match ends, put the winner's next match on stream (or any ready match).
function nextOnStream(d, id) {
  const m = d.matches.find(x => x.id === id);
  if (!m?.winner || d.streamMatch !== id) return;
  const ready = d.matches.filter(B.isReady);
  const next = ready.find(x => x.a === m.winner || x.b === m.winner) ?? ready[0];
  if (next) d.streamMatch = next.id;
}
const actions = {
  settings: (d, b) => {
    if (typeof b.name === 'string') d.name = b.name.slice(0, 60);
    if (typeof b.rules === 'string') d.rules = b.rules.slice(0, 5000);
    if (typeof b.regOpen === 'boolean') d.regOpen = b.regOpen;
  },
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
    Object.assign(d, { regOpen: false, screen: 'scoreboard' });
  },
  resetBracket: d => { Object.assign(d, { matches: [], streamMatch: null, screen: 'scoreboard' }); },
  report: (d, b) => played(d, () => B.report(d.matches, b.id, b.slot), b.id),
  reopen: (d, b) => B.reopen(d.matches, b.id),
  score: (d, b) => played(d, () => B.score(d.matches, b.id, b.side, b.kind, b.delta > 0 ? 1 : -1), b.id),
  stream: (d, b) => { d.streamMatch = b.id || null; },
  screen: (d, b) => { if (SCREENS[b.screen]) d.screen = b.screen; }, // what the OBS page shows
  deploy: (d, b) => { // Stream tab: put the previewed layout (and match) live on OBS
    if (SCREENS[b.screen]) d.screen = b.screen;
    if ('match' in b) d.streamMatch = b.match || null;
  },
};
const SCREENS = { scoreboard: 'Scoreboard', bracket: 'Bracket', standings: 'Standings', podium: 'Podium' };
// After a result: move the stream on, and show the podium the moment the tournament is decided.
function played(d, fn, id) {
  const was = B.finished(d.matches);
  fn();
  nextOnStream(d, id);
  if (!was && B.finished(d.matches)) d.screen = 'podium';
}

// Undo steps back through this device's own last 20 actions (kept in memory, so the overlays
// don't have to download them). Removing a player and "Reset everything" can't be undone.
const undoStack = [];

// Clicks run one at a time, each on fresh data, so fast "+ round" presses are never lost.
let queue = Promise.resolve();
const post = (act, body = {}) => (queue = queue.then(async () => {
  try {
    if (act === 'removePlayer') await rpc('cof_admin_remove', { p_pw: pw, p_id: body.id });
    else if (act === 'resetAll') await rpc('cof_admin_reset', { p_pw: pw });
    else {
      const d = (await rpc('cof_admin_get', { p_pw: pw })).data;
      if (act === 'undo') {
        if (!undoStack.length) throw new Error('Nothing to undo');
        const prev = undoStack.pop();
        try { await rpc('cof_admin_save', { p_pw: pw, p_data: prev }); } catch (e) { undoStack.push(prev); throw e; }
      } else {
        const before = structuredClone(d);
        actions[act](d, body);
        await rpc('cof_admin_save', { p_pw: pw, p_data: d });
        undoStack.push(before);
        if (undoStack.length > 20) undoStack.shift();
      }
    }
    await draw();
  } catch (e) { toast(e.message); }
}));

let polling = false;
const startPolling = () => { if (!polling) { polling = true; live(draw); } };

$('login').onsubmit = async e => {
  e.preventDefault();
  pw = $('pw').value;
  try { await draw(); try { sessionStorage.setItem('cofPw', pw); } catch {} startPolling(); }
  catch (err) { $('loginErr').textContent = err.message; }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || (b.dataset.confirm && !confirm(b.dataset.confirm))) return;
  post(b.dataset.act, b.dataset.body ? JSON.parse(b.dataset.body) : {});
});

// Call at the end of the page script, after draw() exists.
const boot = () => { if (pw) draw().then(startPolling, () => {}); };
