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
                        'photo', (select extract(epoch from f.updated_at)::bigint from cof_photos f where f.player = p.id))  -- photo version, or null
                     || case when p_emails then jsonb_build_object('email', p.email) else '{}'::jsonb end order by p.created_at)
    from cof_players p), '[]'::jsonb), 'now', now())
  from cof_state s where s.id = 1
$$;

create or replace function public.cof_public() returns jsonb
language sql security definer set search_path = public stable as $$ select cof_view(false) $$;

drop function if exists public.cof_register(text, text, boolean); -- replaced by the version with an optional team
create or replace function public.cof_register(p_name text, p_email text, p_agree boolean, p_team text default null) returns int
language plpgsql security definer set search_path = public as $$
declare d jsonb; st text; pid uuid; n int;
begin
  p_name := trim(coalesce(p_name, '')); p_email := lower(trim(coalesce(p_email, ''))); p_team := nullif(trim(coalesce(p_team, '')), '');
  select data into d from cof_state where id = 1 for update;
  st := coalesce(d->>'status', case when jsonb_array_length(d->'matches') = 0 then 'setup' else 'running' end);
  if st = 'none' then raise exception 'No tournament in progress'; end if;
  if st <> 'setup' or jsonb_array_length(d->'matches') > 0 or not coalesce((d->>'regOpen')::boolean, false) then
    raise exception 'Registration is closed';
  end if;
  if d->>'regMode' = 'at' and d->>'regAt' is not null and now() < (d->>'regAt')::timestamptz then
    raise exception 'Registration is not open yet';
  end if;
  if char_length(p_name) not between 2 and 24 then raise exception 'Gamer tag must be 2–24 characters'; end if;
  if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(p_email) > 120 then raise exception 'Enter a valid email'; end if;
  if p_agree is not true then raise exception 'You must accept the rules'; end if;
  if char_length(p_team) > 24 then raise exception 'Team name must be at most 24 characters'; end if;
  if exists (select 1 from cof_players where lower(name) = lower(p_name)) then raise exception 'That gamer tag is taken'; end if;
  if exists (select 1 from cof_players where lower(email) = p_email) then raise exception 'That email is already registered'; end if;
  select count(*) into n from cof_players;
  if n >= 256 then raise exception 'The tournament is full'; end if;
  insert into cof_players (name, email, team) values (p_name, p_email, p_team) returning id into pid;
  update cof_state set data = jsonb_set(data, '{order}', (data->'order') || to_jsonb(pid::text)) where id = 1;
  return n + 1;
end $$;

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

-- A player's photo for the app and stream (public, like the gamer tag).
create or replace function public.cof_photo(p_id uuid) returns text
language sql security definer set search_path = public stable as $$ select data from cof_photos where player = p_id $$;

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
grant execute on function public.cof_winner_mail(text, uuid[], boolean), public.cof_winner_mailed(text, uuid[]) to service_role;

revoke all on function public.cof_default(), public.cof_ip(), public.cof_auth(text), public.cof_view(boolean) from public, anon, authenticated;
grant execute on function public.cof_public(), public.cof_register(text, text, boolean, text), public.cof_admin_team(text, uuid, text),
  public.cof_photo(uuid), public.cof_admin_player_save(text, uuid, text, text, text), public.cof_admin_photo(text, uuid, text), public.cof_login(text), public.cof_logout(text),
  public.cof_admin_get(text), public.cof_admin_save(text, jsonb), public.cof_admin_remove(text, uuid), public.cof_admin_reset(text, jsonb) to anon;

-- Control panel password. A first install sets CHANGE-ME (the panel refuses to open until you change it);
-- running this file again keeps your current password.
-- To set or change it, run this line on its own in the SQL Editor with your password, and never save it in this file (it is public on GitHub):
--   update public.cof_admin set pass_hash = extensions.crypt('YOUR-PASSWORD', extensions.gen_salt('bf'));
insert into public.cof_admin values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf'))) on conflict (id) do nothing;
