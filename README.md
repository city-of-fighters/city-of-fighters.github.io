# City of Fighters

Tekken 8 tournament manager for Twitch streams: player sign-up, double-elimination bracket, live OBS overlays, and a results image at the end.

Website (GitHub Pages): https://gaberpet.github.io/city-of-fighters/

| Page | Link |
|---|---|
| Player sign-up | https://gaberpet.github.io/city-of-fighters/ |
| Control panel (password) | https://gaberpet.github.io/city-of-fighters/admin.html |
| Stream tab: preview and deploy what OBS shows | https://gaberpet.github.io/city-of-fighters/studio.html |
| Phone remote (password) | https://gaberpet.github.io/city-of-fighters/phone.html |
| **OBS Browser Source** (1920×1080, the only one needed) | https://gaberpet.github.io/city-of-fighters/overlay.html |

The OBS page shows the scoreboard, bracket, standings or podium: pick one in the Stream tab, check the preview, press **Deploy to OBS**. The podium goes live by itself when the tournament ends. The old `bracket.html` / `leaderboard.html` links still work.

## One-time setup

Data lives in Supabase (same project as Iron Fist Academy, tables start with `cof_`).

1. Paste `supabase/city-of-fighters.sql` into Supabase → SQL Editor and change `CHANGE-ME` on the last line there (never save your password in the file; the repo is public).
2. Run.

To change the password later, run only the last line again with the new password.

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
