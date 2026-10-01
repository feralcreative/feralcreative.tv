# API

Two surfaces: the ONVIF control API in `backend/server.js`, and the HLS stream paths mediamtx serves. Neither is versioned.

## ONVIF backend

Base path is `/api/onvif/` through nginx, or `http://<host>:3001/api/onvif/` directly. `:camera` is one of `left`, `right`, or `top`. SKYLINE (`other`) is an OBS/USB feed without ONVIF.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| `GET` | `/health` | none | `{ "status": "ok", "cameras": ["left", …] }` |
| `GET` | `/api/onvif/:camera/capabilities` | none | `{ capabilities, profiles, videoSources }` |
| `POST` | `/api/onvif/:camera/ptz/move` | `{ "x": -1…1, "y": -1…1, "zoom": -1…1 }` | `{ "success": true }` |
| `POST` | `/api/onvif/:camera/ptz/stop` | none | `{ "success": true }` |
| `POST` | `/api/onvif/:camera/ptz/preset/:presetToken` | none | `{ "success": true }` |

Notes that bite:

- `/health` is served at the root, not under `/api/`, and nginx only proxies `/api/onvif/`. The backend health endpoint is therefore unreachable from the browser; nginx answers its own `/health` with a static `healthy` string instead.
- All omitted axes default to `0`, so a `move` body of `{ "zoom": 0.5 }` zooms without panning.
- `move` starts a continuous movement and does not stop on its own. The client must POST `ptz/stop`. `onvif-controls.js` does this on `mouseup`, `mouseleave`, and `touchend`.
- `home` in the UI sends `{ x: 0, y: 0 }`—a zero-velocity move, not a preset recall. It does not return the camera anywhere. Use `ptz/preset/:presetToken` for a real recall.
- `onvif-controls.js` guards with a single `isMoving` flag, so a second direction pressed before the first is released is dropped.
- With `TEST_MODE=true` every PTZ route returns `{ "success": true, "test": true }` without touching a camera. `capabilities` has no test branch: the mock device is the string `"mock"`, so the route passes its 404 guard and returns an object of `undefined` fields, serialized as `{}`.

Errors: `404 { "error": "Camera not found or not connected" }` when the key is unknown or that camera failed to connect at startup; `500 { "error": "<onvif message>" }` on an ONVIF failure. A camera that is offline when the backend boots is never retried—restart the backend after the camera comes back.

No authentication. `requireAdvancedFeatures` is a pass-through with a TODO.

## Stream paths

Served by mediamtx on 8888, proxied by nginx.

| URL | Source |
| --- | --- |
| `/cam_<key>/video1_stream.m3u8` | camera `stream1`, high quality—used by the modal |
| `/cam_<key>_low/video1_stream.m3u8` | camera `stream2`, low quality—used by the grid |

`.m3u8` responses are proxied with no-store cache headers; `.ts` and `.mp4` segments get `max-age=10`. Both have 10s proxy read timeouts, so a stalled camera surfaces as a 504 rather than hanging.

`hlsAlwaysRemux: yes` in `mediamtx.yml` keeps the playlists live even with no viewer, and `sourceOnDemand: no` keeps mediamtx pulling RTSP continuously. Both are deliberate; see [decisions.md](decisions.md).

WHEP endpoints (`/cam_<key>/whep` → `mediamtx:8889`) are still proxied in `nginx.conf` and the WHEP client is still loaded in `index.html`, but nothing calls them.

## OBS availability

`GET /api/streams/other/status` returns `{ "live": true }` when MediaMTX serves the OBS HLS playlist, or `{ "live": false }` when no publisher is active. Upstream failures return HTTP 503 with `{ "live": false }`. Responses are never cached. Both OBS views use `/cam_other/index.m3u8`; there is no OBS `_low` rendition.

## Feed control

Implemented in `backend/feeds.js`; the admin UI is `/admin` (`admin.html`, `admin.js`, reusing `app.js` and `obs-stream.js`), the same live camera grid as the cats page with an on/off switch in each tile header, served only by the cats server block.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/feeds` | none | — | `{ "feeds": { "<key>": { "name": "LEFT", "enabled": true } } }` |
| PUT | `/api/feeds/<key>` | `Authorization: Bearer <Google ID token>` | `{ "enabled": false }` | same shape as GET |

Feed keys are `left`, `right`, `top`, and `other`. Turning a feed off fetches each of its MediaMTX path configs (`cam_<key>` and `cam_<key>_low`, or just `cam_other`), saves them to `/app/state/feeds.json` (host `data/backend-state/`, gitignored because the configs embed camera credentials), and deletes the paths through the MediaMTX API, so MediaMTX stops pulling from the camera and HLS returns 404. Turning it on re-adds the saved configs. A reconcile loop re-deletes "off" paths every 30 seconds, because a MediaMTX restart reloads them from `mediamtx.yml`.

The PUT verifies the token with `google-auth-library` against the OAuth client ID and requires a verified email matching `ADMIN_EMAILS` (default mirrors `ADVANCED_FEATURES` in `config.js`). Errors: 401 missing, expired, or invalid token; 403 not an admin; 404 unknown feed; 400 bad body; 500 MediaMTX failure. Google ID tokens last one hour, so the admin page asks you to sign in again after that. `DEV_MODE` does not apply to `/admin`.

The viewer polls `GET /api/feeds` every 15 seconds and shows the off-air slate on any feed that is off.
