-- City of Fighters database. Paste the whole file into Supabase → SQL Editor and press Run.
-- Safe to run again after updates: it keeps your players, tournament and password.
-- Tables are locked; the website only uses the functions below. Admin functions need a login token, which
-- only cof_login hands out for the right password (3 wrong tries per 15 minutes, then locked).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cof_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 24),
  email text not null check (char_length(email) between 3 and 120),
  created_at timestamptz not null default now()
);
alter table public.cof_players add column if not exists team text check (char_length(team) <= 24); -- optional, shown on the stream HUD
alter table public.cof_players alter column email drop not null; -- players added by an organizer may have no email
-- Optional player photos (small JPEG data URLs made in the browser), kept apart so the live data stays small.
create table if not exists public.cof_photos (player uuid primary key references public.cof_players(id) on delete cascade,
  data text not null check (char_length(data) <= 400000), updated_at timestamptz not null default now());
alter table public.cof_photos enable row level security;
revoke all on public.cof_photos from anon, authenticated;
create unique index if not exists cof_players_name on public.cof_players (lower(name));
create unique index if not exists cof_players_email on public.cof_players (lower(email));

-- One row: tournament settings, seeding order and the whole bracket as JSON.
create table if not exists public.cof_state (id int primary key check (id = 1), data jsonb not null);
create table if not exists public.cof_admin (id int primary key check (id = 1), pass_hash text not null);
create table if not exists public.cof_attempts (ip text not null, at timestamptz not null default now()); -- wrong passwords
create index if not exists cof_attempts_ip on public.cof_attempts (ip, at);
create table if not exists public.cof_sessions (token_hash text primary key, expires timestamptz not null); -- logged-in devices
-- Events calendar (app → Events tab): typed in by organizers, or copied from the organizers' start.gg tournaments (sgg_id set).
create table if not exists public.cof_events (id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80), starts_at timestamptz not null,
  link text check (link ~ '^https://[^\s"<>]+$' and char_length(link) <= 300), game text check (char_length(game) <= 40),
  place text check (char_length(place) <= 80), sgg_id text unique);
alter table public.cof_events enable row level security;
revoke all on public.cof_events from anon, authenticated;
-- Player logins ("Log in with start.gg"): who logged in, their sessions, and which calendar events they joined.
-- Only the player's own session (cof_me) and the cof-startgg Edge Function reach these. No start.gg passwords or tokens are kept.
create table if not exists public.cof_accounts (sgg_user text primary key, gamer_tag text not null check (char_length(gamer_tag) <= 60),
  prefix text check (char_length(prefix) <= 60), created_at timestamptz not null default now());
create table if not exists public.cof_account_sessions (token_hash text primary key,
  account text not null references public.cof_accounts(sgg_user) on delete cascade, expires timestamptz not null);
create table if not exists public.cof_participants (event uuid not null references public.cof_events(id) on delete cascade,
  account text not null references public.cof_accounts(sgg_user) on delete cascade, at timestamptz not null default now(), primary key (event, account));
alter table public.cof_accounts enable row level security;
alter table public.cof_account_sessions enable row level security;
alter table public.cof_participants enable row level security;
revoke all on public.cof_accounts, public.cof_account_sessions, public.cof_participants from anon, authenticated;
-- Player cards: 5 titles and a cut-out portrait, kept by gamer tag so they stay when a new tournament clears the players.
create table if not exists public.cof_cards (tag text primary key check (char_length(tag) between 1 and 60), titles jsonb not null default '[]'::jsonb,
  portrait text check (char_length(portrait) <= 400000 and portrait ~ '^(hud/players/[a-z0-9-]+\.webp|data:image/(png|webp);base64,[A-Za-z0-9+/=]+)$'), updated_at timestamptz not null default now());
alter table public.cof_cards add column if not exists allowed jsonb not null default '[]'::jsonb;
update public.cof_cards set allowed = titles where allowed = '[]'::jsonb and titles <> '[]'::jsonb; -- titles set before organizers granted them
alter table public.cof_cards enable row level security;
revoke all on public.cof_cards from anon, authenticated;
insert into public.cof_cards (tag, portrait) values ('abz', 'hud/players/abz.webp'), ('addicttekken', 'hud/players/addicttekken.webp'), ('genc', 'hud/players/genc.webp'),
  ('kaiju', 'hud/players/kaiju.webp'), ('vidal', 'hud/players/vidal.webp'), ('yar sen', 'hud/players/yar-sen.webp') on conflict (tag) do nothing;
-- Sponsors on the stream (control panel → Sponsors tab). The first run brings in the original six once; deleted ones stay deleted.
create table if not exists public.cof_sponsors (id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 1 and 60),
  logo text not null check (char_length(logo) <= 300000 and logo ~ '^(hud/sponsors/[a-z0-9-]+\.png|data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$'),
  tall boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.cof_sponsors_seeded (done boolean primary key);
alter table public.cof_sponsors enable row level security;
alter table public.cof_sponsors_seeded enable row level security;
revoke all on public.cof_sponsors, public.cof_sponsors_seeded from anon, authenticated;
do $$ begin
  if not exists (select 1 from public.cof_sponsors_seeded) then
    insert into public.cof_sponsors (name, logo, tall, created_at) values
      ('Rupture', 'hud/sponsors/rupture.png', false, now()), ('Gamebreaker', 'hud/sponsors/gamebreaker.png', false, now() + interval '1 second'),
      ('Immerse VR Gaming Arena', 'hud/sponsors/immerse.png', false, now() + interval '2 seconds'), ('Level Academy', 'hud/sponsors/level-academy.png', true, now() + interval '3 seconds'),
      ('Malta Esports Association', 'hud/sponsors/malta-esports-association.png', true, now() + interval '4 seconds'), ('New Madras', 'hud/sponsors/new-madras.png', true, now() + interval '5 seconds');
    insert into public.cof_sponsors_seeded values (true);
  end if;
end $$;
-- Past tournaments: a snapshot of each finished one (names, standings, match results; never emails). Public to read.
create table if not exists public.cof_archive (key text primary key check (char_length(key) <= 100), at timestamptz not null default now(),
  data jsonb not null check (pg_column_size(data) < 600000));
alter table public.cof_archive enable row level security;
revoke all on public.cof_archive from anon, authenticated;
-- start.gg API key (control panel → start.gg card). Only admin functions can read it.
create table if not exists public.cof_startgg (id int primary key check (id = 1), api_key text check (char_length(api_key) <= 200));
alter table public.cof_startgg add column if not exists send_results boolean not null default false; -- off = test mode: nothing is written to start.gg
alter table public.cof_startgg enable row level security;
revoke all on public.cof_startgg from anon, authenticated;
-- Latest picture of the OBS output, sent by the PC's Stream tab so the phone remote can watch it. One row.
create table if not exists public.cof_preview (id int primary key check (id = 1), img text check (char_length(img) <= 300000),
  at timestamptz, wanted timestamptz);
alter table public.cof_preview enable row level security;
revoke all on public.cof_preview from anon, authenticated;

alter table public.cof_players enable row level security; -- no policies: no direct access
alter table public.cof_state enable row level security;
alter table public.cof_admin enable row level security;
alter table public.cof_attempts enable row level security;
alter table public.cof_sessions enable row level security;
revoke all on public.cof_players, public.cof_state, public.cof_admin, public.cof_attempts, public.cof_sessions from anon, authenticated;

-- status: none (no tournament) → setup (players register) → running → finished.
-- regMode: 'open' = registration opens when the tournament is created, 'at' = opens at regAt.
create or replace function public.cof_default() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'status', 'none', 'name', 'City of Fighters', 'game', 'Tekken 8', 'format', 'double',
    'regOpen', false, 'regMode', 'open', 'regAt', null, 'streamMatch', null, 'screen', 'scoreboard',
    'matches', '[]'::jsonb, 'order', '[]'::jsonb,
    'rules', E'Tekken 8, latest patch.\nEvery match is first to 2 games. Every game is first to 3 rounds.\nWinner of a game must keep their character; loser may switch.\nBe on time: 10 minutes late to a called match is a loss.\nPausing without a reason costs the round. Respect your opponent.')
$$;
insert into public.cof_state values (1, public.cof_default()) on conflict (id) do nothing;

-- Old versions took the password on every call; they are replaced by login tokens.
drop function if exists public.cof_admin_get(text);
drop function if exists public.cof_admin_save(text, jsonb);
drop function if exists public.cof_admin_remove(text, uuid);
drop function if exists public.cof_admin_reset(text);
drop function if exists public.cof_check(text);

-- Caller's IP as seen by Supabase's proxy (the last x-forwarded-for entry is the one the proxy added).
create or replace function public.cof_ip() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    nullif(trim(reverse(split_part(reverse(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for'), ',', 1))), ''),
    'unknown')
$$;

-- Never raises, so wrong tries are always recorded. 3 wrong tries per IP per 15 minutes, and at most
-- 20 wrong tries in total per 15 minutes, so the password cannot be guessed from many addresses either.
create or replace function public.cof_login(p_pw text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_ip text := cof_ip(); fails int; total int; oldest timestamptz; tok text;
begin
  delete from cof_attempts where at < now() - interval '15 minutes';
  delete from cof_sessions where expires < now();
  select count(*), min(at) into fails, oldest from cof_attempts where ip = v_ip;
  select count(*) into total from cof_attempts;
  if fails >= 3 or total >= 20 then
    return jsonb_build_object('ok', false, 'error', format('Too many wrong passwords. Try again in %s minutes.',
      greatest(1, ceil(extract(epoch from coalesce(oldest, now()) + interval '15 minutes' - now()) / 60))::int));
  end if;
  if exists (select 1 from cof_admin where pass_hash = crypt('CHANGE-ME', pass_hash)) then
    return jsonb_build_object('ok', false, 'error', 'Set a real password in Supabase first (see the last line of city-of-fighters.sql)');
  end if;
  if not exists (select 1 from cof_admin where pass_hash = crypt(coalesce(p_pw, ''), pass_hash)) then
    insert into cof_attempts (ip) values (v_ip);
    return jsonb_build_object('ok', false, 'error', case when fails + 1 >= 3 then 'Wrong password. Locked for 15 minutes.'
      else format('Wrong password. %s %s left.', 2 - fails, case when fails = 1 then 'try' else 'tries' end) end);
  end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into cof_sessions values (encode(digest(tok, 'sha256'), 'hex'), now() + interval '24 hours');
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.cof_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from cof_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.cof_auth(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from cof_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires > now()) then
    raise exception 'Please log in again';
  end if;
end $$;

create or replace function public.cof_view(p_emails boolean) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('data', s.data, 'players', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'team', p.team,
                        'photo', extract(epoch from coalesce((select f.updated_at from cof_photos f where f.player = p.id),
                                 (select c.updated_at from cof_cards c where c.tag = lower(trim(p.name)) and c.portrait is not null)))::bigint)  -- photo version, or null
                     || case when p_emails then jsonb_build_object('email', p.email) else '{}'::jsonb end order by p.created_at)
    from cof_players p), '[]'::jsonb), 'now', now())
  from cof_state s where s.id = 1
$$;

create or replace function public.cof_public() returns jsonb
language sql security definer set search_path = public stable as $$ select cof_view(false) $$;

-- Players sign up on start.gg (the app's Register tab sends them there); the old sign-up form is gone.
drop function if exists public.cof_register(text, text, boolean);
drop function if exists public.cof_register(text, text, boolean, text);
drop table if exists public.cof_signups;

create or replace function public.cof_admin_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform cof_auth(p_token); return cof_view(true); end $$;

-- Saves settings and bracket. The seeding order always keeps exactly the registered players,
-- so a sign-up arriving while the admin page is open is never lost.
create or replace function public.cof_admin_save(p_token text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ord jsonb;
begin
  perform cof_auth(p_token);
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'matches') <> 'array'
     or jsonb_typeof(p_data->'order') <> 'array' or octet_length(p_data::text) > 500000 then
    raise exception 'Bad data';
  end if;
  ord := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(p_data->'order') x
                   where exists (select 1 from cof_players where id::text = x)), '[]'::jsonb)
      || coalesce((select jsonb_agg(id::text order by created_at) from cof_players
                   where not (p_data->'order') ? id::text), '[]'::jsonb);
  update cof_state set data = jsonb_set(p_data, '{order}', ord) where id = 1;
end $$;

create or replace function public.cof_admin_remove(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  if exists (select 1 from cof_state where id = 1 and jsonb_array_length(data->'matches') > 0) then
    raise exception 'Bracket already started';
  end if;
  delete from cof_players where id = p_id;
  update cof_state set data = jsonb_set(data, '{order}', data->'order' - p_id::text) where id = 1;
end $$;

-- A player's photo for the app and stream (public, like the gamer tag): the one uploaded for them, else their card portrait.
create or replace function public.cof_photo(p_id uuid) returns text
language sql security definer set search_path = public stable as $$
  select coalesce((select data from cof_photos where player = p_id),
                  (select c.portrait from cof_players p join cof_cards c on c.tag = lower(trim(p.name)) where p.id = p_id))
$$;

-- Players tab: add a player (p_id null) or edit one. Email is optional here.
create or replace function public.cof_admin_player_save(p_token text, p_id uuid, p_name text, p_team text, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid := p_id;
begin
  perform cof_auth(p_token);
  p_name := trim(coalesce(p_name, '')); p_team := nullif(trim(coalesce(p_team, '')), ''); p_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if char_length(p_name) not between 2 and 24 then raise exception 'Gamer tag must be 2–24 characters'; end if;
  if char_length(p_team) > 24 then raise exception 'Team name must be at most 24 characters'; end if;
  if p_email is not null and (p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p_email) > 120) then raise exception 'Enter a valid email or leave it empty'; end if;
  if exists (select 1 from cof_players where lower(name) = lower(p_name) and id is distinct from pid) then raise exception 'That gamer tag is taken'; end if;
  if p_email is not null and exists (select 1 from cof_players where lower(email) = p_email and id is distinct from pid) then raise exception 'That email is already registered'; end if;
  if pid is null then
    if exists (select 1 from cof_state where id = 1 and jsonb_array_length(data->'matches') > 0) then raise exception 'The bracket has started: players can only be edited now'; end if;
    insert into cof_players (name, team, email) values (p_name, p_team, p_email) returning id into pid;
    update cof_state set data = jsonb_set(data, '{order}', (data->'order') || to_jsonb(pid::text)) where id = 1;
  else
    update cof_players set name = p_name, team = p_team, email = p_email where id = pid;
    if not found then raise exception 'Player not found'; end if;
  end if;
  return pid;
end $$;

-- Players tab: set (JPEG/PNG/WebP data URL up to ~300 KB) or remove (null) a player's photo.
create or replace function public.cof_admin_photo(p_token text, p_id uuid, p_data text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  if p_data is null then delete from cof_photos where player = p_id; return; end if;
  if p_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or char_length(p_data) > 400000 then raise exception 'The photo must be a JPEG, PNG or WebP under 300 KB'; end if;
  if not exists (select 1 from cof_players where id = p_id) then raise exception 'Player not found'; end if;
  insert into cof_photos (player, data, updated_at) values (p_id, p_data, now())
  on conflict (player) do update set data = excluded.data, updated_at = now();
end $$;

-- Organizer sets or clears a player's team (shown on the stream HUD).
create or replace function public.cof_admin_team(p_token text, p_id uuid, p_team text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  p_team := nullif(trim(coalesce(p_team, '')), '');
  if char_length(p_team) > 24 then raise exception 'Team name must be at most 24 characters'; end if;
  update cof_players set team = p_team where id = p_id;
end $$;

-- Stream tab: stores the latest OBS picture (null = only asking). Returns true while a phone watched in the last 30 s,
-- so the PC only sends pictures when someone is looking.
create or replace function public.cof_admin_preview_put(p_token text, p_img text) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz;
begin
  perform cof_auth(p_token);
  if p_img is not null and (p_img !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' or char_length(p_img) > 300000) then raise exception 'Bad picture'; end if;
  insert into cof_preview (id, img, at) values (1, p_img, case when p_img is null then null else now() end)
  on conflict (id) do update set img = coalesce(excluded.img, cof_preview.img), at = coalesce(excluded.at, cof_preview.at)
  returning wanted into w;
  return w > now() - interval '30 seconds';
end $$;

-- Events calendar: anyone can read upcoming events (from yesterday on); organizers add, change, delete, and sync start.gg's.
create or replace function public.cof_events_list() returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'at', starts_at, 'link', link, 'game', game, 'place', place, 'startgg', sgg_id is not null)
    order by starts_at), '[]'::jsonb) from cof_events where starts_at > now() - interval '1 day'
$$;
create or replace function public.cof_admin_event_save(p_token text, p_id uuid, p_name text, p_at timestamptz, p_link text, p_game text, p_place text) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid := p_id;
begin
  perform cof_auth(p_token);
  p_name := trim(coalesce(p_name, '')); p_link := nullif(trim(coalesce(p_link, '')), ''); p_game := nullif(trim(coalesce(p_game, '')), ''); p_place := nullif(trim(coalesce(p_place, '')), '');
  if char_length(p_name) not between 2 and 80 then raise exception 'Event name must be 2–80 characters'; end if;
  if p_at is null then raise exception 'Pick the date and time'; end if;
  if p_link is not null and (p_link !~ '^https://[^\s"<>]+$' or char_length(p_link) > 300) then raise exception 'The link must start with https://'; end if;
  if eid is null then insert into cof_events (name, starts_at, link, game, place) values (p_name, p_at, p_link, left(p_game, 40), left(p_place, 80)) returning id into eid;
  else update cof_events set name = p_name, starts_at = p_at, link = p_link, game = left(p_game, 40), place = left(p_place, 80) where id = eid; end if;
  return eid;
end $$;
create or replace function public.cof_admin_event_delete(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform cof_auth(p_token); delete from cof_events where id = p_id; end $$;
-- start.gg's upcoming tournaments replace the earlier copies (typed-in events are never touched).
create or replace function public.cof_admin_events_sync(p_token text, p_events jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  perform cof_auth(p_token);
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then raise exception 'Bad event list'; end if;
  delete from cof_events where sgg_id is not null and starts_at > now() - interval '1 day'
    and sgg_id not in (select x->>'id' from jsonb_array_elements(p_events) x);
  for e in select * from jsonb_array_elements(p_events) loop
    if char_length(e->>'name') between 2 and 80 and (e->>'link') ~ '^https://www\.start\.gg/[^\s"<>]+$' then
      insert into cof_events (name, starts_at, link, game, place, sgg_id)
      values (e->>'name', to_timestamp((e->>'at')::bigint), e->>'link', left(e->>'game', 40), left(e->>'place', 80), e->>'id')
      on conflict (sgg_id) do update set name = excluded.name, starts_at = excluded.starts_at, link = excluded.link, game = excluded.game, place = excluded.place;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Player sessions: 90 days, renewed on every visit, so a player stays logged in.
create or replace function public.cof_account_login(p_user text, p_tag text, p_prefix text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare tok text := encode(gen_random_bytes(32), 'hex');
begin
  insert into cof_accounts (sgg_user, gamer_tag, prefix) values (p_user, left(p_tag, 60), left(p_prefix, 60))
  on conflict (sgg_user) do update set gamer_tag = excluded.gamer_tag, prefix = excluded.prefix;
  delete from cof_account_sessions where expires < now();
  insert into cof_account_sessions values (encode(digest(tok, 'sha256'), 'hex'), p_user, now() + interval '90 days');
  return tok;
end $$;
create or replace function public.cof_account_of(p_session text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a text;
begin
  update cof_account_sessions set expires = now() + interval '90 days'
  where token_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex') and expires > now() returning account into a;
  if a is null then raise exception 'Please log in again'; end if;
  return a;
end $$;
-- The app: who am I, and which calendar events have I joined?
create or replace function public.cof_me(p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a text := cof_account_of(p_session);
begin
  return (select jsonb_build_object('name', gamer_tag, 'events', coalesce((select jsonb_agg(event) from cof_participants where account = a), '[]'::jsonb))
    from cof_accounts where sgg_user = a);
end $$;
create or replace function public.cof_account_logout(p_session text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from cof_account_sessions where token_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex')
$$;
-- Participate (cof-startgg function only): only upcoming City of Fighters events that came from start.gg, nothing else.
create or replace function public.cof_participate_check(p_session text, p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a text := cof_account_of(p_session); e cof_events;
begin
  select * into e from cof_events where id = p_event and sgg_id is not null and starts_at > now();
  if not found then raise exception 'This is not an upcoming City of Fighters event'; end if;
  return (select jsonb_build_object('account', a, 'tournament', e.sgg_id, 'link', e.link, 'key', case when send_results then api_key end) from (select 1) x left join cof_startgg on id = 1);
end $$;
create or replace function public.cof_participate_mark(p_account text, p_event uuid) returns void
language sql security definer set search_path = public as $$
  insert into cof_participants (event, account) values (p_event, p_account) on conflict do nothing
$$;

-- Sponsors: anyone can read (they're on the stream); the overlay checks the short version often and loads the logos only when it changes.
create or replace function public.cof_sponsors_list() returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'logo', logo, 'tall', tall) order by created_at), '[]'::jsonb) from cof_sponsors
$$;
create or replace function public.cof_sponsors_version() returns text
language sql security definer set search_path = public stable as $$
  select md5(coalesce(string_agg(id::text, ',' order by created_at), '')) from cof_sponsors
$$;
create or replace function public.cof_admin_sponsor_add(p_token text, p_name text, p_logo text, p_tall boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  perform cof_auth(p_token);
  p_name := trim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 60 then raise exception 'Sponsor name must be 1–60 characters'; end if;
  if coalesce(p_logo, '') !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' or char_length(p_logo) > 300000 then raise exception 'The logo must be a PNG, JPEG or WebP under 200 KB'; end if;
  if (select count(*) from cof_sponsors) >= 30 then raise exception 'At most 30 sponsors'; end if;
  insert into cof_sponsors (name, logo, tall) values (p_name, p_logo, coalesce(p_tall, false)) returning id into sid;
  return sid;
end $$;
create or replace function public.cof_admin_sponsor_delete(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin perform cof_auth(p_token); delete from cof_sponsors where id = p_id; end $$;

-- Player cards. Anyone can read them (they're on the stream). Organizers grant the titles a player may use (allowed);
-- the player, or an organizer, picks up to 5 of those to show (titles).
drop function if exists public.cof_admin_card_titles(text, text, jsonb);
create or replace function public.cof_titles_check(p jsonb, p_max int) returns void language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > p_max then raise exception 'Choose at most % titles', p_max; end if;
  if exists (select 1 from jsonb_array_elements(p) t where jsonb_typeof(t) <> 'string' or t #>> '{}' !~ '^[a-z0-9-]{1,40}$') then raise exception 'Unknown title'; end if;
  if (select count(distinct t) from jsonb_array_elements_text(p) t) <> jsonb_array_length(p) then raise exception 'Each title can only be chosen once'; end if;
end $$;
drop function if exists public.cof_titles_check(jsonb);
create or replace function public.cof_card(p_tag text) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('allowed', allowed, 'titles', titles, 'portrait', portrait) from cof_cards where tag = lower(trim(p_tag))
$$;
create or replace function public.cof_admin_card_titles(p_token text, p_tag text, p_allowed jsonb, p_titles jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token); perform cof_titles_check(p_allowed, 500); perform cof_titles_check(p_titles, 5);
  if not p_allowed @> p_titles then raise exception 'A shown title must be one this player can use'; end if;
  insert into cof_cards (tag, allowed, titles) values (lower(trim(p_tag)), p_allowed, p_titles)
  on conflict (tag) do update set allowed = excluded.allowed, titles = excluded.titles, updated_at = now();
end $$;
create or replace function public.cof_admin_card_portrait(p_token text, p_tag text, p_portrait text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  if p_portrait is not null and (p_portrait !~ '^data:image/(png|webp);base64,[A-Za-z0-9+/=]+$' or char_length(p_portrait) > 400000) then raise exception 'The portrait must be a PNG or WebP under 300 KB'; end if;
  insert into cof_cards (tag, portrait) values (lower(trim(p_tag)), p_portrait) on conflict (tag) do update set portrait = excluded.portrait, updated_at = now();
end $$;
-- Players tab: everyone who has logged in with start.gg, so organizers can grant them titles.
create or replace function public.cof_admin_accounts(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('name', a.gamer_tag, 'allowed', coalesce(jsonb_array_length(c.allowed), 0)) order by lower(a.gamer_tag))
    from cof_accounts a left join cof_cards c on c.tag = lower(trim(a.gamer_tag))), '[]'::jsonb);
end $$;
create or replace function public.cof_card_save_mine(p_session text, p_titles jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a text := cof_account_of(p_session); -- first, so a bad session is always refused
  t text := (select lower(trim(gamer_tag)) from cof_accounts where sgg_user = a);
begin
  perform cof_titles_check(p_titles, 5);
  if not coalesce((select allowed from cof_cards where tag = t), '[]'::jsonb) @> p_titles then raise exception 'That title hasn''t been given to you yet'; end if;
  update cof_cards set titles = p_titles, updated_at = now() where tag = t;
end $$;

-- Past tournaments: the control panel saves a finished tournament (again after a reopen), anyone can read them.
create or replace function public.cof_admin_archive_save(p_token text, p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  if jsonb_typeof(p_data) <> 'object' or p_data ? 'email' then raise exception 'Bad archive entry'; end if;
  insert into cof_archive (key, data) values (p_key, p_data) on conflict (key) do update set data = excluded.data;
end $$;
create or replace function public.cof_admin_archive_delete(p_token text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin perform cof_auth(p_token); delete from cof_archive where key = p_key; end $$;
create or replace function public.cof_archive_list() returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'at', at, 'name', data->'name', 'game', data->'game', 'format', data->'format',
    'eventAt', data->'eventAt', 'players', data->'players', 'champions', data->'champions') order by coalesce((data->>'eventAt')::timestamptz, at) desc), '[]'::jsonb)
  from cof_archive
$$;
create or replace function public.cof_archive_get(p_key text) returns jsonb
language sql security definer set search_path = public stable as $$ select data from cof_archive where key = p_key $$;

-- start.gg API key: save (null removes it) and read, for logged-in organizers only.
create or replace function public.cof_admin_startgg_set(p_token text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  p_key := nullif(trim(coalesce(p_key, '')), '');
  if char_length(p_key) > 200 then raise exception 'That does not look like a start.gg API key'; end if;
  insert into cof_startgg (id, api_key) values (1, p_key) on conflict (id) do update set api_key = excluded.api_key;
end $$;
create or replace function public.cof_admin_startgg_get(p_token text) returns text
language plpgsql security definer set search_path = public as $$
begin perform cof_auth(p_token); return (select api_key from cof_startgg where id = 1); end $$;

-- Test mode (Settings tab): results and sign-ups go to start.gg only when this is on. Reading start.gg is always allowed.
create or replace function public.cof_admin_startgg_live(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
begin perform cof_auth(p_token); return coalesce((select send_results from cof_startgg where id = 1), false); end $$;
create or replace function public.cof_admin_startgg_live_set(p_token text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  insert into cof_startgg (id, send_results) values (1, p_on is true) on conflict (id) do update set send_results = excluded.send_results;
end $$;

-- Phone remote: the latest OBS picture and when it was taken.
create or replace function public.cof_admin_preview_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r cof_preview;
begin
  perform cof_auth(p_token);
  insert into cof_preview (id, wanted) values (1, now()) on conflict (id) do update set wanted = now() returning * into r;
  return jsonb_build_object('img', r.img, 'at', r.at);
end $$;

-- New tournament: removes all players and results, then applies the new settings (p_data may be null).
create or replace function public.cof_admin_reset(p_token text, p_data jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cof_auth(p_token);
  delete from cof_players where true;
  update cof_state set data = cof_default() || coalesce(p_data - 'matches' - 'order', '{}'::jsonb) where id = 1;
end $$;

-- Winner banner email (sent by the cof-winner-email Edge Function, which alone may call these two).
-- Each champion gets the email once per tournament unless the organizer sends it again on purpose.
create table if not exists public.cof_mail_log (tkey text not null, player uuid not null, sent_at timestamptz not null default now(), primary key (tkey, player));
alter table public.cof_mail_log enable row level security;
revoke all on public.cof_mail_log from anon, authenticated;

create or replace function public.cof_winner_mail(p_token text, p_ids uuid[], p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; k text;
begin
  perform cof_auth(p_token);
  select data into d from cof_state where id = 1;
  if coalesce(d->>'status', '') <> 'finished' then raise exception 'The tournament is not finished yet'; end if;
  k := coalesce(d->>'createdAt', '') || '|' || coalesce(d->>'name', '');
  if not p_force and exists (select 1 from cof_mail_log where tkey = k and player = any(p_ids)) then
    raise exception 'The winner banner was already emailed';
  end if;
  return jsonb_build_object('key', k, 'tournament', d->>'name', 'game', d->>'game', 'winners', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email)) from cof_players where id = any(p_ids)), '[]'::jsonb));
end $$;

create or replace function public.cof_winner_mailed(p_key text, p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  insert into cof_mail_log (tkey, player) select p_key, unnest(p_ids) on conflict do nothing
$$;

revoke all on function public.cof_winner_mail(text, uuid[], boolean), public.cof_winner_mailed(text, uuid[]) from public, anon, authenticated;
revoke all on function public.cof_titles_check(jsonb, int) from public, anon, authenticated;
revoke all on function public.cof_account_login(text, text, text), public.cof_account_of(text), public.cof_participate_check(text, uuid), public.cof_participate_mark(text, uuid) from public, anon, authenticated;
grant execute on function public.cof_account_login(text, text, text), public.cof_participate_check(text, uuid), public.cof_participate_mark(text, uuid) to service_role;
grant execute on function public.cof_winner_mail(text, uuid[], boolean), public.cof_winner_mailed(text, uuid[]) to service_role;

revoke all on function public.cof_default(), public.cof_ip(), public.cof_auth(text), public.cof_view(boolean) from public, anon, authenticated;
grant execute on function public.cof_public(), public.cof_admin_team(text, uuid, text),
  public.cof_photo(uuid), public.cof_admin_player_save(text, uuid, text, text, text), public.cof_admin_photo(text, uuid, text), public.cof_admin_preview_put(text, text), public.cof_admin_preview_get(text), public.cof_admin_startgg_set(text, text), public.cof_admin_startgg_get(text), public.cof_admin_startgg_live(text), public.cof_admin_startgg_live_set(text, boolean),
  public.cof_me(text), public.cof_account_logout(text),
  public.cof_card(text), public.cof_admin_card_titles(text, text, jsonb, jsonb), public.cof_admin_accounts(text), public.cof_admin_card_portrait(text, text, text), public.cof_card_save_mine(text, jsonb),
  public.cof_sponsors_list(), public.cof_sponsors_version(), public.cof_admin_sponsor_add(text, text, text, boolean), public.cof_admin_sponsor_delete(text, uuid),
  public.cof_events_list(), public.cof_admin_event_save(text, uuid, text, timestamptz, text, text, text), public.cof_admin_event_delete(text, uuid), public.cof_admin_events_sync(text, jsonb),
  public.cof_admin_archive_save(text, text, jsonb), public.cof_admin_archive_delete(text, text), public.cof_archive_list(), public.cof_archive_get(text), public.cof_login(text), public.cof_logout(text),
  public.cof_admin_get(text), public.cof_admin_save(text, jsonb), public.cof_admin_remove(text, uuid), public.cof_admin_reset(text, jsonb) to anon;

-- Control panel password. A first install sets CHANGE-ME (the panel refuses to open until you change it);
-- running this file again keeps your current password.
-- To set or change it, run this line on its own in the SQL Editor with your password, and never save it in this file (it is public on GitHub):
--   update public.cof_admin set pass_hash = extensions.crypt('YOUR-PASSWORD', extensions.gen_salt('bf')); delete from public.cof_sessions;
-- (the delete logs out every device, so only the new password works)
insert into public.cof_admin values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf'))) on conflict (id) do nothing;
