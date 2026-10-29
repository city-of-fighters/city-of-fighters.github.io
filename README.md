# City of Fighters

Tekken 8 tournament manager for Twitch streams: player sign-up, double-elimination bracket, live OBS overlays, and a results image at the end.

Website (GitHub Pages): https://gaberpet.github.io/city-of-fighters/

| Page | Link |
|---|---|
| Player sign-up | https://gaberpet.github.io/city-of-fighters/ |
| Control panel (password) | https://gaberpet.github.io/city-of-fighters/admin.html |
| OBS scoreboard | https://gaberpet.github.io/city-of-fighters/overlay.html |
| Phone remote (password) | https://gaberpet.github.io/city-of-fighters/phone.html |
| OBS standings | https://gaberpet.github.io/city-of-fighters/leaderboard.html |
| OBS bracket | https://gaberpet.github.io/city-of-fighters/bracket.html |

Add the OBS pages as **Browser Source**, 1920×1080. The background is transparent.

## One-time setup

Data lives in Supabase (same project as Iron Fist Academy, tables start with `cof_`).

1. Paste `supabase/city-of-fighters.sql` into Supabase → SQL Editor and change `CHANGE-ME` on the last line there (never save your password in the file; the repo is public).
2. Run.

To change the password later, run only the last line again with the new password.

## Rules built in

- Double elimination, grand final with bracket reset.
- Matches are first to 2 games; games are first to 3 rounds.
- Sign-up needs a unique gamer tag and email, and accepting the rules.

## How a match works

1. Start the bracket in the control panel (registration closes).
2. Put a match on stream, press **+ round** for each round won. 3 rounds wins a game, 2 games wins the match.
3. The winner moves on and the stream switches to their next match automatically. Made a mistake? Press **Undo** (steps back through your last 20 actions on that device) or **Reopen** a finished match.
4. When the grand final ends, a results image appears in the control panel: **Download PNG**.

`node test.js` checks the bracket logic. Every push to `main` runs it and publishes `public/` to GitHub Pages.
