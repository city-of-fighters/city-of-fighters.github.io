# City of Fighters

Tekken 8 tournament manager for Twitch streams: sign-up through start.gg, brackets bracket, live OBS overlays, and a results image at the end.

Website (GitHub Pages): https://cityoffighters.com/

| Page | Link |
|---|---|
| App (leaderboard, events, register, admin) | https://cityoffighters.com/app.html |
| Events calendar | https://cityoffighters.com/events.html |
| Player registration | https://cityoffighters.com/ |
| Control panel (password) | https://cityoffighters.com/admin.html |
| Players tab: add, edit, photos (password) | https://cityoffighters.com/players.html |
| Stream tab: preview and deploy what OBS shows, OBS cameras and Coming Up scene | https://cityoffighters.com/studio.html |
| Phone remote (password) | https://cityoffighters.com/phone.html |
| **OBS Browser Source** (1920×1080, the only one needed) | https://cityoffighters.com/overlay.html |

The OBS page shows the HUD (scores, names, teams, photos), result popups, bracket, standings, podium and the Coming Up screen between matches: pick one in the Stream tab, check the preview, press **Deploy to OBS**. The podium goes live by itself when the tournament ends. The old `bracket.html` / `leaderboard.html` links still work.

## Apps

- **Computer** (Windows installer / portable .exe, Linux AppImage): download from the [latest release](https://github.com/city-of-fighters/city-of-fighters.github.io/releases/latest) or the "Get the apps" box in the control panel. The app opens the live website in its own window (Ctrl+1 control panel, Ctrl+2 players, Ctrl+3 Stream) and reads the OBS WebSocket password from this computer's OBS settings, so the Stream tab connects to OBS by itself. To build a new release, push a tag like `v1.0.1`; GitHub builds, tests and publishes the files (`.github/workflows/release.yml`, code in `desktop/`).
- **Phone**: open the phone remote and tap **Install app** (or browser menu → Install / Add to Home screen).

## Setup and updates

Data lives in Supabase (same project as Iron Fist Academy, tables start with `cof_`).

1. Paste the whole `supabase/city-of-fighters.sql` into Supabase → SQL Editor → Run. Run it again after updates: it keeps players, tournament and password.
2. Set the admin password with this line on its own in the SQL Editor (never save it in the file, the repo is public):
   `update public.cof_admin set pass_hash = extensions.crypt('YOUR-PASSWORD', extensions.gen_salt('bf')); delete from public.cof_sessions;`
   (the delete logs every device out, so only the new password works)

Logging in gives the device a token for 24 hours. 3 wrong passwords per address (or 20 in total) lock the login for 15 minutes.
Players sign up on start.gg only (the old sign-up function is removed). Tables are locked; the site only calls the `cof_` functions,
and admin functions need the login token. Player emails, the start.gg key and the OBS picture never leave admin functions.

## OBS (Stream tab, card 3)

- **Connect**: address and the WebSocket password from OBS → Tools → WebSocket Server Settings (the desktop app fills both in).
- **Cameras**: add, pick the device, show or hide on stream, remove. Laptops' infrared sensors are skipped.
- **Coming Up scene** (`CoF Coming Up`): the game in the big window, player cameras in the small ones. OBS switches to it
  between matches and back when a match goes on stream (the overlay's browser source needs page permission "Advanced", set automatically).
- **One camera for both players**: tick it to cut one camera in halves (left → Player 1, or swapped). Uses the helper scene `CoF Players camera`.
- **Cameras in the HUD**: the same cameras in outlined boxes in the bottom corners during a match (`CoF HUD cameras` scene, overlay `?cams=1`).
- **Phone live view**: while connected, the Stream tab sends a small picture of OBS once a second when a phone's Admin → Score or OBS tab is open.

## Past tournaments

When a champion is decided the control panel saves a snapshot (names, teams, standings, match results; no emails) to `cof_archive`,
and again before "Create a new tournament" clears a finished one. The app's Leaderboard lists them for everyone; the control panel's
**Past tournaments** card can delete one.

## start.gg

Control panel → **start.gg** card (instructions inside). Paste the event link and a personal API token
(start.gg → Developer Settings). **Get players from start.gg** imports entrants and start.gg's seeding; every result
decided here is reported to the matching set on start.gg (undo resets it) while the control panel or Stream tab is open
on a computer. Press Start on the start.gg bracket too. Code: `public/startgg.js`.

While a tournament is linked, the Register tab sends players to the start.gg registration page and the control panel pulls new
sign-ups in every 3 minutes until the bracket starts. start.gg's API has no anonymous access and no documented way to register
a player without their approval: see the next section for what the app tries.

## Log in with start.gg (players)

Players log in once with their start.gg account (sessions last 90 days from the last visit) and press **Participate** on a City of
Fighters event in the calendar. `public/account.js` and the `cof-startgg` Edge Function handle it. Until the function is deployed the
app shows plain start.gg links instead. Participate works only on upcoming events synced from start.gg; the database checks this.
The function tries start.gg's `generateRegistrationToken` + `registerForTournament` with the master key, and if start.gg refuses, it
opens the event's start.gg sign-up page. Either way the control panel then pulls the player into the bracket (every 3 minutes, while a
tournament is linked and the control panel or Stream tab is open). Not yet tested against the real start.gg.

Setup, once, from the master start.gg account:

1. start.gg → Developer Settings → OAuth apps: create one, redirect URL `https://cityoffighters.com/events.html`.
2. Supabase → Edge Functions → **Secrets**: add `SGG_CLIENT_ID` and `SGG_CLIENT_SECRET`.
3. Supabase → Edge Functions → **Deploy a new function → Via editor**, name it `cof-startgg`, paste `supabase/functions/cof-startgg/index.ts`, deploy.
4. In that function's settings turn **Verify JWT** off (the function checks the player's session itself).

## Events calendar

`events.html` (📅 Events tab) lists `cof_events`: events typed in on the control panel's **Events calendar** card, plus the upcoming
tournaments City of Fighters hosts on start.gg: the ones the API key's account created (`tournaments(filter: { ownerId })`) plus the ones it admins (`currentUser.tournaments`, `tournamentView: "admin"`), never ones it only plays in. Synced every 30 minutes and on demand.

## Winner banner email

When a tournament's champion is decided, the control panel draws a winner banner and the `cof-winner-email`
Edge Function emails it to the champion from a Gmail account (once per tournament; the dashboard can send it again).
Setup, once:

1. Google account of the Gmail you send from: turn on 2-Step Verification, then create an **App password** at https://myaccount.google.com/apppasswords
2. Supabase → Edge Functions → **Secrets**: add `GMAIL_USER` (the Gmail address) and `GMAIL_APP_PASSWORD` (the 16-letter app password).
3. Supabase → Edge Functions → **Deploy a new function → Via editor**, name it `cof-winner-email`, paste `supabase/functions/cof-winner-email/index.ts`, deploy.
4. In that function's settings turn **Verify JWT** off (the function checks the organizer login itself).

## Privacy

`privacy.html` and `terms.html`; the first visit asks whether the app may save anything on the device (`consent.js`).
Keep the privacy page in step with what the code collects.

## The app

https://cityoffighters.com/app.html (installable on phones). Tabs: **Leaderboard** (public, read-only), **Register** (sends players to start.gg), **Admin** (password). Organizers create tournaments in the dashboard (`admin.html`): name, game, type, and when registration opens (right away, or at a date and time).

## Rules built in

- Pick the tournament type when you start: double elimination (grand final with bracket reset), single elimination, round robin or Swiss. Round robin and Swiss give 3 points per match won (a bye counts as a win), ties broken by games won.
- Matches are first to 2 games; games are first to 3 rounds.
- Players sign up on start.gg; gamer tags must be unique here (start.gg's sponsor prefix becomes the team).

## How a match works

1. Start the bracket in the control panel (registration closes).
2. Put a match on stream, press **+ round** for each round won. 3 rounds wins a game, 2 games wins the match.
3. The winner moves on in the bracket. OBS shows the winner for 6 seconds, then "Waiting for the next match" until you put the next match on stream. Made a mistake? Press **Undo** (steps back through your last 20 actions on that device) or **Reopen** a finished match.
Matches played off stream: enter the result (2–0 / 2–1) on the phone remote or with the "won" buttons in the control panel; a short popup shows it on stream.

4. When the grand final ends, a results image appears in the control panel: **Download PNG**.

`node test.js` checks the bracket logic. Every push to `main` runs it and publishes `public/` to GitHub Pages.
