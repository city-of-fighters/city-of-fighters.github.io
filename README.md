# City of Fighters

Tekken 8 tournament manager for Twitch streams: player sign-up, double-elimination bracket, live OBS overlays, and a results image at the end.

## Run

Needs [Node.js](https://nodejs.org) 18+. No install step.

```bash
node server.js
```

| Page | URL |
|---|---|
| Control panel | http://localhost:3000/admin |
| Player sign-up (same Wi‑Fi) | http://YOUR-PC-IP:3000/ |
| OBS scoreboard | http://localhost:3000/overlay |
| OBS standings | http://localhost:3000/leaderboard |

Add the OBS pages as **Browser Source**, 1920×1080. The background is transparent.

## Rules built in

- Double elimination, grand final with bracket reset.
- Matches are first to 2 games; games are first to 3 rounds.
- Sign-up needs a unique gamer tag and email, and accepting the rules.

## How a match works

1. Start the bracket in the control panel (registration closes).
2. Put a match on stream, press **+ round** for each round won. 3 rounds wins a game, 2 games wins the match.
3. The winner moves on and the stream switches to their next match automatically. Use **Reopen** to fix a mistake.
4. When the grand final ends, a results image appears in the control panel: **Download PNG**.

Data is saved in `data.json` (not in git). `node test.js` checks the bracket logic.
