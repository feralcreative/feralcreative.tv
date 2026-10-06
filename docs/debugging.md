# Debugging

First stop when a stream or a PTZ call fails.

## Where the logs are

| Target | Command |
| --- | --- |
| All local containers | `docker compose logs -f` |
| One local container | `docker logs -f cats-mediamtx` (or `cats-web`, `cats-backend`) |
| Shell in a local container | `docker compose exec web sh` |
| Production containers | `./utils/deploy/deploy-utils.sh logs` |
| Production status | `./utils/deploy/deploy-utils.sh status` |

Browser-side logging is verbose by design: `auth.js` logs its full decision path under `[AUTH]`, `app.js` logs per-camera connection attempts and retries, and `onvif-controls.js` logs PTZ failures under `[ONVIF]`. Open the console before assuming a silent failure.

`CONSOLE.txt` in the repo root is a saved console dump from the WHEP era. It is gitignored and stale—the `/cam_*/whep` 404s in it are expected now, not a live bug.

## Health checks

```bash
docker ps --filter name=cats-                       # all three containers up?
docker exec cats-web wget -qO- http://127.0.0.1:80/health   # nginx alive
docker exec cats-backend wget -qO- http://127.0.0.1:3001/health  # backend + connected cameras
curl -s http://localhost:9997/v3/paths/list          # mediamtx paths (prod compose only)
```

The mediamtx API is only reachable on the host with `docker-compose.prod.yml`, which publishes 9997. The local compose file publishes only the RTMP listener on loopback, Locally, read `docker logs cats-mediamtx`; ffmpeg errors from the audio-stripping republishers appear there too. The `latest-ffmpeg` image includes `ffmpeg`, so `docker exec cats-mediamtx ffmpeg -i rtsp://127.0.0.1:8554/<path> -t 3 -f null -` probes a path from inside.

An empty `cameras` array from the backend health check is normal off the camera LAN: `initializeDevices` runs once at startup and records only cameras that answered.

`cats-web` should reach `healthy` within about 10s; its `HEALTHCHECK` probes `http://127.0.0.1:80/health` inside the container. If it stays `starting`, nginx failed to bind: check `docker logs cats-web` for a config error rather than the port mapping.

Use `127.0.0.1` rather than `localhost` inside containers—nginx binds IPv4 only, and `localhost` can resolve to `::1` and refuse.

## Known failure modes

**All three Tapo tiles stuck on "Connecting..." then "Error".** mediamtx cannot reach the cameras. Check `docker logs cats-mediamtx` for RTSP errors. Either you are off the camera LAN, `mediamtx.yml` was never generated (`bash utils/deploy/hooks/pre-build.sh`), or the camera account credentials are wrong. Verify RTSP independently:

```bash
ffprobe "rtsp://$CAMERA_USER:$CAMERA_PASS@192.168.1.201:554/stream2"
```

**One tile fails, three work.** That camera is offline or its IP changed. `app.js` retries three times with 1s, 2s, and 3s backoff before showing the error state, so a failure that appears instantly is a 404 on the playlist path, not a camera timeout.

**Playlist 404s.** The path name in `app.js` does not match a `paths:` key in `mediamtx.yml`, or nginx's location regex does not list it. All three must agree—see [architecture.md](architecture.md).

**Playlist 504s.** mediamtx is up but the RTSP pull is stalled. nginx gives up after 10 seconds by design.

**Page is unstyled.** `styles/css/main.css` was never compiled, or was compiled after the image was built. Run `npx sass styles/scss:styles/css --style compressed`, then rebuild if you are not using the local compose volume mounts.

**Stale JS or CSS after a change.** nginx caches CSS and JS for an hour. Bump the `?v=` query in `index.html`, or hard-reload.

**Stuck on the login screen locally.** `CONFIG.DEV_MODE` only bypasses auth on hostname `localhost` or `127.0.0.1`. A LAN IP or a tunnel hostname goes through Google, which then rejects the origin.

**Signed in as the wrong user, or a stale session.** `auth.js` never revalidates the stored token. Clear it:

```js
localStorage.removeItem("user");
```

**PTZ buttons do nothing.** In order: is the user in `CONFIG.ADVANCED_FEATURES`; is `cats-backend` up; did the camera connect at backend startup (`/health` lists only connected cameras); and do browser requests reach `/api/onvif/` on the same origin. Hard-refresh an older localhost page if it still targets a Tailscale address. A camera that was offline when the backend booted is never retried—restart `cats-backend`.

**PTZ returns 404 for a camera that exists.** Same cause: it failed to connect at startup. Check `docker logs cats-backend` for the `[ONVIF] Failed to connect` line.

**Camera moves and will not stop.** `ptz/move` is a continuous move. POST `ptz/stop` for that camera.

## Deploy failures

**`deploy.config not found`.** Run from the repo root, not from `utils/deploy/`.

**SSH fails.** `deploy.sh` auto-detects a key from `~/.ssh/` matching `*nas*` or `*synology*`. Confirm one exists, then test the connection by hand with the host, user, and port from `deploy.config`.

**Cloudflare purge fails.** The deploy still succeeded; only the cache was not cleared. Check that `.env` has both Cloudflare variables and verify the token:

```bash
curl -s -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

**Pre-build hook fails on `.env`.** It loads variables with `export $(cat .env | xargs)`, which breaks on whitespace or shell metacharacters in a value. Quote the value or set the variable in the environment directly.

## OBS feed

SKYLINE shows "Off the air" normally when OBS is stopped. It checks for a publisher every four seconds and reconnects without reloading the page. If it stays off air while OBS says it is streaming, verify the RTMP target and authentication in [OBS_SETUP.md](OBS_SETUP.md), then check `/api/streams/other/status`. HTTP 503 indicates an upstream connection problem; HTTP 200 with `live: false` means the HLS playlist is unavailable. SKYLINE has no pan/tilt controls.
