# cats.feralcreative.co

Live view of three TP-Link Tapo C211 cameras plus an optional OBS/USB camera in the SKYLINE tile. Static frontend served by nginx, RTSP→HLS conversion by mediamtx, PTZ control by a small Express/ONVIF backend. Production runs as three Docker containers on a Synology NAS behind Cloudflare. The same `cats-web` container also serves https://montclair.tv, a single-page view of only the SKYLINE feed (`skyline.html`), selected by nginx `server_name`.

When a change makes anything in this file inaccurate—a command, a path, a convention, a prohibition—update this file in the same change.

## Commands

| Task | Command |
| --- | --- |
| Install (root, sass only) | `npm install` |
| Install (ONVIF backend) | `cd backend && npm install` |
| Compile SCSS once | `npx sass styles/scss:styles/css --style compressed` |
| Watch SCSS | `npm run watch:css` |
| Start everything, open browser | `npm start` |
| Start everything, no browser | `npm run start:no-open` |
| Start containers only | `npm run dev` |
| Stop local stack | `npm run dev:stop` |
| Force-kill local stack | `npm run dev:kill` |
| Rebuild images locally | `docker compose up -d --build` |
| Regenerate `mediamtx.yml` from template | `bash utils/deploy/hooks/pre-build.sh` |
| Run backend outside Docker | `cd backend && npm run dev` |
| Deploy to production | `./utils/deploy/prod.sh` |
| Production container status | `./utils/deploy/deploy-utils.sh status` |
| Production logs | `./utils/deploy/deploy-utils.sh logs` |

There is no test suite, no linter, and no typechecker. Do not invent one without being asked.

`npm start` (`utils/start.sh`) compiles SCSS, starts a `sass --watch`, opens `http://localhost:54999/` once nginx answers, and runs `docker compose up --build` in the foreground. Ctrl+C stops the stack and the watcher. It refuses to start if `.env`, `mediamtx.yml`, or `node_modules` is missing, and names the fix. `OPEN_BROWSER=0` or `npm run start:no-open` skips the browser.

`npm run dev` is the bare `docker-compose up` with no watcher and no browser. There is no BrowserSync and no `dev:all` script, whatever older docs claim.

`./utils/deploy/deploy-utils.sh` also accepts `restart`, `stop`, `start`, `shell`, `backup`, `restore`, `update-data`, and `help`. Every subcommand SSHes to the NAS.

## Definition of done

1. `npm start`. It compiles SCSS, rebuilds changed images, and opens the page for you.
2. Confirm all three containers are up and `cats-web` reports healthy: `docker ps --filter name=cats-`.
3. Check the browser console. Off the camera LAN, expect RTSP failures for the three Tapo tiles and an off-air SKYLINE tile when OBS is stopped; that is not your change breaking.
4. Tear down when finished: Ctrl+C, then `npm run dev:stop` to remove the containers.

Not required: any test run, any lint run, or a production deploy. Never deploy as part of "finishing" a change.

## Prohibitions

- **Never commit `mediamtx.yml`.** It is generated from `mediamtx.yml.template` by `utils/deploy/hooks/pre-build.sh` and contains live RTSP credentials. It is currently tracked in git despite being listed in `.gitignore`; leave the removal to a human (see Gotchas).
- **Never put a credential in `docker-compose.prod.yml`.** It currently hardcodes `CAMERA_USER` and `CAMERA_PASS`. Both belong in `.env` and must reach the container through `environment:` interpolation, the way `docker-compose.yml` does it.
- **Never hand-edit `mediamtx.yml`, `styles/css/*`, or either `package-lock.json`.** Edit `mediamtx.yml.template`, `styles/scss/*`, and `package.json` respectively.
- **Never edit `mediamtx.yml.example`.** It is a stale leftover, not the template. `mediamtx.yml.template` is the live one.
- **Never run `./utils/deploy/prod.sh` or `./utils/deploy/stage.sh`**, and never run any `deploy-utils.sh` subcommand, without explicit per-run permission. All of them reach the production NAS over SSH and `prod.sh` purges the Cloudflare cache.
- **Never add a secret to `config.js`, `auth.js`, `app.js`, or `onvif-controls.js`.** These scripts and `obs-stream.js` are served verbatim to the browser; never put publishing credentials in them.
- **Never treat the `config.js` allowlists as a security boundary.** `ALLOWED_EMAILS` and `ADVANCED_FEATURES` are client-side only; anyone can read and bypass them.
- Adding a dependency, changing the Google OAuth client, changing a published port, or touching `deploy.config` needs human approval first.

## Credentials

`.env` is the only source of local secrets. `.env.example` is the canonical key list—read it rather than duplicating keys here.

| Variable | Source | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `.env` | Needs `Zone.Cache Purge` scope; used only by `deploy.sh` |
| `CLOUDFLARE_ZONE_ID` | `.env` | Zone for `cats.feralcreative.co` |
| `CAMERA_USER`, `CAMERA_PASS` | `.env` | Tapo camera account (Tapo app → Settings → Advanced Settings → Camera Account), not the Tapo login |
| `CAMERA_*_IP` | `.env` | Static LAN IPs; also hardcoded in `mediamtx.yml.template` and `backend/server.js` |
| `TEST_MODE` | `.env` | `true` makes the backend mock all PTZ calls |
| `GOOGLE_CLIENT_ID` | `config.js` | Public by design, not a secret |

`.env`, `*.env`, `mediamtx.yml`, `styles/css/*`, and `CONSOLE.txt` are gitignored. Never read a file matching those into a commit, a log, or a chat response.

## Architecture

Request path for a camera tile:

1. Browser loads `index.html`, which pulls `config.js`, `auth.js`, `obs-stream.js`, `app.js`, and `onvif-controls.js` as plain scripts—no bundler, no modules, all globals.
2. `auth.js` gates everything. Cameras start only from `GoogleAuth.onAuthStateChanged`, which calls the global `initializeCameras`. On localhost with `CONFIG.DEV_MODE` true it fabricates a `dev@feralcreative.co` user and skips Google entirely.
3. `app.js` `tryHLSFallback` requests `/cam_<name>_low/video1_stream.m3u8` for each grid tile; `loadModalStream` requests `/cam_<name>/video1_stream.m3u8` for the expanded modal.
4. nginx (`nginx.conf`) proxies those paths to `mediamtx:8888`, and `/api/onvif/` to `backend:3001`.
5. mediamtx pulls RTSP from each camera per its `paths:` block in `mediamtx.yml`—`stream1` is high quality, `stream2` is low.
6. PTZ: `onvif-controls.js` POSTs to `/api/onvif/<camera>/ptz/move` and `/ptz/stop`; `backend/server.js` translates those to ONVIF `continuousMove` and `stop` on camera port 2020.

Camera keys are `left`, `right`, `top`, and `other` in the frontend and stream paths. Only `left`, `right`, and `top` belong to the ONVIF `CAMERAS` map. Physical assignments are LEFT `.201`, RIGHT `.203`, and TOP `.202`; keep stream sources and ONVIF targets aligned. `other` is the optional OBS feed shown as SKYLINE; the old bookshelf camera at `.204` is retired. OBS uses `cam_other/index.m3u8` for both views, has no ONVIF controls, and uses `obs-stream.js` to poll `/api/streams/other/status` every four seconds. Adding or renaming a camera means checking all frontend, nginx, MediaMTX, and backend wiring.

Dependencies flow one way: frontend → nginx → (mediamtx | backend). Nothing reads back. The backend holds no state beyond its in-memory `devices` map, and there is no database.

Deeper detail: [docs/architecture.md](docs/architecture.md).

## Conventions

- Plain ES2017+ browser JS, double quotes, semicolons, two-space indent, no build step. Each concern is one class or one flat set of functions on `window`.
- Log with a bracketed tag: `[AUTH]`, `[ONVIF]`, or `` [`${camera}`] `` in `app.js`. Match the surrounding tag rather than inventing one.
- Frontend errors are caught, logged to console, and surfaced by toggling the matching `#error-<camera>`, `#loading-<camera>`, and `#status-<camera>` elements. Tapo status text is one of `Connecting...`, `Connected`, or `Error`, with the class set to `status connecting|connected|error`. The optional OBS feed additionally uses `Off air` / `status offline`; its slate is expected when OBS is stopped and automatically clears when playback starts.
- Backend errors return `{ "error": "<message>" }` with 404 for an unknown or unconnected camera and 500 for an ONVIF failure.
- SCSS lives in `styles/scss/` on the 7-1 pattern. Every partial declares its own `@use "../abstracts/variables" as *`. Only use color variables that `styles/scss/abstracts/_variables.scss` actually defines.
- Label every media query with `//@ Label` on the line above, as `main.scss` already does.
- Most of `styles/scss/` (the `pages/`, `vendors/`, and unused `components/` partials) is unreferenced boilerplate from `template.zip`. Do not extend it; only `main.scss` and the partials it imports reach the output.
- Bump the `?v=` query string on a changed script or stylesheet in `index.html`—nginx caches CSS and JS for an hour.

## Gotchas

- **Local OBS publishing uses `127.0.0.1:1935`.** This port is bound only to the Mac loopback interface. Set OBS Server to `rtmp://127.0.0.1:1935` and its masked Stream Key to `cam_other?user=<encoded username>&pass=<encoded password>` using the camera account. Leave OBS's separate Use authentication checkbox disabled; MediaMTX authenticates RTMP through those query parameters. See `docs/OBS_SETUP.md`. Production is configured at `rtmp://192.168.1.3:1936`, mapped to MediaMTX port 1935 on the NAS LAN; OBS currently publishes there. Port 1935 on the NAS is occupied by another service. Future remote changes require explicit approval.

- **54999 is the host port, 80 is the container port.** nginx listens on 80; `docker-compose.yml` and `docker-compose.prod.yml` both publish it as `54999`. Do not "fix" one side to match the other. Until 2026-09-11 the local compose file published `54999:54999` and the `Dockerfile` probed 54999, so the host port served nothing and `cats-web` never went healthy; both are corrected.
- **`docker compose up` does not compile SCSS and does not regenerate `mediamtx.yml`.** The build copies `styles/` from the working tree, and `styles/css/` is gitignored, so a fresh clone builds an unstyled site. `npm start` handles the SCSS half; `mediamtx.yml` still needs `utils/deploy/hooks/pre-build.sh`, which only `prod.sh` runs for you.
- **MediaMTX auth is `authInternalUsers` in `mediamtx.yml.template`.** Anyone may read; the camera account (`CAMERA_USER`/`CAMERA_PASS`) may publish `cam_other` and use the API on 9997, which the backend needs for feed on/off. Changing the template means regenerating `mediamtx.yml` (`bash utils/deploy/hooks/pre-build.sh`) and restarting `cats-mediamtx`. MediaMTX still logs `skipping track 2 (G711)` per Tapo path because HLS cannot carry the cameras' G.711 audio; the site plays muted, so nothing is lost.
- **The frontend is HLS-only.** `index.html` still loads the WHEP client from a CDN and `nginx.conf` still proxies `/cam_*/whep`, but no code path calls WHEP. The `whepClients` map in `app.js` holds `Hls` instances. README and older docs describing "WebRTC primary with HLS fallback" are stale.
- **The `visibilitychange` handler reconnects every camera every time the tab is focused.** It tests `pc.connectionState` on what is actually an `Hls` instance, so the value is always `undefined`. Do not read it as evidence that WebRTC is live.
- **`config.js` ships `DEV_MODE: true`.** It only takes effect on `localhost`/`127.0.0.1`, so production still requires Google sign-in, but any local session silently runs as an advanced user with PTZ access.
- **The ONVIF API is unauthenticated.** `requireAdvancedFeatures` in `backend/server.js` is a pass-through with a TODO. Anything that can reach `/api/onvif/` can move the cameras.
- **ONVIF controls use the same-origin `/api` proxy in every environment.** Localhost requests reach the local backend through nginx; no Tailscale address or separately published backend port is required.
- **Cameras are LAN-only** (`192.168.1.201`–`203`). Off the home network, streams cannot load at all. Set `TEST_MODE=true` in `.env` to mock PTZ; see [docs/REMOTE_TESTING.md](docs/REMOTE_TESTING.md). There is no equivalent mock for video.
- **ONVIF is on port 2020, not 80.** `backend/server.js` hardcodes it; Tapo firmware does not use the ONVIF default.
- **`mediamtx.yml` is both gitignored and tracked**, so git keeps versioning it and every regeneration shows up as a diff full of credentials. Do not `git add -A` blindly in this repo—check `git status` first.
- **`utils/deploy/hooks/pre-build.sh` and `start-docker.sh` load `.env` via `export $(cat .env | xargs)`**, which breaks on any value containing whitespace or shell metacharacters. If a credential stops working after a rotation, suspect the quoting before the credential.
- **`/site.webmanifest` and `/images/web-app-manifest-*.png` are referenced by `index.html` but do not exist**, so every page load logs three 404s. Ignore them, or add the files; do not chase them as a regression.
- **`npx sass` emits two `@import` deprecation warnings** from the end of `styles/scss/main.scss`. Converting them to `@use` requires moving them above all rules in the file, which reorders the emitted cascade—not a drop-in fix. The build otherwise succeeds.
- **montclair.tv is a second nginx `server` block, not a second site.** It serves `skyline.html` for every page path, 404s `/index.html`, and proxies only `/cam_other/` and `/api/streams/other/status`—no ONVIF, no Tapo streams. The cats block is `default_server`, so any unmatched host still gets the cat grid. Locally, test it at `http://montclair.localhost:54999/`; `auth.js` treats any `*.localhost` host as localhost for `DEV_MODE`. `www.montclair.tv` 301s to the apex (a Cloudflare redirect rule on the montclair.tv zone, with the nginx `server` block as a fallback), so only `https://montclair.tv` needs to be in the Google OAuth client's authorized JavaScript origins (project `3d-feralcreative-co`). DNS for both hostnames is a proxied CNAME to the shared Cloudflare Tunnel, whose ingress routes them to `localhost:54999` alongside `cats.feralcreative.co`; there is no DSM reverse-proxy rule. Sign-in is per-origin, so viewers sign in separately on each domain. A new static file must be added to the `Dockerfile` `COPY` list.
- **`docs/SYNOLOGY_DEPLOYMENT.md` is template boilerplate**, referencing `npm run docker:build` and a `template-feralcreative` image that do not exist here. Use [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Commit and PR conventions

- Conventional Commits, imperative mood: `type(scope): subject`. Types in use: `feat`, `fix`, `chore`, `refactor`, `docs`, `style`.
- The agent commits on the user's behalf in logical blocks (one feature, fix, or refactor step per commit). Stage paths explicitly rather than `git add -A`, because `mediamtx.yml` is tracked (see Gotchas). Pushing and deploying still need explicit permission.

- Never add AI attribution to a commit message or PR body—no `Co-Authored-By`, no generated-with footer.
- Never commit `.env`, `mediamtx.yml`, `styles/css/*`, `CONSOLE.txt`, or anything under `_TASKS/` or `_archive/`.
- `main` is the only branch. Branch before committing if asked to work on a branch.

## Deep-dive index

- [docs/OBS_SETUP.md](docs/OBS_SETUP.md)—optional USB camera, OBS publishing, offline behavior, local and production RTMP publishing.

- [docs/architecture.md](docs/architecture.md)—container topology, ports, stream paths, camera key wiring. Read before any cross-cutting or camera-count change.
- [docs/api.md](docs/api.md)—ONVIF backend endpoints and mediamtx stream URLs. Read before touching `backend/server.js`, `onvif-controls.js`, or `nginx.conf`.
- [docs/decisions.md](docs/decisions.md)—why HLS over WebRTC, why the NAS, why client-side auth. Read before "fixing" something that looks wrong.
- [docs/debugging.md](docs/debugging.md)—log locations, known failure modes, health checks. Read first when a stream or PTZ call fails.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)—release process to the NAS, environments, rollback.
- [docs/REMOTE_TESTING.md](docs/REMOTE_TESTING.md)—working away from the camera LAN.
- [docs/ONVIF_IMPLEMENTATION.md](docs/ONVIF_IMPLEMENTATION.md)—PTZ implementation detail and advanced-user gating.
- [utils/deploy/QUICK_REFERENCE.md](utils/deploy/QUICK_REFERENCE.md)—deploy script command reference.
