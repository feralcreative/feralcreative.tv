# Shared Sign-In Client and One Deploy Command

Drafted: 2026-11-13, revised the same day after Codex's review. Status: awaiting Ziad's go-ahead. No code has been changed for this plan.

## Goal

Ziad, 2026-11-13: "I just want a seamless experience for both me developing and my visitors reading." Merging the two repos was considered and rejected the same day: they would still be two containers with two builds, and the CAD library and printer proxy would join the TV site's history.

Two outcomes:

1. A change to the sign-in flow is written once.
2. Deploying is one command that ships whatever changed, in the right order.

A sign-in change will still build two images. What goes away is writing it twice and running, ordering, and checking two deploys by hand.

## Where things stand

- Visitors sign in at the hub (`feralcreative.tv`). Other sites send them there with `?return=&challenge=&path=` and get a one-time code back at their `/signin`. Two direct Google sign-ins remain outside that: this repo's `/admin`, and the 3d site on localhost.
- The browser half of the trip exists twice: `auth.js` and `signin.html` here (cats, Montclair, the hub) and `auth.js` and `public/signin.html` in `~/www/feralcreative/3d.feralcreative.co`.
- The two copies share a core and differ around it. Shared: making the verifier and challenge, saving the return path, building the hub URL, the loop guard, the `#signed-in` marker, redeeming a code at `/signin`, and restoring the path. Only on 3d: `fresh=1` for admin controls, the printer-controls offer, session URLs derived from the proxy, activity logging, `DEV_MODE`, and the localhost Google fallback. Only here: local hub hostnames, the handoff request, the email-link form, and the add-a-Google-account panel. The two `/signin` pages also differ in retry markup, legacy-link handling, and which paths they refuse to return to.
- On 2026-11-13 three sign-in fixes each had to be written twice and deployed twice.
- On the server side, the 3d proxy redeems the code by calling the hub's `POST /api/access/verify`, then sets its own cookie. That call is the contract between the repos that must stay compatible. The proxy also keeps older emailed-link routes.

## Part 1: one source file, copied into each site at build time

### The design

A small file in this repo, `sign-in-core.js`, holds only the shared core listed above. It has no markup and no knowledge of either site. Each site keeps its own `auth.js` and `/signin` page as an adapter that supplies what differs: storage key prefix, hub URL, redeem endpoint, which paths may be returned to, how to draw the card, and what to do after sign-in.

The 3d repo holds a copy at `vendor/sign-in-core.js`, never edited there, the same way the Feral brand layer is vendored between repos. A script, `utils/sync-sign-in-core.sh` in the 3d repo, copies it from this repo. The copy is committed, so a 3d build needs nothing but its own checkout.

Each site serves its copy from its own origin, in its own build. Nothing is loaded across sites.

### What has to be wired

- **This repo.** Add `sign-in-core.js` to the Dockerfile's explicit `COPY` list and to the explicit mounts in `docker-compose.yml`; both are lists, so a new file ships nowhere until it is on them. Load it before `auth.js` on each page and on `signin.html`, with a `?v=` cache-buster like the other scripts.
- **3d repo.** Add `vendor/sign-in-core.js` to Vite's manual classic-script copy list in `vite.config.js`; only files under `public/` are copied on their own. Load it as a classic script immediately before `auth.js` in `index.html`, and on `public/signin.html`. Order matters: `auth.js` uses it at load.

### Why not load one script from the hub

That was the first draft, and Codex's review found it unsafe. A script served by the hub would run on the 3d site's own origin, with whatever that visitor's session allows. For an admin that includes the printer, upload, and G-code endpoints, so a fault in the hub's delivery would become code running on the printer site. A hub deploy would also change, at once, the code running on a 3d site that had not been deployed, with no way to roll one back without the other. And if the script failed to load, nothing on the 3d site could finish a sign-in. Copying at build time has none of those problems: each site runs only code from its own build, and each build is a known pair.

### Keeping the copies honest

- The one deploy command (Part 2) refuses to start if the 3d repo's copy differs from this repo's file, and says to run the sync script.
- The contract between the core and its adapters is a short list of named functions, written at the top of the file. A change that breaks it changes both adapters in the same piece of work.
- The proxy-to-hub verify call stays backward compatible: new fields are optional, and nothing is removed without both sites deployed.

## Part 2: one deploy command

A script in this repo, `utils/deploy/family.sh`. It is the only thing Ziad runs.

1. **Preflight, before anything is built.** Each repo is on `main`, clean, and level with `origin/main`. The 3d repo's vendored core matches this repo's. Docker is running. A build container can reach the npm registry with a valid certificate (the 2026-11-13 Zscaler failure: intercepted HTTPS made `npm ci` install nothing and exit 0). The NAS answers over SSH. Any failure stops here with the reason.
2. **Work out what changed.** Read each site's live commit (see below) and compare it with `main`. List the sites that differ.
3. **Confirm once.** Show the list and the commits, and ask for one `yes`.
4. **Deploy in order.** Hub first, then 3d, stopping at the first failure.
5. **Verify and report.** Read each site's live commit back and fail loudly on a mismatch. Report what shipped and what was already current.

Each repo's own deploy script keeps working by itself. The 3d site's `utils/models.sh --push` stays separate: publishing models is not a code deploy.

### What that needs from the existing scripts

- **A live commit to read.** The 3d Docker build cannot see `.git` (it is in `.dockerignore`), so its deploy script must pass the commit in as a build argument. That script, `utils/deploy/prod.sh`, is private and ignored by git, so the change is made on Ziad's Mac and cannot be a PR. Each site then serves the commit and build time from a `no-store` endpoint: a static `version.json` for the pages, and for the hub also `GET /api/version` from the backend, because a fresh web container does not prove the backend container was replaced. Both repos are private, so a hash names a commit without exposing it.
- **One confirmation.** The 3d script always asks for `yes`; this repo's asks nothing and has no git checks. `family.sh` does the checks and the asking, then runs each with an environment flag that the 3d script accepts in place of its prompt. Run directly, the 3d script still asks.
- **Purge.** Both scripts treat a failed Cloudflare purge as a warning. `family.sh` reports it in its summary so it is not lost in the scroll.

## Order of work

Each step leaves both sites working, and each diff is reviewed by Codex.

1. **Hub: extract the core.** Create `sign-in-core.js`, make this repo's `auth.js` and `signin.html` adapters over it, and add it to the Dockerfile and compose lists. No behavior change.
2. **Browser test the hub's sites** against the matrix below, and deploy the hub alone.
3. **3d: adopt it.** Add the sync script and the vendored copy, wire Vite and `index.html`, and reduce `auth.js` and `public/signin.html` to adapters. No behavior change. Browser test, then deploy 3d alone.
4. **Live commit.** `version.json` in both builds, `GET /api/version` on the hub backend, and the build argument in the 3d deploy script.
5. **`utils/deploy/family.sh`**, with the preflight checks and the prompt flag.
6. **Docs.** One description of the flow, in this repo's `docs/api.md`; the 3d repo's points at it. Both `AGENTS.md` files gain the vendoring rule and the deploy command.

## Test matrix

Run in a fresh incognito window, on cats, Montclair, and 3d:

- Signed out, open a deep link, sign in with Google: land on the deep link.
- Signed out, open a deep link, ask for an emailed link, open it in a new tab: land on the deep link.
- Signed in at the hub already: one automatic hop and back, nothing to click.
- An account without that channel: stays at the hub with the reason.
- 3d admin whose hub sign-in is over a day old: arrives as a viewer, and "Sign in again for admin controls" goes through `fresh=1`.
- Cookies blocked for the site: the card appears after one round trip, with no loop.
- Hub unreachable: the site's card still appears, and its link works once the hub is back.
- Sign out on each site: signed out of the hub too.
- `/admin` here, and 3d on localhost: direct Google sign-in still works.

## Not doing

- Merging the repos.
- Loading sign-in code from one site onto another.
- One cookie shared across sites. `montclair.tv` and `feralcreative.co` are different domains from `feralcreative.tv`, and the hub's cookie is deliberately host-only.
- Changing who may sign in, or how the hub decides.

## Codex review, 2026-11-13

Codex reviewed the first draft against both repos and advised against it as written. Every finding was checked against the code and accepted:

- The hub-served script would have run with an admin's access on the printer site, executed for signed-in visitors too, and left no working fallback: the design changed to a vendored copy.
- A hub-first rollout would have changed a not-yet-deployed 3d site: each site now runs only its own build.
- The new hub file would not have shipped: the Dockerfile and compose lists are now named.
- The copies differ in more than names: the shared part is now a small core with per-site adapters.
- Script order on the 3d page and Vite's manual copy list: now named.
- "Takes effect at once" was unproven: dropped with the cross-site script.
- `version.json` could not know its commit, a web commit does not prove the backend, and the two deploy scripts prompt differently: all three are now in Part 2.
- Two baseline facts were overstated (direct Google sign-ins still exist; the server half is not wholly single): corrected above.

## Questions for Ziad

1. Is "written once, one command, two builds" enough, given that loading one live script was ruled out?
2. May `utils/deploy/prod.sh` in the 3d repo (private, on this Mac) be edited to pass the commit into the build and to accept the no-prompt flag from `family.sh`?
