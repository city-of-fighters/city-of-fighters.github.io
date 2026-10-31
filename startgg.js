// start.gg link: players come from the start.gg event, and every result decided here is reported to the same
// two players' set on start.gg (undoing a result here resets that set). Needs control.js (S, token, post, rpc).
// The start.gg API key lives in the database (admin-only); the link itself is kept in the tournament data as S.startgg:
// { slug, eventId, title, auto, entrants: {playerId: entrantId}, sent: {matchId: setId} }.
const SGG_API = 'https://api.start.gg/gql/alpha';
let sggKey = null, sggProblems = [], sggBusy = false;

async function sgg(query, variables, key = sggKey) {
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

// Connect: check the key and the event link, store the key, link players with the same gamer tag.
async function sggConnect(link, key) {
  const slug = sggSlug(link);
  if (!slug) throw new Error('Paste the start.gg link of the event (it contains /tournament/…/event/…)');
  const ev = (await sgg('query($slug: String) { event(slug: $slug) { id name tournament { name } } }', { slug }, key)).event;
  if (!ev) throw new Error('start.gg has no event at that link');
  await rpc('cof_admin_startgg_set', { p_token: token, p_key: key });
  sggKey = key;
  const entrants = sggLinkByName(await sggEntrants(ev.id));
  post('startgg', { set: { slug, eventId: String(ev.id), title: `${ev.tournament.name} · ${ev.name}`, auto: true }, entrants });
}
const sggTag = e => (e.participants?.[0]?.gamerTag ?? e.name ?? '').trim().slice(0, 24);
function sggLinkByName(list) { // {playerId: entrantId} for our players whose gamer tag matches
  const byTag = new Map(list.map(e => [sggTag(e).toLowerCase(), String(e.id)]));
  return Object.fromEntries(S.players.filter(p => byTag.has(p.name.toLowerCase())).map(p => [p.id, byTag.get(p.name.toLowerCase())]));
}

// Players from start.gg: adds everyone missing (gamer tag, sponsor prefix as team) and takes start.gg's seeding.
async function sggImport() {
  if (!await sggGetKey()) throw new Error('No start.gg API key saved: connect again');
  const list = (await sggEntrants(S.startgg.eventId)).sort((a, b) => (a.initialSeedNum ?? 1e9) - (b.initialSeedNum ?? 1e9));
  const have = new Map(S.players.map(p => [p.name.toLowerCase(), p.id])), entrants = {}, skipped = [];
  for (const e of list) {
    const tag = sggTag(e);
    let id = have.get(tag.toLowerCase());
    if (!id && !S.matches.length) {
      try { id = await rpc('cof_admin_player_save', { p_token: token, p_id: null, p_name: tag, p_team: (e.participants?.[0]?.prefix ?? '').trim().slice(0, 24) || null, p_email: null }); }
      catch (err) { skipped.push(`${tag} (${err.message})`); }
    }
    if (id) entrants[id] = String(e.id); else if (S.matches.length) skipped.push(`${tag} (the bracket has started)`);
  }
  const seeded = list.map(e => Object.keys(entrants).find(p => entrants[p] === String(e.id))).filter(Boolean);
  post('startgg', { entrants, ...(S.matches.length ? {} : { seed: seeded }) });
  return { added: Object.keys(entrants).length, skipped };
}

// Sends every decided result that start.gg doesn't have yet, and resets sets whose result was undone here.
async function sggSync(manual = false) {
  const st = S?.startgg;
  if (sggBusy || !st?.eventId || !(st.auto || manual)) return;
  const sent = st.sent ?? {}, ent = st.entrants ?? {};
  const todo = S.matches.filter(m => m.winner && m.a && m.b && m.a !== 'BYE' && m.b !== 'BYE' && !sent[m.id]);
  const undone = Object.keys(sent).filter(id => !S.matches.find(m => m.id === id)?.winner);
  if (!todo.length && !undone.length) { sggProblems = []; return; }
  sggBusy = true;
  const add = {}, remove = [], problems = [];
  try {
    await sggGetKey();
    if (!sggKey) throw new Error('No start.gg API key saved');
    const sets = todo.length ? await sggSets(st.eventId) : [];
    for (const m of todo) {
      const ea = ent[m.a], eb = ent[m.b], who = `${m.aName} vs ${m.bName}`;
      if (!ea || !eb) { problems.push(`${who}: link both players first (Get players from start.gg)`); continue; }
      const set = sets.find(x => { const ids = x.slots.map(s => String(s.entrant?.id)); return ids.includes(ea) && ids.includes(eb); });
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

// Control panel card (admin.html)
function sggDraw() {
  const card = document.getElementById('sggCard');
  if (!card) return;
  card.hidden = S.status === 'none';
  const st = S.startgg, on = !!st?.eventId;
  $('sggForm').hidden = on; $('sggOn').hidden = !on;
  if (!on) return ($('sggStatus').textContent = 'Not connected. Results stay on this site only.');
  const linked = S.players.filter(p => st.entrants?.[p.id]).length, sent = Object.keys(st.sent ?? {}).length;
  $('sggStatus').innerHTML = `✅ Connected to <a href="https://www.start.gg/${esc(st.slug)}" target="_blank" rel="noopener">${esc(st.title)}</a> · players linked: ${linked} of ${S.players.length} · results sent: ${sent}`;
  if (document.activeElement !== $('sggAuto')) $('sggAuto').checked = !!st.auto;
  $('sggProblems').innerHTML = sggProblems.map(p => `<li>${esc(p)}</li>`).join('');
}
if (document.getElementById('sggCard')) {
  $('sggForm').onsubmit = async e => {
    e.preventDefault();
    try { await sggConnect($('sggLink').value.trim(), $('sggKeyIn').value.trim()); $('sggKeyIn').value = ''; toast('Connected to start.gg'); }
    catch (err) { toast(err.message); }
  };
  $('sggImport').onclick = async () => {
    try { const r = await sggImport(); toast(`${r.added} players linked` + (r.skipped.length ? ` · skipped: ${r.skipped.join(', ')}` : '')); }
    catch (err) { toast(err.message); }
  };
  $('sggNow').onclick = () => sggSync(true);
  $('sggAuto').onchange = e => post('startgg', { set: { auto: e.target.checked } });
}

// One sender per computer (the control panel and the Stream tab may both be open); checks every 10 s.
setInterval(() => navigator.locks ? navigator.locks.request('cof-startgg', { ifAvailable: true }, l => l && sggSync()) : sggSync(), 10000);

