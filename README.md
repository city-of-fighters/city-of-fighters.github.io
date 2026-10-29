# City of Fighters

Tekken 8 tournament manager for Twitch streams: player sign-up, double-elimination bracket, live OBS overlays, and a results image at the end.

Website (GitHub Pages): https://gaberpet.github.io/city-of-fighters/

| Page | Link |
|---|---|
| App (leaderboard, register, admin) | https://gaberpet.github.io/city-of-fighters/app.html |
| Player registration | https://gaberpet.github.io/city-of-fighters/ |
| Control panel (password) | https://gaberpet.github.io/city-of-fighters/admin.html |
| Stream tab: preview and deploy what OBS shows | https://gaberpet.github.io/city-of-fighters/studio.html |
| Phone remote (password) | https://gaberpet.github.io/city-of-fighters/phone.html |
| **OBS Browser Source** (1920×1080, the only one needed) | https://gaberpet.github.io/city-of-fighters/overlay.html |

The OBS page shows the scoreboard, bracket, standings or podium: pick one in the Stream tab, check the preview, press **Deploy to OBS**. The podium goes live by itself when the tournament ends. The old `bracket.html` / `leaderboard.html` links still work.

## Apps

- **Computer** (Windows installer / portable .exe, Linux AppImage): download from the [latest release](https://github.com/GaberPet/city-of-fighters/releases/latest) or the "Get the apps" box in the control panel. The app opens the live website in its own window. To build a new release, push a tag like `v1.0.1`; GitHub builds, tests and publishes the files (`.github/workflows/release.yml`, code in `desktop/`).
- **Phone**: open the phone remote and tap **Install app** (or browser menu → Install / Add to Home screen).

## Setup and updates

Data lives in Supabase (same project as Iron Fist Academy, tables start with `cof_`).

1. Paste the whole `supabase/city-of-fighters.sql` into Supabase → SQL Editor → Run. Run it again after updates: it keeps players, tournament and password.
2. Set the admin password with this line on its own in the SQL Editor (never save it in the file, the repo is public):
   `update public.cof_admin set pass_hash = extensions.crypt('YOUR-PASSWORD', extensions.gen_salt('bf'));`

Logging in gives the device a token for 24 hours. 3 wrong passwords lock the login for 15 minutes.

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

https://gaberpet.github.io/city-of-fighters/app.html (installable on phones). Tabs: **Leaderboard** (public, read-only), **Register** (only while registration is open), **Admin** (password). Organizers create tournaments in the dashboard (`admin.html`): name, game, type, and when registration opens (right away, or at a date and time).

## Rules built in

- Pick the tournament type when you start: double elimination (grand final with bracket reset), single elimination, round robin or Swiss. Round robin and Swiss give 3 points per match won (a bye counts as a win), ties broken by games won.
- Matches are first to 2 games; games are first to 3 rounds.
- Sign-up needs a unique gamer tag and email, and accepting the rules.

## How a match works

1. Start the bracket in the control panel (registration closes).
2. Put a match on stream, press **+ round** for each round won. 3 rounds wins a game, 2 games wins the match.
3. The winner moves on in the bracket. OBS shows the winner for 6 seconds, then "Waiting for the next match" until you put the next match on stream. Made a mistake? Press **Undo** (steps back through your last 20 actions on that device) or **Reopen** a finished match.
Matches played off stream: enter the result (2–0 / 2–1) on the phone remote or with the "won" buttons in the control panel; a short popup shows it on stream.

4. When the grand final ends, a results image appears in the control panel: **Download PNG**.

`node test.js` checks the bracket logic. Every push to `main` runs it and publishes `public/` to GitHub Pages.
