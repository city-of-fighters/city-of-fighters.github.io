# City of Fighters

Tekken 8 tournament system for Twitch: phone app, control panel, OBS overlays, start.gg link.

To move or deploy the site, read and follow [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md). Feature and setup details are in [README.md](README.md).

Rules for working here:
- Never put passwords, tokens, keys or app passwords in this repo, a chat or a log. The people who own them paste them in themselves.
- Stage only the files you changed; never `git add -A`. The repo may be public.
- Run `node test.js` before pushing. Pushing to `main` deploys.
- Anything in `public/` is readable by every visitor.
- After any change to `supabase/city-of-fighters.sql`, a person must run the file in Supabase. It's safe to run again.
