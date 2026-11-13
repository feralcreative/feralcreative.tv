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

Admin session required, checked by nginx `auth_request` and again by `requireAdvancedFeatures` (`access.requireAdmin`).

## Stream paths

Served by mediamtx on 8888, proxied by nginx.

| URL | Source |
| --- | --- |
| `/cam_<key>/video1_stream.m3u8` | camera `stream1`, high quality—used by the modal |
| `/cam_<key>_low/video1_stream.m3u8` | camera `stream2`, low quality—used by the grid |

`.m3u8` responses are proxied with no-store cache headers; `.ts` and `.mp4` segments get `max-age=10`. Both have 10s proxy read timeouts, so a stalled camera surfaces as a 504 rather than hanging.

`hlsAlwaysRemux: yes` in `mediamtx.yml` keeps the playlists live even with no viewer, and `sourceOnDemand: no` keeps mediamtx pulling RTSP continuously. Both are deliberate; see [decisions.md](decisions.md).

WHEP endpoints (`/cam_<key>/whep` → `mediamtx:8889`) are still proxied in `nginx.conf` and the WHEP client is still loaded in `cats.html`, but nothing calls them.

## OBS availability

`GET /api/streams/other/status` returns `{ "live": true }` when MediaMTX serves the OBS HLS playlist, or `{ "live": false }` when no publisher is active. Upstream failures return HTTP 503 with `{ "live": false }`. Responses are never cached. Both OBS views use `/cam_other/index.m3u8`; there is no OBS `_low` rendition.

## Channel status

`GET /api/channels` returns `{ "channels": { "cats": { "live": bool }, "montclair": { "live": bool }, "3d": { "live": bool } } }` for the hub's on-air lights. It is public and cached for 10 seconds in the backend. Cats is live when any of `cam_left_low`, `cam_right_low`, or `cam_top_low` is ready in MediaMTX; Montclair when `cam_other` is ready. A feed switched off in `/admin` has no MediaMTX path, so it reads as off air. 3d is live when `THREED_LIVE_URL` (default `https://3dprinter.feralcreative.co/live`, a public route on the 3d proxy) returns `{ "live": true }`.

## Feed control

Implemented in `backend/feeds.js`; the admin UI is `/admin` (`admin.html`, `admin.js`, reusing `app.js` and `obs-stream.js`), the same live camera grid as the cats page with an on/off switch in each tile header, served by the shared hub/cats server block at feralcreative.tv/admin and cats.feralcreative.tv/admin. Montclair does not expose this panel or API.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/feeds` | none | — | `{ "feeds": { "<key>": { "name": "LEFT", "enabled": true } } }` |
| PUT | `/api/feeds/<key>` | Admin session cookie | `{ "enabled": false }` | same shape as GET |

Feed keys are `left`, `right`, `top`, and `other`. Turning a feed off fetches each of its MediaMTX path configs (`cam_<key>` and `cam_<key>_low`, or just `cam_other`), saves them to `/app/state/feeds.json` (host `data/backend-state/`, gitignored because the configs embed camera credentials), and deletes the paths through the MediaMTX API, so MediaMTX stops pulling from the camera and HLS returns 404. Turning it on re-adds the saved configs. A reconcile loop re-deletes "off" paths every 30 seconds, because a MediaMTX restart reloads them from `mediamtx.yml`.

The PUT requires an admin session (see [Access and sessions](#access-and-sessions)). Errors: 401 not signed in; 403 not an admin; 404 unknown feed; 400 bad body; 500 MediaMTX failure.

The viewer polls `GET /api/feeds` every 15 seconds and shows the off-air slate on any feed that is off.

## Access and sessions

`backend/access.js` owns the access list (`/app/state/access.json`, host `data/backend-state/`, gitignored) and the session cookie. Each entry is `{ "match": "<email or @domain>", "channels": ["cats", "montclair", "3d"], "admin": bool, "email_link"?: true, "google"?: { "sub", "email", "added" } }`; a viewer gets the union of every matching entry, admins get every channel, and `ADMIN_EMAILS` are always admins. On first boot the list is seeded from the old `config.js` allowlist.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/session` | Google ID token in `{ "credential" }` | Verify the token, refuse anyone with no channels (403), set `fctv_session`. A Google account added to an entry signs in as that entry's listed address |
| GET | `/api/session` | Cookie | `{ email, admin, channels }` (plus `link: true` for a link session, `google` with the added Google address when the entry has one, and `add_google: true` while a link session may still add one), or 401; a session with no channels counts as signed out |
| DELETE | `/api/session` | none | Clear the cookie |
| GET | `/api/auth/check` | Cookie | nginx `auth_request` only; maps `X-Original-URI` to a channel and answers 204, 401, or 403 |
| GET, PUT | `/api/access` | Admin cookie | Read or replace the whole list `{ "entries": [...] }`; `google` appears as the address only, and a PUT can only remove it (`"google": null`) |
| POST | `/api/access/verify` | Google ID token, or a 3d link token | For other sites (3d): `{ credential, channel }` or `{ magic_token, channel: "3d" }` → `{ email, admin, channels, allowed }`; a link token is consumed and never grants admin |
| POST | `/api/magic-link` | none | `{ email }` from a tv page, or `{ email, family: "3d", origin }` from the 3d proxy; always 202 with the same message, then emails a link if the address may use one |
| POST | `/api/magic-link/redeem` | Link token | `{ token }` as JSON from the same origin the link was sent to; sets `fctv_session` marked as a link session |
| POST | `/api/magic-link/google` | Link-session cookie and a Google ID token | `{ credential }` as same-origin JSON; adds that Google account to the viewer's entry. 401 without a link session redeemed in the last 30 minutes, 409 if the entry or the Google account is already taken |

The cookie is HMAC-signed with a secret generated into `/app/state/session-secret` on first boot, lasts 30 days, and carries only the email, so every check reads the current list. It is `HttpOnly`, `SameSite=Lax`, and `Secure` off localhost; on `feralcreative.tv` hosts it is scoped to the whole domain so the hub and cats share it. Deleting `session-secret` signs everyone out.

### Emailed sign-in links

For listed friends without a Google account (`backend/magic-link.js`). An exact-email entry with `email_link: true` may ask for a one-time link; `@domain` entries and anyone who is an admin by any route (owner list, admin domain, admin entry) may not, and the backend drops the flag from them on save. Links go out through Resend (`RESEND_API_KEY`, `MAIL_FROM`), at most 3 per address per hour and 50 a day across the stack, which stays under Resend's free 100 a day that Routeloop shares.

- **Request.** The answer to `POST /api/magic-link` is sent before any lookup, so neither it nor its timing says who is listed. A tv page asks for its own origin (`feralcreative.tv`, `cats.feralcreative.tv`, `montclair.tv`, and `*.localhost` only when `MAGIC_LINK_ALLOW_LOCAL=true`); the 3d proxy asks with `family: "3d"` and an origin from `THREE_D_ORIGINS`. Cats and Montclair links require that channel; the hub requires any channel.
- **Token.** 32 random bytes, stored only as a SHA-256 hash in `/app/state/magic-links.json` with the email, family, origin, a 15-minute expiry, and a used flag. The link is `<origin>/signin#<token>`; the fragment keeps the token out of nginx logs and `Referer`.
- **Redeem.** `/signin` (`signin.html`) consumes nothing on load, so mail scanners that prefetch the link cannot spend it; its button POSTs the token. Redeem requires JSON, an `Origin` equal to the link's origin, and `Sec-Fetch-Site: same-origin` when present. Checking and marking a token used is one synchronous step, which is one-time only because the backend is a single Node process.
- **Session.** A link session's cookie carries `m: 1`; every request re-checks that the address still has `email_link`, is not an admin, and has a channel, so unticking the box or removing the entry ends it at once.
- **Local.** With no Resend key, `MAGIC_LINK_DEV_LOG=true` (the dev compose default) writes each link to the backend log instead.

### Adding a Google account

A friend signed in with an emailed link can add a Google account once and sign in with Google from then on, on every site including 3d. `auth.js` offers it in a small panel; `POST /api/magic-link/google` stores `google: { sub, email, added }` on their entry.

- **Who may add.** Only an emailed-link session redeemed in the last 30 minutes (`ADD_GOOGLE_MINUTES`; the cookie carries the redeem time as `i`), checked before and after the Google token is verified. A link session lasts 30 days, and an old one on a shared or stolen browser must not be enough to attach a Google account for good; a friend with an older session signs out and asks for a new link. A session that began with the added account may not, so a stolen one cannot swap accounts. One Google account per entry and one entry per Google account; a Google address that already has access of its own is refused, because it can simply sign in.
- **Signing in.** `POST /api/session` and `POST /api/access/verify` try the Google address itself first. If it has no access, they look for the entry holding that account's `sub` (Google's stable ID; the stored address is for display) and answer as the entry's listed address. The cookie carries `g: <sub>`, and every request re-checks that the entry still holds it, is not an admin by any route, and has a channel. An added account never grants admin.
- **Removing.** `/admin` shows the address under the entry with a Remove button. The backend owns the field: a `PUT /api/access` keeps the stored account for an entry with the same `match`, ignores any value the client sends, and drops it only for `"google": null` or when the entry becomes an admin. Unticking Email link leaves it in place.
- **3d.** The 3d site has no way to add one; the friend adds it on a tv page.

Stream paths map to channels: `cam_left`, `cam_right`, and `cam_top` (and their `_low` variants) need `cats`; `cam_other` and `/api/streams/other/status` need `cats` or `montclair`, because SKYLINE also appears in the cats grid; `/api/onvif/` needs admin. `GET /api/feeds` and `GET /api/channels` stay public because they expose only on/off state.

