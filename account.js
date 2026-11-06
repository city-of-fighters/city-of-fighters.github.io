// "Log in with start.gg" for players (events.html, index.html). The server side is the cof-startgg Edge Function.
// The app session is kept on this device if the visitor allowed saving, otherwise until the tab is closed.
const ACCOUNT_URL = 'https://glqxyghdcindimggnwml.supabase.co/functions/v1/cof-startgg';
const acctStore = () => (canSave() ? localStorage : sessionStorage);
const acctSession = () => { try { return localStorage.getItem('cofSession') || sessionStorage.getItem('cofSession'); } catch { return null; } };
const acctForget = () => { try { localStorage.removeItem('cofSession'); sessionStorage.removeItem('cofSession'); } catch {} };

async function acctCall(body) {
  const r = await fetch(ACCOUNT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY }, body: JSON.stringify(body) })
    .catch(() => { throw new Error('Could not reach the login service'); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || d.message || `Login error ${r.status}`), { status: r.status });
  return d;
}
// null until the organizers have set up the login; then the app falls back to plain start.gg links
const acctConfig = () => acctCall({ action: 'config' }).catch(() => null);

async function acctLogin(cfg) {
  const state = crypto.randomUUID();
  sessionStorage.setItem('cofLoginState', state); // proves the answer from start.gg belongs to this login
  location.href = 'https://start.gg/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, scope: cfg.scope, redirect_uri: cfg.redirect, state });
}
// Back from start.gg with ?code=…: finish the login and clean the address bar.
async function acctFinishLogin() {
  const q = new URLSearchParams(location.search), code = q.get('code');
  if (!code && !q.has('error')) return;
  const expected = sessionStorage.getItem('cofLoginState');
  sessionStorage.removeItem('cofLoginState');
  history.replaceState(null, '', location.pathname);
  if (!code) throw new Error('Login with start.gg was cancelled');
  if (!expected || q.get('state') !== expected) throw new Error('That login link is not valid. Please try again.');
  const { session } = await acctCall({ action: 'login', code });
  acctStore().setItem('cofSession', session);
}
async function acctMe() {
  const s = acctSession();
  if (!s) return null;
  try { return await rpc('cof_me', { p_session: s }); }
  catch (e) { if (/log in/i.test(e.message)) acctForget(); return null; }
}
async function acctLogout() {
  await rpc('cof_account_logout', { p_session: acctSession() }).catch(() => {});
  acctForget();
}
