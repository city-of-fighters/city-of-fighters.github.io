// Supabase Edge Function "cof-winner-email": emails the tournament champion their winner banner from a Gmail account.
// Setup (once): Supabase → Edge Functions → Secrets: GMAIL_USER (the Gmail address) and GMAIL_APP_PASSWORD (a Google
// "App password", not the normal password). Deploy with "Verify JWT" turned off: this function checks the organizer's
// login token itself through the database (cof_winner_mail), and only it can read the champion's email.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const cors = {
  'Access-Control-Allow-Origin': '*', // the request needs an organizer token, so the origin doesn't matter
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { token, players, image, force, test } = await req.json();
    if (typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,') || image.length > 3_000_000) return json({ error: 'Bad banner image' }, 400);
    if (!test && (!Array.isArray(players) || !players.length || players.length > 8)) return json({ error: 'No champion given' }, 400);

    const user = Deno.env.get('GMAIL_USER'), pass = Deno.env.get('GMAIL_APP_PASSWORD');
    if (!user || !pass) return json({ error: 'Gmail is not set up (add GMAIL_USER and GMAIL_APP_PASSWORD in Supabase)' }, 500);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const mail = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
    const banner = image.slice(image.indexOf(',') + 1);

    // Control panel "Send test email": for logged-in organizers only, with a sample banner
    if (test) {
      if (typeof test !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(test) || test.length > 120) return json({ error: 'Enter a valid email address' }, 400);
      const { error } = await db.rpc('cof_admin_get', { p_token: token });
      if (error) return json({ error: error.message }, 400);
      await mail.sendMail({
        from: `City of Fighters <${user}>`, to: test, subject: '🏆 Test: the City of Fighters winner email works',
        text: 'This is a test of the City of Fighters winner email. The champion gets a banner like the attached one.\n',
        html: `<div style="font-family:Arial,sans-serif;background:#0c0714;color:#f4eefc;padding:24px;text-align:center">
          <h1 style="color:#ffd24a;margin:0 0 8px">Test email</h1><p style="font-size:18px">The champion gets a banner like this one.</p>
          <img src="cid:banner" alt="Winner banner" style="max-width:100%;border-radius:8px"></div>`,
        attachments: [{ filename: 'city-of-fighters-champion.jpg', content: banner, encoding: 'base64', cid: 'banner' }],
      });
      return json({ sent: [test] });
    }

    const { data, error } = await db.rpc('cof_winner_mail', { p_token: token, p_ids: players, p_force: !!force });
    if (error) return json({ error: error.message }, 400);

    const sent: string[] = [];
    for (const w of data.winners as { id: string; name: string; email: string }[]) {
      await mail.sendMail({
        from: `City of Fighters <${user}>`,
        to: w.email,
        subject: `🏆 You won ${data.tournament}!`,
        text: `Congratulations ${w.name}!\n\nYou are the champion of ${data.tournament} (${data.game}). Your winner banner is attached.\n\nSee you at the next City of Fighters!\n`,
        html: `<div style="font-family:Arial,sans-serif;background:#0c0714;color:#f4eefc;padding:24px;text-align:center">
          <h1 style="color:#ffd24a;margin:0 0 8px">Congratulations ${esc(w.name)}!</h1>
          <p style="font-size:18px">You are the champion of <b>${esc(data.tournament)}</b> (${esc(data.game)}).</p>
          <img src="cid:banner" alt="Winner banner" style="max-width:100%;border-radius:8px">
          <p style="color:#a99bbd">Share it, you earned it. See you at the next City of Fighters!</p></div>`,
        attachments: [{ filename: 'city-of-fighters-champion.jpg', content: banner, encoding: 'base64', cid: 'banner' }],
      });
      sent.push(w.name);
    }
    await db.rpc('cof_winner_mailed', { p_key: data.key, p_ids: players });
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
