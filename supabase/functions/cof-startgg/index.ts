// Supabase Edge Function "cof-startgg": "Log in with start.gg" and the app's Participate button.
// Setup (once): start.gg → Developer Settings → OAuth apps: create one with the redirect URL
// https://city-of-fighters.github.io/events.html. Supabase → Edge Functions → Secrets: SGG_CLIENT_ID and SGG_CLIENT_SECRET.
// Deploy with "Verify JWT" turned off: players have no Supabase login; this function checks their app session itself.
// The player's start.gg token is used once to read who they are, and is never stored.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://city-of-fighters.github.io';
const REDIRECT = `${SITE}/events.html`, SCOPE = 'user.identity';
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function sgg(key: string, query: string, variables = {}) {
  const r = await fetch('https://api.start.gg/gql/alpha', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.errors?.length) throw new Error(d.errors?.[0]?.message ?? d.message ?? `start.gg error ${r.status}`);
  return d.data;
}

// The tournament's one event to sign up for: its only event, or its only Tekken event.
function pickEvent(events: { id: number; videogame?: { displayName?: string } }[]) {
  const tekken = events.filter((e) => /tekken/i.test(e.videogame?.displayName ?? ''));
  const pick = events.length === 1 ? events : tekken;
  if (pick.length !== 1) throw new Error('Not sure which event to join');
  return String(pick[0].id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { action, code, session, event } = await req.json();
    const id = Deno.env.get('SGG_CLIENT_ID'), secret = Deno.env.get('SGG_CLIENT_SECRET');
    if (!id || !secret) return json({ error: 'Login with start.gg is not set up yet' }, 503);
    if (action === 'config') return json({ clientId: id, redirect: REDIRECT, scope: SCOPE });

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (action === 'login') {
      if (typeof code !== 'string' || !code) return json({ error: 'Missing login code' }, 400);
      const r = await fetch('https://api.start.gg/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: id, client_secret: secret, scope: SCOPE, redirect_uri: REDIRECT }) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) return json({ error: 'start.gg refused the login. Please try again.' }, 401);
      const me = (await sgg(t.access_token, 'query { currentUser { id player { gamerTag prefix } } }')).currentUser;
      if (!me?.id || !me.player?.gamerTag) return json({ error: 'That start.gg account has no gamer tag yet' }, 400);
      const { data, error } = await db.rpc('cof_account_login', { p_user: String(me.id), p_tag: me.player.gamerTag, p_prefix: me.player.prefix ?? null });
      if (error) return json({ error: error.message }, 400);
      return json({ session: data, name: me.player.gamerTag });
    }

    if (action === 'participate') {
      const { data: e, error } = await db.rpc('cof_participate_check', { p_session: session, p_event: event });
      if (error) return json({ error: error.message }, 400); // not logged in, or not a City of Fighters event
      const finish = { joined: false, url: `${e.link}/register` }; // start.gg's own page always works
      if (!e.key) return json(finish);
      try {
        const [tournament, session] = String(e.tournament).split(':'); // calendar entries are "tournament:event"
        const eventId = session ?? pickEvent((await sgg(e.key, 'query($id: ID!) { tournament(id: $id) { events { id videogame { displayName } } } }', { id: tournament })).tournament?.events ?? []);
        const registration = { eventIds: [eventId] };
        const { generateRegistrationToken: registrationToken } = await sgg(e.key,
          'mutation($r: TournamentRegistrationInput!, $u: ID!) { generateRegistrationToken(registration: $r, userId: $u) }', { r: registration, u: e.account });
        await sgg(e.key, 'mutation($r: TournamentRegistrationInput, $t: String) { registerForTournament(registration: $r, registrationToken: $t) { id } }', { r: registration, t: registrationToken });
      } catch (err) {
        console.log('Direct sign-up refused:', String((err as Error)?.message ?? err));
        return json(finish);
      }
      await db.rpc('cof_participate_mark', { p_account: e.account, p_event: event });
      return json({ joined: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
