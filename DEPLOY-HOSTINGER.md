# Move City of Fighters to Hostinger

Instructions for the Claude (and the person) doing this move. Follow them in order.
Written 6 November 2026. The site currently runs on GitHub Pages at https://city-of-fighters.github.io/ and must keep working until Hostinger is proven.

## Rules

1. **Never ask for, print, store or commit a secret.** That covers the admin password, start.gg token, client secret, Gmail app password, Hostinger login and Supabase keys other than the public `sb_publishable_` one. If one is needed, tell the person where to paste it.
2. **Keep the same Supabase project** (`glqxyghdcindimggnwml`). It holds the players, results and photos. Don't create a new one unless the owner asks. Hosting moves; the database doesn't.
3. **Don't run SQL that deletes data.** `supabase/city-of-fighters.sql` is safe to run again; a person runs it in the Supabase SQL Editor.
4. **Ask the owner before** changing DNS, disabling GitHub Pages, making the repo private, or anything that costs money.
5. **Don't do the switch during a tournament or stream.**
6. Stage specific files only, and run `node test.js` before pushing to `main`.

## How the system works

| Part | Where | Notes |
|---|---|---|
| Website | `public/` | Static HTML, CSS and JS. No build step, PHP or Node on the server. All links between pages are relative. |
| Database | Supabase | Called from the browser with the public key in `public/api.js`. Tables are locked; everything goes through `cof_` functions. |
| Server functions | `supabase/functions/` | `cof-winner-email` and `cof-startgg`, deployed on Supabase, not Hostinger. |
| PC app | `desktop/` | Electron. Loads the live site. `SITE` in `desktop/main.cjs` holds the address. Built by `.github/workflows/release.yml` on `v*` tags. |
| Hostinger branch | `hostinger` | Made automatically by `.github/workflows/hostinger.yml`: only the contents of `public/`. |
| Keep-awake job | `.github/workflows/keep-awake.yml` | Pings Supabase twice a week so the free plan doesn't pause. **Must keep running.** |

Hostinger's Git deploy has no build step and replaces the deploy folder each time. That's why it uses the `hostinger` branch, and why PC installers can't be stored in that folder.

## Status when this was written

Checked against the live system:

- [x] Winner email function deployed and reachable
- [ ] Gmail secrets: not confirmed
- [ ] Latest `supabase/city-of-fighters.sql` run: **not yet** (`cof_sponsors_version` is missing). The Sponsors tab needs it.
- [ ] `cof-startgg` function: **not deployed** (wait for the final address, step 4)
- [ ] start.gg token: the hub owner hasn't supplied it yet
- [ ] Domain: `cityoffighters.com` **not registered yet**
- [ ] Nothing has been tested against the real start.gg

Re-check these rather than trusting this list.

## What the people must do

Only a person can do these. Ask for them when you reach that step:

- Give the Hostinger account access to the GitHub repo (the GitHub popup in step 2).
- Buy or connect the domain.
- Run SQL in Supabase and paste secrets into Supabase.
- Create the start.gg token and OAuth app.

## Step 1: Hostinger plan and domain

1. Confirm the plan supports Git deployment: web or cloud hosting with a custom PHP/HTML website. It isn't available on agency hosting.
2. Add the website in hPanel. Buy `cityoffighters.com` at Hostinger, or use one bought elsewhere and point its DNS at Hostinger. Before buying, confirm with the owner: the name may have been bought in the meantime.

## Step 2: Connect GitHub

The `hostinger` branch should already exist. If it doesn't, run the "Prepare Hostinger branch" workflow.

1. hPanel → the website → **Advanced** → **Git** → **Connect with GitHub**. Install the Hostinger app for this repo only.
2. Repository: `city-of-fighters/city-of-fighters.github.io`
3. Branch: **`hostinger`** (not `main`)
4. Deploy directory: `public_html`. Back up anything already there first; it gets replaced.
5. Press **Deploy**. Later pushes to `main` update `hostinger`, and Hostinger deploys automatically.

Menu names can change; check https://docs.hostinger.com/websites/git if they differ.

## Step 3: Test before anything else changes

1. In hPanel turn on the SSL certificate and **Force HTTPS**.
2. Open the temporary or final Hostinger address. These must load: `/`, `/app.html`, `/events.html`, `/admin.html`, `/players.html`, `/sponsors.html`, `/studio.html`, `/phone.html`, `/overlay.html`.
3. Check that `/hud/hud-bar.webm` and `/manifest.webmanifest` load, and that `/supabase/` and `/desktop/` return 404.
4. If `.htaccess` causes a 500 error, remove the failing line and report it. It hasn't been tested on Hostinger.

## Step 4: Change the address in the code

Only after the domain works over HTTPS. Replace `https://city-of-fighters.github.io` with the final address in the files below. Don't touch `github.com/city-of-fighters/...` links.

- `desktop/main.cjs` (`SITE`, keep the trailing slash)
- `supabase/functions/cof-startgg/index.ts` (comment and `SITE`, no trailing slash)
- `README.md`, `docs/guide.html`, `docs/setup.html`

Then:

1. Check with `git grep "city-of-fighters.github.io"`. Only `github.com` repo links should remain.
2. Bump `version` in `desktop/package.json`, run `node test.js`, commit, push.
3. Tag the same version (for example `v1.3.3`) and push the tag. GitHub builds the Windows and Linux apps and smoke-tests them.
4. Ask a person to deploy `cof-startgg` with the new code. See step 5.

## Step 5: Server setup in Supabase (a person does this)

Steps with direct links are in `docs/setup.html`.

1. Run the latest `supabase/city-of-fighters.sql` in the SQL Editor.
2. Edge Function Secrets: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SGG_CLIENT_ID`, `SGG_CLIENT_SECRET`.
3. Deploy `cof-startgg`, then turn **Verify JWT with legacy secret** off for it.
4. Create the start.gg OAuth app with the redirect URL `<final address>/events.html` (exact match).
5. Paste the start.gg token in the Control panel's start.gg box.

## Step 6: Check everything

- [ ] Leaderboard shows the current tournament
- [ ] Control panel, Players, Sponsors and Stream log in and work
- [ ] Adding a sponsor reaches `/overlay.html` within 10 seconds
- [ ] Events tab shows start.gg events
- [ ] Log in with start.gg works and returns to `/events.html`
- [ ] Participate works, or opens start.gg's sign-up page
- [ ] Phone Admin shows the live OBS picture
- [ ] A test result reaches start.gg; undo resets it
- [ ] Winner banner email arrives
- [ ] PC app 1.3.3 connects to OBS by itself

## Step 7: Switch off the old site (ask the owner first)

Only when step 6 passes and no event is running:

1. Disable the `Deploy website` workflow (`.github/workflows/pages.yml`).
2. In the repo's Pages settings, unpublish GitHub Pages. Tell the owner first: old links, installed phone apps and old PC apps stop working.

## Step 8: Making the repo private (ask the owner first)

Website files are always readable by visitors; this only hides the repo. Before making it private:

1. **Move the PC installers.** Control panel download links (`public/admin.html`, lines 28 to 30) point at this repo's GitHub Releases, which stop working for the public. Publish them from a small public repo (for example `city-of-fighters/downloads`) and update the links. Don't put them in `public/` or on Hostinger's deploy folder.
2. **Check the keep-awake job still runs.** GitHub can disable scheduled jobs after long inactivity. A paused Supabase project takes the whole app down; see the warning emails sent to the Supabase account.
3. Confirm the Hostinger GitHub app can still read the repo, and press **Redeploy** once to prove it.

## If something goes wrong

- The GitHub Pages site stays up until step 7, so the fix is to go back to it: set the OBS source and PC app back to the old address.
- Hostinger: **Git** → **Redeploy**.
- Login or Participate failing: check the `cof-startgg` logs in Supabase, the `SITE` value and the OAuth redirect URL. They must all match the final address exactly.
- If the old address must stay reachable, keep GitHub Pages published.

## The streaming PC after the switch

Tell the owner to:

1. Change the OBS Browser Source URL to `<final address>/overlay.html`.
2. Install the new PC app.
3. Open the Stream tab and press **Set up Coming Up scene in OBS** so the frame uses the new address.
4. Log in again on each device. Phone users reinstall the app.
