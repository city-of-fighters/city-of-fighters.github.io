# Move City of Fighters to Hostinger

Instructions for the Claude (and the person) doing this move. Follow them in order.
Written 6 November 2026. The site runs on GitHub Pages at https://cityoffighters.com and must keep working until Hostinger is proven.

**The address doesn't change in this move.** The code, PC app, OBS link and start.gg redirect URL already use `cityoffighters.com`. Only the Hostinger files and the domain's DNS records change.

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
- [ ] `cof-startgg` function: **not deployed**; its code already uses the final address
- [x] start.gg token: saved (Settings tab). Test mode is on, so nothing is sent to start.gg
- [x] Domain: `cityoffighters.com` registered at Porkbun, pointing at GitHub Pages with HTTPS on
- [ ] Nothing has been tested against the real start.gg

Re-check these rather than trusting this list.

## What the people must do

Only a person can do these. Ask for them when you reach that step:

- Give the Hostinger account access to the GitHub repo (the GitHub popup in step 2).
- Change the DNS records at Porkbun.
- Run SQL in Supabase and paste secrets into Supabase.
- Create the start.gg token and OAuth app.

## Step 1: Hostinger plan and domain

1. Confirm the plan supports Git deployment: web or cloud hosting with a custom PHP/HTML website. It isn't available on agency hosting.
2. Add the website in hPanel as `cityoffighters.com`, as an existing domain. **Don't buy the domain again.** It stays registered at Porkbun, and DNS stays pointing at GitHub until step 7.

## Step 2: Connect GitHub

The `hostinger` branch should already exist. If it doesn't, run the "Prepare Hostinger branch" workflow.

1. hPanel → the website → **Advanced** → **Git** → **Connect with GitHub**. Install the Hostinger app for this repo only.
2. Repository: `city-of-fighters/city-of-fighters.github.io`
3. Branch: **`hostinger`** (not `main`)
4. Deploy directory: `public_html`. Back up anything already there first; it gets replaced.
5. Press **Deploy**. Later pushes to `main` update `hostinger`, and Hostinger deploys automatically.

Menu names can change; check https://docs.hostinger.com/websites/git if they differ.

## Step 3: Test before anything else changes

1. Open Hostinger's temporary preview address for the site.
2. These must load: `/`, `/app.html`, `/events.html`, `/admin.html`, `/players.html`, `/sponsors.html`, `/studio.html`, `/phone.html`, `/overlay.html`.
3. Check that `/hud/hud-bar.webm`, `/manifest.webmanifest`, `/downloads/City-of-Fighters.apk` and `/.well-known/assetlinks.json` load, and that `/supabase/` and `/desktop/` return 404. Without `assetlinks.json` the Android app shows a browser bar.
4. If `.htaccess` causes a 500 error, remove the failing line and report it. It hasn't been tested on Hostinger.

## Step 4: Switch the domain (ask the owner first; not during a tournament or stream)

1. Get the A record address (or addresses) for this website from hPanel. Look it up there; don't guess it.
2. The owner opens Porkbun DNS for `cityoffighters.com` and replaces the four GitHub A records (`185.199.108.153` to `.111.153`) with Hostinger's. If hPanel gives a value for `www`, replace that CNAME too. Don't change the nameservers.
3. When DNS shows the new address, turn on the SSL certificate and **Force HTTPS** in hPanel. The site can show a certificate warning until then.
4. Confirm https://cityoffighters.com and https://www.cityoffighters.com load from Hostinger.

## Step 5: Server setup in Supabase (a person does this)

Steps with direct links are in `docs/setup.html`.

1. Run the latest `supabase/city-of-fighters.sql` in the SQL Editor.
2. Edge Function Secrets: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SGG_CLIENT_ID`, `SGG_CLIENT_SECRET`.
3. Deploy `cof-startgg`, then turn **Verify JWT with legacy secret** off for it.
4. Create the start.gg OAuth app with the redirect URL `<final address>/events.html` (exact match).
5. Settings tab → start.gg: test mode stays on unless the owner says otherwise.

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

## Step 7: Switch off GitHub Pages (ask the owner first)

Only when step 6 passes:

1. Remove the custom domain from the repo's Pages settings. Do this after DNS has moved, otherwise the live site breaks.
2. Disable the `Deploy website` workflow (`.github/workflows/pages.yml`).
3. The old `city-of-fighters.github.io` links stop working once Pages is off. Installed PC apps from 1.3.3 and phone apps use the new address, so they keep working. Older PC apps need updating.

## Step 8: Making the repo private (ask the owner first)

Website files are always readable by visitors; this only hides the repo. Before making it private:

1. **Move the PC installers.** Control panel download links (`public/admin.html`, lines 28 to 30) point at this repo's GitHub Releases, which stop working for the public. Publish them from a small public repo (for example `city-of-fighters/downloads`) and update the links. Don't put them in `public/` or on Hostinger's deploy folder.
2. **Check the keep-awake job still runs.** GitHub can disable scheduled jobs after long inactivity. A paused Supabase project takes the whole app down; see the warning emails sent to the Supabase account.
3. Confirm the Hostinger GitHub app can still read the repo, and press **Redeploy** once to prove it.

## If something goes wrong

- **Fastest fix:** the owner puts the four GitHub A records back in Porkbun. The site returns to GitHub Pages as long as step 7 hasn't been done.
- Hostinger: **Git** → **Redeploy**.
- Login or Participate failing: check the `cof-startgg` logs in Supabase and the OAuth redirect URL, `https://cityoffighters.com/events.html`.

## Android app

- The APK is `public/downloads/City-of-Fighters.apk`, so it moves with the website. It doesn't need rebuilding for this move, because the domain stays the same.
- New version: raise `appVersionCode` and `appVersionName` in `android/twa-manifest.json` and `versionCode`/`versionName` in `android/app/build.gradle`, run the **Build Android app** workflow, and replace the APK with the one from that run.
- It's signed with a private key in GitHub secrets (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`). The owner holds the only copy of the key file. Never put it in the repo. If the key changes, `assetlinks.json` must change too, and installed apps can't update.

## The streaming PC

Nothing changes for this move: the OBS link, PC app and phone app already use `cityoffighters.com`.
