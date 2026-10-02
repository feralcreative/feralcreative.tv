# Architecture

Read before any change that crosses container boundaries or changes the camera set. Root operating rules are in [../AGENTS.md](../AGENTS.md).

## Containers

Three services, one bridge network (`cats-network`). Local definitions are in `docker-compose.yml`; production in `docker-compose.prod.yml`.

| Service | Container | Image | Role |
| --- | --- | --- | --- |
| `web` | `cats-web` | built from root `Dockerfile` | nginx: static files plus reverse proxy |
| `mediamtx` | `cats-mediamtx` | `bluenviron/mediamtx:latest` | RTSP pull from Tapo cameras, optional RTMP publish from OBS, HLS/WebRTC serve |
| `backend` | `cats-backend` | built from `backend/Dockerfile` | Express + ONVIF PTZ proxy |

Locally, `web` is published on 54999 and MediaMTX RTMP is bound to `127.0.0.1:1935` for OBS on this Mac only. `mediamtx` and `backend` are reachable by service name from inside the network, which is exactly how `nginx.conf` addresses them (`http://mediamtx:8888`, `http://backend:3001`).

nginx serves three experiences from the same web image. Its default server uses a `$site_index` host map: the hub loads `index.html`, and the cats hostnames load `cats.html`. Montclair has its own server block with only the `cam_other` stream/status proxies. A separate block redirects www.montclair.tv to the apex.

| Site | Production hostname | Local URL | Page |
| --- | --- | --- | --- |
| Channel dashboard | feralcreative.tv | <http://localhost:54999/> | `index.html` |
| Cats viewer | cats.feralcreative.tv | <http://cats.localhost:54999/> | `cats.html` |
| Montclair viewer | montclair.tv | <http://montclair.localhost:54999/> | `skyline.html` |

cats.feralcreative.co remains a cats-viewer alias during migration. `/admin` on the hub and cats hosts serves the existing four-feed admin grid. The directory itself is public, lists channel names and URLs, and never requests video. Viewer sign-in remains per-origin. `channels.js` supplies canonical channel links and switches them to the matching local hostname in development; it also maps viewer links back to the local hub.

### Domain migration still pending

Local code is prepared for the new hostnames; it does not configure external services. Before releasing the new domains, authorize DNS and Cloudflare Tunnel ingress for feralcreative.tv and cats.feralcreative.tv to the existing web service, add `https://cats.feralcreative.tv` and `https://feralcreative.tv` to the existing Google OAuth client's JavaScript origins (the hub needs it for `/admin`), and deploy the new web image. Keep the existing cats.feralcreative.co and montclair.tv origins and ingress during migration. Do not change container names, published ports, OBS publishing settings, or `deploy.config` as part of this rename.

### Adding a channel

Add a channel list item to `index.html` with its canonical `href` and a unique `data-channel` key. Add that key's `url` and local hostname to `TV_CHANNELS` in `channels.js`. Update the cache-busting query when editing the script. Only add links for channels with actual destinations. A new hosted viewer additionally needs nginx routing, Dockerfile copies, local compose mounts, and separately authorized domain/auth configuration.

The local compose file mounts each frontend file as a read-only volume, so HTML, JS, and CSS edits need no rebuild. It does not mount `nginx.conf`—proxy changes require `docker compose up -d --build web`.

## Ports

| Port | Service | Purpose |
| --- | --- | --- |
| 80 | web | nginx listener (what `nginx.conf` actually binds) |
| 54999 | web | published host port, mapped to container 80 in both compose files |
| 1935 | mediamtx | RTMP container listener; dev binds `127.0.0.1:1935`, production binds `192.168.1.3:1936` |
| 8554 | mediamtx | RTSP |
| 8888 | mediamtx | HLS |
| 8889 | mediamtx | WebRTC/WHEP (proxied but unused) |
| 8189/udp | mediamtx | WebRTC ICE UDP mux |
| 9997 | mediamtx | control API |
| 9998 | mediamtx | metrics |
| 3001 | backend | ONVIF HTTP API |
| 2020 | cameras | ONVIF (Tapo-specific, not 80) |
| 554 | cameras | RTSP |

`docker-compose.prod.yml` publishes every mediamtx port to the NAS host. `docker-compose.yml` publishes only RTMP to loopback; nginx proxies browser requests.

## Camera wiring

The frontend camera keys are `left`, `right`, `top`, and `other`. `other` now represents the optional OBS/USB feed in SKYLINE, replacing the retired bookshelf camera. Only the three Tapo cameras use ONVIF. The wiring is:

| Place | Form |
| --- | --- |
| `cats.html` | `#video-left`, `#status-left`, `#loading-left`, `#error-left` |
| `app.js` | the `cameras` array |
| `mediamtx.yml.template` | `cam_left` and `cam_left_low` path blocks; OBS has only `cam_other` |
| `nginx.conf` | the `cam_left\|cam_right\|…` location regexes and the four `/whep` blocks |
| `backend/server.js` | the three Tapo entries in `CAMERAS`, plus the OBS availability endpoint |

`.env` additionally carries `CAMERA_LEFT_IP` and friends, though only `deploy.config`-driven tooling reads them; `mediamtx.yml.template` and `backend/server.js` both hardcode the IPs.

## Stream naming

mediamtx exposes one path per camera per quality. `stream1` on the camera is high quality and maps to `cam_<key>`; `stream2` is low quality and maps to `cam_<key>_low`. The Tapo grid uses `_low`; the modal uses the high-quality path for one camera at a time. OBS publishes one H.264/AAC rendition to `cam_other`, and both OBS views use `/cam_other/index.m3u8`; MediaMTX does not generate a lower-resolution copy.

HLS playlist URL served to the browser: `/cam_<key>[_low]/video1_stream.m3u8`.

## Config generation

`mediamtx.yml` is not authored. `utils/deploy/hooks/pre-build.sh` runs `envsubst` over `mediamtx.yml.template` with `CAMERA_USER` and `CAMERA_PASS` from `.env`, and also builds `cats-backend:latest`. `deploy.sh` invokes that hook via `PRE_BUILD_HOOK` in `deploy.config`; nothing invokes it during a plain `docker compose up`.

`start-docker.sh` does the same substitution plus `docker-compose up`, and is gitignored.

On deploy, `DATA_FILES="mediamtx.yml"` in `deploy.config` sends the rendered file to `${NAS_DEPLOY_PATH}/data/mediamtx.yml`, which is where `docker-compose.prod.yml` expects to mount it from.

## Auth flow

There is no server-side session. `auth.js` decodes the Google ID token in the browser, checks the email against `CONFIG.ALLOWED_EMAILS`, and persists the whole user object—credential included—in `localStorage` under `user`. `checkSession` restores it without revalidating the token, so a stored session never expires. `hasAdvancedFeatures` gates the PTZ UI against `CONFIG.ADVANCED_FEATURES`.

All of that is client-side and readable by anyone who loads the page. See [decisions.md](decisions.md) for why it is like this and what it does not protect.

## Optional OBS feed

`obs-stream.js` checks `/api/streams/other/status` every four seconds. nginx forwards that exact endpoint to the backend, which checks the internal HLS playlist and returns only `{ "live": true|false }`. No MediaMTX control API access is exposed. When publishing stops, both grid and modal destroy playback and show the off-air slate; when publishing resumes, they attach fresh players. No ONVIF controls are shown for SKYLINE. The local RTMP port is published on loopback. Production RTMP is published as `192.168.1.3:1936:1935`; OBS sends directly to the NAS, independently of the Mac dev stack. See [OBS_SETUP.md](OBS_SETUP.md).
