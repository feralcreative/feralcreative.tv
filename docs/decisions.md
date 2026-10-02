# Decisions

Why things are the way they are. Read this before "fixing" something that looks wrong—several of the odd choices here are deliberate.

## HLS, not WebRTC

**Chosen:** HLS via mediamtx, low-latency variant, `hls.js` in non-Safari browsers and native HLS in Safari.

**Rejected:** WebRTC over WHEP, which was the original plan and is still half-wired—`cats.html` loads `@eyevinn/whep-web-client`, `nginx.conf` proxies `/cam_*/whep`, and `mediamtx.yml` still enables WebRTC on 8889 with a Google STUN server.

**Why:** TBD. No commit message, task file, or doc in the repo records the reason, and the switch landed inside the squashed `updates and fixes` commit. The surviving evidence is `CONSOLE.txt`, a console dump in which every `/cam_*/whep` request 404s, and `webrtcICEHostNAT1To1IPs: []` left empty in `mediamtx.yml`—consistent with WHEP never working through the Docker bridge, but not proof. Ask before acting on that reading.

**Cost accepted:** a few seconds of latency instead of sub-second.

**Do not** delete the WHEP leftovers as dead code without asking—they document the fallback path and a return to WebRTC has not been ruled out.

## Low-quality streams in the grid, high-quality in the modal

The grid pulls `cam_<key>_low` (camera `stream2`) and only the expanded modal pulls full quality, one camera at a time. The recorded reason is bandwidth on the main page, where four feeds run at once ([ONVIF_IMPLEMENTATION.md](ONVIF_IMPLEMENTATION.md)). This is why `app.js` has two load paths that look redundant.

## `sourceOnDemand: no` and `hlsAlwaysRemux: yes`

mediamtx pulls RTSP continuously and keeps playlists warm with nobody watching, at the cost of constant RTSP traffic on the LAN and constant CPU on the NAS. The reason is TBD and not recorded anywhere in the repo; the obvious candidate is first-frame latency on the grid. Do not flip either setting to save resources without confirming that.

## Client-side auth only (superseded 2026-10-01)

Replaced by server-side sessions and an access list edited in `/admin`; see [api.md](api.md#access-and-sessions). The original reasoning is kept below.


**Chosen:** Google Sign-In in the browser, email allowlist in `config.js`, no server-side verification.

**Why:** TBD as a stated decision, but the shape of the stack constrains it: there is no application server to verify a token against, since nginx serves static files and the ONVIF backend is a thin proxy. Real verification means adding a session layer to the backend and putting it in front of the stream paths too. The README lists "Google Auth whitelist for access" as a roadmap item, so what shipped is plausibly a first pass rather than a final answer.

**What it does and does not do:** it keeps the URL from being casually shareable and it hides the PTZ UI from ordinary viewers. It does not protect the streams or the PTZ API. Anyone who reads `app.js` can fetch the playlists directly, and anyone who can reach `/api/onvif/` can move the cameras. `requireAdvancedFeatures` in `backend/server.js` is a deliberate placeholder, not an oversight—the TODO is the record of that.

Treat this as a known accepted risk on a low-value target, not as something to quietly harden mid-task.

## Synology NAS instead of cloud hosting

Hardware was already owned, the cameras are on the same LAN so there is no egress of raw RTSP, and there is no recurring cost. The trade-offs are home upload bandwidth, no autoscaling, and manual infrastructure. Docker keeps dev and prod close enough that the NAS specifics stay in `deploy.config`.

## `prod.sh` and `stage.sh` wrappers over one `deploy.sh`

The wrappers exist for an Alfred snippet: the user types `./utils/deploy/.sh` and inserts `prod` or `stage` before the extension. Each wrapper sets `DEPLOY_ENV` and execs `deploy.sh`, which reads `deploy.config`. One script, configuration-driven, so a new environment is a config block rather than a new script.

Staging is defined (`stage.cats.feralcreative.co`, `cats-stage`) but unused. It is kept for consistency with the user's other projects; do not delete it.

## Image transfer over `docker save | ssh`, not a registry

`deploy.sh` pipes `docker save … | gzip` straight into `ssh … docker load`, and pipes files with `cat | ssh "cat > …"` rather than `scp`. No registry to run or pay for, and the pipe proved more reliable than `scp` against the Synology SSH configuration.

## Vanilla JS, no build step

Four scripts loaded as globals with `?v=` cache-busting. The app is one page with four videos and a modal; a bundler would add a build to break and nothing else. This is why `app.js` uses globals like `initializeCameras` and `window.onvifControls` rather than modules—`auth.js` calls into `app.js` by name.

## `styles/scss/` boilerplate

The 7-1 tree came from `template.zip`, still sitting in the repo root, and most of it (`pages/`, `vendors/`, most of `components/`) is unreferenced. Why it was kept rather than pruned is TBD. Only `main.scss` and the two partials it imports affect output. Do not build on the unused partials, and do not spend a task deleting them unasked.

## ONVIF on port 2020

Tapo firmware serves ONVIF on 2020, not the ONVIF default. `backend/server.js` hardcodes it. This is camera firmware behavior, not a configuration mistake.
