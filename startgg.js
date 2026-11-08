// start.gg link: players come from the start.gg event (they sign up there with their start.gg profile and are pulled in
// every few minutes), every result decided here is reported to the same two players' set on start.gg (undoing a result
// here resets that set), and the organizers' upcoming start.gg tournaments fill the Events calendar.
// Needs control.js (S, token, post, rpc).
// The start.gg API key lives in the database (admin-only); the link itself is kept in the tournament data as S.startgg:
// { slug, eventId, title, auto, entrants: {playerId: entrantId}, sent: {matchId: setId} }.
const SGG_API = 'https://api.start.gg/gql/alpha';
let sggKey = null, sggUser = null, sggProblems = [], sggBusy = false, sggLive = false;
// Test mode: off unless the database says results may be sent, so any failure to read the setting stays safe.
const sggIsLive = () => rpc('cof_admin_startgg_live', { p_token: token }).then(v => (sggLive = v === true), () => (sggLive = false));

async function sgg(query, variables, key = sggKey) {
  if (/^\s*mutation/.test(query) && !sggLive) throw new Error('Test mode is on: nothing was sent to start.gg');
  const r = await fetch(SGG_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ query, variables }) })
    .catch(() => { throw new Error('Could not reach start.gg'); });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || /authentication/i.test(d.message ?? '')) throw new Error('start.gg did not accept the API key');
  if (!r.ok || d.errors?.length) throw new Error('start.gg: ' + (d.errors?.[0]?.message ?? d.message ?? `error ${r.status}`));
  return d.data;
}
async function sggGetKey() { return (sggKey ??= await rpc('cof_admin_startgg_get', { p_token: token })); }

// "https://www.start.gg/tournament/cof-1/event/tekken-8/overview" → "tournament/cof-1/event/tekken-8"
const sggSlug = link => link.match(/tournament\/[^/\s?#]+\/event\/[^/\s?#]+/)?.[0] ?? null;

async function sggPages(field, query, eventId) { // every page of an event's entrants or sets
  const out = [];
  for (let page = 1, total = 1; page <= total && page <= 50; page++) {
    const conn = (await sgg(query, { id: eventId, page })).event?.[field];
    if (!conn) break;
    total = conn.pageInfo?.totalPages ?? 1;
    out.push(...conn.nodes);
  }
  return out;
}
const sggEntrants = id => sggPages('entrants', `query($id: ID!, $page: Int!) { event(id: $id) { entrants(query: { page: $page, perPage: 60 }) {
  pageInfo { totalPages } nodes { id name initialSeedNum participants { gamerTag prefix } } } } }`, id);
const sggSets = id => sggPages('sets', `query($id: ID!, $page: Int!) { event(id: $id) { sets(page: $page, perPage: 40, filters: { hideEmpty: true }) {
  pageInfo { totalPages } nodes { id state slots { entrant { id } } } } } }`, id);

// Saves a new API key after checking it with start.gg; returns whose account it belongs to.
async function sggSaveKey(key) {
  const u = (await sgg('query { currentUser { id player { gamerTag } } }', {}, key)).currentUser;
  if (!u) throw new Error('start.gg did not accept the API key');
  await rpc('cof_admin_startgg_set', { p_token: token, p_key: key });
  sggKey = key; sggUser = u.player?.gamerTag ?? 'your account';
  sggCalendar().catch(e => toast('Calendar: ' + e.message));
  return sggUser;
}
// Connect: the event link (and a new key, if one is pasted): store the key, link players with the same gamer tag.
async function sggConnect(link, key) {
  if (key) await sggSaveKey(key);
  if (!link) { if (!key) throw new Error('Paste the API key, the event link, or both'); return; }
  const slug = sggSlug(link);
  if (!slug) throw new Error('Paste the start.gg link of the event (it contains /tournament/…/event/…)');
  if (!await sggGetKey()) throw new Error('Paste the start.gg API key too');
  const ev = (await sgg('query($slug: String) { event(slug: $slug) { id name tournament { name } } }', { slug })).event;
  if (!ev) throw new Error('start.gg has no event at that link');
  const entrants = sggLinkByName(await sggEntrants(ev.id));
  return post('startgg', { set: { slug, eventId: String(ev.id), title: `${ev.tournament.name} · ${ev.name}`, auto: true }, entrants });
}
// A tag team has several participants: its name is the entrant's name, not one player's gamer tag.
const sggSolo = e => (e.participants?.length ?? 0) <= 1;
const sggTag = e => (sggSolo(e) ? e.participants?.[0]?.gamerTag ?? e.name ?? '' : e.name ?? '').trim().slice(0, 24);
function sggLinkByName(list) { // {playerId: entrantId} for our players whose gamer tag matches
  const byTag = new Map(list.map(e => [sggTag(e).toLowerCase(), String(e.id)]));
  return Object.fromEntries(S.players.filter(p => byTag.has(p.name.toLowerCase())).map(p => [p.id, byTag.get(p.name.toLowerCase())]));
}

// Players from start.gg: adds everyone missing (gamer tag, sponsor prefix as team) and takes start.gg's seeding.
// Runs by itself every 3 minutes until the bracket starts; saves nothing when nothing changed.
async function sggImport() {
  if (!await sggGetKey()) throw new Error('No start.gg API key saved: connect again');
  const list = (await sggEntrants(S.startgg.eventId)).sort((a, b) => (a.initialSeedNum ?? 1e9) - (b.initialSeedNum ?? 1e9));
  const have = new Map(S.players.map(p => [p.name.toLowerCase(), p.id])), entrants = {}, skipped = [];
  for (const e of list) {
    const tag = sggTag(e);
    let id = have.get(tag.toLowerCase());
    if (!id && !S.matches.length) {
      try { id = await rpc('cof_admin_player_save', { p_token: token, p_id: null, p_name: tag, p_team: sggSolo(e) ? (e.participants?.[0]?.prefix ?? '').trim().slice(0, 24) || null : null, p_email: null }); }
      catch (err) { skipped.push(`${tag} (${err.message})`); }
    }
    if (id) entrants[id] = String(e.id); else if (S.matches.length) skipped.push(`${tag} (the bracket has started)`);
  }
  const seeded = list.map(e => Object.keys(entrants).find(p => entrants[p] === String(e.id))).filter(Boolean);
  const same = Object.entries(entrants).every(([p, e]) => S.startgg.entrants?.[p] === e)
    && (S.matches.length || seeded.every((id, i) => S.raw.order[i] === id));
  if (!same) await post('startgg', { entrants, ...(S.matches.length ? {} : { seed: seeded }) });
  return { added: Object.keys(entrants).length, skipped };
}

const sggSetOf = (sets, ea, eb) => sets.find(x => { const ids = x.slots.map(s => String(s.entrant?.id)); return ids.includes(ea) && ids.includes(eb); });

// Put on stream here also puts the set on the stream on start.gg.
// shortcut: one try per match and the tournament's first stream, retry or a stream choice only if organizers need them.
let sggStreamed = null;
async function sggAssignStream() {
  const st = S?.startgg, m = S?.matches.find(x => x.id === S.streamMatch);
  if (sggBusy || !st?.eventId || !st.auto || !m || m.winner || sggStreamed === m.id || !await sggIsLive()) return;
  sggStreamed = m.id;
  try {
    await sggGetKey();
    const ea = st.entrants?.[m.a], eb = st.entrants?.[m.b];
    const set = ea && eb && sggSetOf(await sggSets(st.eventId), ea, eb);
    if (!set || String(set.id).startsWith('preview')) throw new Error('this match isn’t in the started bracket there');
    const stream = (await sgg('query($id: ID!) { event(id: $id) { tournament { streams { id } } } }', { id: st.eventId })).event?.tournament?.streams?.[0];
    if (!stream) throw new Error('add your Twitch channel to the tournament there first');
    await sgg('mutation($set: ID!, $stream: ID!) { assignStream(setId: $set, streamId: $stream) { id } }', { set: String(set.id), stream: String(stream.id) });
  } catch (e) { toast(`Not put on stream on start.gg: ${e.message}`); }
}

// Sends every decided result that start.gg doesn't have yet, and resets sets whose result was undone here.
async function sggSync(manual = false) {
  const st = S?.startgg;
  if (sggBusy || !st?.eventId || !(st.auto || manual)) return;
  const sent = st.sent ?? {}, ent = st.entrants ?? {};
  const todo = S.matches.filter(m => m.winner && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE' && !sent[m.id]);
  const undone = Object.keys(sent).filter(id => !S.matches.find(m => m.id === id)?.winner);
  if (!todo.length && !undone.length) { sggProblems = []; return; }
  if (!await sggIsLive()) { sggProblems = []; if (manual) toast('Test mode is on: nothing was sent to start.gg'); return; }
  sggBusy = true;
  const add = {}, remove = [], problems = [];
  try {
    await sggGetKey();
    if (!sggKey) throw new Error('No start.gg API key saved');
    const sets = todo.length ? await sggSets(st.eventId) : [];
    for (const m of todo) {
      const ea = ent[m.a], eb = ent[m.b], who = `${m.aName} vs ${m.bName}`;
      if (!ea || !eb) { problems.push(`${who}: link both players first (Get players from start.gg)`); continue; }
      const set = sggSetOf(sets, ea, eb);
      if (!set) { problems.push(`${who}: start.gg has no set between these two (its bracket differs), report it there by hand`); continue; }
      if (String(set.id).startsWith('preview')) { problems.push(`${who}: press Start on the bracket in start.gg first`); continue; }
      if (set.state !== 3) await sgg(`mutation($set: ID!, $w: ID!, $games: [BracketSetGameDataInput]) { reportBracketSet(setId: $set, winnerId: $w, gameData: $games) { id } }`,
        { set: String(set.id), w: ent[m.winner], games: sggGames(m, ent) });
      add[m.id] = String(set.id);
    }
    for (const id of undone) {
      await sgg('mutation($set: ID!) { resetSet(setId: $set, resetDependentSets: true) { id } }', { set: sent[id] }).catch(e => problems.push(`Undo on start.gg: ${e.message}`));
      remove.push(id);
    }
  } catch (e) { problems.push(e.message); }
  sggBusy = false;
  sggProblems = problems;
  if (Object.keys(add).length || remove.length) post('startgg', { sent: add, unsent: remove });
  else if (manual) toast(problems[0] ?? 'start.gg is up to date');
}
// Game by game for start.gg: the loser's wins first, so the last game is the winner's.
function sggGames(m, ent) {
  const [wg, lg] = m.winner === m.a ? [m.ga, m.gb] : [m.gb, m.ga];
  const loser = m.winner === m.a ? m.b : m.a;
  const games = [...Array(lg || 0).fill(ent[loser]), ...Array(wg || 0).fill(ent[m.winner])].map((w, i) => ({ gameNum: i + 1, winnerId: w }));
  return games.length ? games : null; // a result without a game score: just the winner
}

// Events calendar: every upcoming session of the tournaments City of Fighters hosts on start.gg, never ones the account
// only plays in: those the key's account created (start.gg's "tournaments by owner") plus those where it is an admin.
// A tournament can run for weeks with one event per session, so each event gets its own calendar entry and date.
const SGG_T = 'id name slug startAt endAt city isOnline events { id slug name startAt videogame { displayName } }';
async function sggCalendar() {
  if (!await sggGetKey()) return null;
  const me = (await sgg('query { currentUser { id } }')).currentUser;
  if (!me) throw new Error('start.gg did not accept the API key');
  const owned = [];
  for (let page = 1, total = 1; page <= total && page <= 12; page++) { // small pages: start.gg limits how much one request returns
    const c = (await sgg(`query($id: ID!, $page: Int!) { tournaments(query: { page: $page, perPage: 25, filter: { ownerId: $id } }) { pageInfo { totalPages } nodes { ${SGG_T} } } }`, { id: me.id, page })).tournaments;
    total = c?.pageInfo?.totalPages ?? 1;
    owned.push(...(c?.nodes ?? []));
  }
  const admin = await sgg(`query { currentUser { tournaments(query: { perPage: 25, filter: { upcoming: true, tournamentView: "admin" } }) { nodes { ${SGG_T} } } } }`)
    .then(d => d.currentUser?.tournaments?.nodes ?? [], () => []); // if start.gg rejects this lookup, the created ones still show
  const list = sggEvents = sggCalendarEntries([...owned, ...admin], Date.now() / 1000);
  return rpc('cof_admin_events_sync', { p_token: token, p_events: list });
}
function sggCalendarEntries(tournaments, now) {
  const seen = new Set(), out = [];
  for (const t of tournaments) {
    if (!t.slug || seen.has(t.id)) continue;
    seen.add(t.id);
    const events = t.events?.length ? t.events : [{}]; // a tournament without events yet still gets one entry
    for (const e of events) {
      const at = e.startAt ?? t.startAt;
      if (!(at > now - 86400)) continue; // today's sessions stay until tomorrow
      out.push({ id: e.id ? `${t.id}:${e.id}` : String(t.id), eventId: e.id ? String(e.id) : null, slug: e.slug ?? null, name: `${t.name}${events.length > 1 && e.name ? ` · ${e.name}` : ''}`.slice(0, 80), at,
        link: 'https://www.start.gg/' + t.slug, game: e.videogame?.displayName ?? null, place: t.isOnline ? 'Online' : t.city ?? null });
    }
  }
  return out.sort((x, y) => x.at - y.at).slice(0, 100);
}

// Control panel: an event on start.gg gets a Start button on its day. One click makes the tournament, links it, brings
// in everyone signed up and builds the bracket with start.gg's bracket type. Only reads from start.gg.
const SGG_FORMAT = { DOUBLE_ELIMINATION: 'double', SINGLE_ELIMINATION: 'single', ROUND_ROBIN: 'robin', SWISS: 'swiss' };
let sggEvents = [], sggEventsAt = 0, sggStarting = false, sggTodayShown = '';
function sggTodayDraw() {
  const box = document.getElementById('sggToday');
  if (!box) return;
  if (Date.now() - sggEventsAt > 300000) { sggEventsAt = Date.now(); sggCalendar().catch(() => {}); } // new start.gg events show within 5 minutes
  const day = new Date().toDateString(), due = e => e.at * 1000 <= Date.now() || new Date(e.at * 1000).toDateString() === day;
  const open = sggEvents.filter(e => e.eventId && !(S.startgg?.eventId === e.eventId && S.status !== 'setup')); // already started here
  const when = e => new Date(e.at * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const next = open.find(e => !due(e));
  const html = open.filter(due).map(e => `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span>📅 <b>${esc(e.name)}</b> <span class="dim">${esc(when(e))}</span></span>
      ${S.status === 'running' ? '<span class="dim">Finish or end the current tournament first</span>' : `<button class="primary" type="button" data-sgg-start="${esc(e.id)}">Start tournament</button>`}</div>`).join('')
    + (next ? `<p class="dim" style="margin:0 0 10px">Next on start.gg: <b>${esc(next.name)}</b> · ${esc(when(next))}. Its Start button appears here on the day.</p>` : '');
  if (html !== sggTodayShown) box.innerHTML = sggTodayShown = html; // this page redraws every 1.5 s
}
document.addEventListener('click', e => {
  const ev = sggEvents.find(x => x.id === e.target.closest('[data-sgg-start]')?.dataset.sggStart);
  if (ev) sggStartEvent(ev);
});
async function sggStartEvent(e) {
  if (sggStarting) return;
  sggStarting = true;
  try {
    const [list, info] = await Promise.all([sggEntrants(e.eventId), sgg('query($id: ID!) { event(id: $id) { phases { bracketType } } }', { id: e.eventId })]);
    if (list.length < 2) return toast(`${list.length} signed up on start.gg so far: at least 2 are needed`);
    const format = SGG_FORMAT[info.event?.phases?.[0]?.bracketType] ?? 'double', linked = S.startgg?.eventId === e.eventId;
    const lost = !linked && S.players.length && !S.finished ? `\n\nThe ${S.players.length} players and results of "${S.name}" are removed.` : '';
    if (!confirm(`Start "${e.name}"?\n\n${list.length} players from start.gg · ${B.FORMATS[format]}\nRegistration closes.${lost}`)) return;
    if (!linked) {
      await post('create', { name: e.name, game: e.game || 'Tekken 8', format, rules: S.rules, regMode: 'open', eventAt: new Date(e.at * 1000).toISOString() });
      if (S.status !== 'setup' || S.matches.length || S.startgg) return; // post() has already shown what went wrong
      await sggConnect(e.slug);
    }
    const { skipped } = await sggImport();
    await post('start', { format });
    if (skipped.length) toast(`Skipped: ${skipped.join(', ')}`);
  } catch (err) { toast(err.message); } finally { sggStarting = false; }
}

// Control panel card (admin.html)
let sggKeyChecked = false, sggModeShown = false;
function sggDraw() {
  const card = document.getElementById('sggCard');
  if (!card) return;
  if (!sggKeyChecked) { sggKeyChecked = true; sggGetKey().then(sggDraw, () => {}); } // is a key saved already?
  card.hidden = false;
  if (!sggModeShown) { // once, and again after the switch changes: this page redraws every 1.5 s
    sggModeShown = true;
    sggIsLive().then(() => { $('sggTest').checked = !sggLive; $('sggMode').textContent = sggLive ? '🟢 Live: results are sent to start.gg.' : '🧪 Test mode: nothing is sent to start.gg.'; });
  }
  const st = S.startgg, on = !!st?.eventId;
  $('sggForm').hidden = on; $('sggOn').hidden = !on;
  $('sggKeyIn').placeholder = sggKey ? `Saved ✓ (${sggUser ?? 'start.gg account'}). Paste a new one only to replace it` : 'Paste the token from Developer Settings';
  if (!on) return ($('sggStatus').textContent = sggKey ? 'API key saved: the Events calendar fills from start.gg. No tournament linked yet, so results stay on this site.'
    : 'Not connected. Results stay on this site only.');
  const linked = S.players.filter(p => st.entrants?.[p.id]).length, sent = Object.keys(st.sent ?? {}).length;
  $('sggStatus').innerHTML = `✅ Connected to <a href="https://www.start.gg/${esc(st.slug)}" target="_blank" rel="noopener">${esc(st.title)}</a> · players linked: ${linked} of ${S.players.length} · results sent: ${sent}`;
  if (document.activeElement !== $('sggAuto')) $('sggAuto').checked = !!st.auto;
  $('sggProblems').innerHTML = sggProblems.map(p => `<li>${esc(p)}</li>`).join('');
}
if (document.getElementById('sggCard')) {
  $('sggForm').onsubmit = async e => {
    e.preventDefault();
    try { await sggConnect($('sggLink').value.trim(), $('sggKeyIn').value.trim()); $('sggKeyIn').value = ''; toast('Saved'); sggDraw(); }
    catch (err) { toast(err.message); }
  };
  $('sggImport').onclick = async () => {
    try { const r = await sggImport(); toast(`${r.added} players linked` + (r.skipped.length ? ` · skipped: ${r.skipped.join(', ')}` : '')); }
    catch (err) { toast(err.message); }
  };
  $('sggNow').onclick = () => sggSync(true);
  $('sggAuto').onchange = e => post('startgg', { set: { auto: e.target.checked } });
  $('sggTest').onchange = async e => {
    const test = e.target.checked;
    if (!test && !confirm('Turn off test mode? From now on, results and sign-ups are sent to the real start.gg.')) return (e.target.checked = true);
    try { await rpc('cof_admin_startgg_live_set', { p_token: token, p_on: !test }); toast(test ? 'Test mode on' : 'Live: results go to start.gg'); }
    catch (err) { e.target.checked = true; toast(/not set up/.test(err.message) ? 'Run the updated database file in Supabase first.' : err.message); }
    sggModeShown = false; sggDraw();
  };
}

// One computer tab does the work (the control panel and the Stream tab may both be open): results every 10 s,
// new start.gg sign-ups every 3 minutes until the bracket starts, the calendar every 30 minutes.
let sggTicks = 0;
async function sggTick() {
  const t = sggTicks++;
  if (!S || !token) return;
  await sggSync();
  await sggAssignStream();
  if (t % 18 === 0 && S.startgg?.eventId && !S.matches.length && S.status !== 'none' && !sggStarting) await sggImport().catch(e => (sggProblems = [`Getting players: ${e.message}`]));
  if (t % 180 === 1) await sggCalendar().catch(() => {});
}
setInterval(() => navigator.locks ? navigator.locks.request('cof-startgg', { ifAvailable: true }, l => l && sggTick()) : sggTick(), 10000);

