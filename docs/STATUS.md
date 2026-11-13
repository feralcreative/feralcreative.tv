# Status

Updated: 2026-11-13

## Live

- **Sign-in:** central sign-in at feralcreative.tv hands sessions to each site with a one-time code. Friends without Google can use emailed one-time links (Resend, sent from `feralcreative.co`) and can later link a Google account. This is on `main`, which matches `origin/main`.
- **Streams:** MediaMTX serves standard fMP4 HLS (10 segments of about 1.9 s), not low-latency HLS (4fe567c). LL-HLS's 200 ms parts sent about five requests a second per viewer through the Cloudflare Tunnel, and players fell off the old 7-segment window, which made montclair.tv choppy and caused segment 404s. hls.js in `obs-stream.js` now uses its default live sync, without the 1.5× catch-up. Confirmed live on the NAS on 2026-11-13.

## Open

1. **3d.feralcreative.co still shows the old login screen** after the central sign-in deploy (reported 2026-11-12 22:20). Not yet diagnosed; that site lives in `~/www/feralcreative/3d.feralcreative.co`.
2. **`feat/strip-audio` is local only and unmerged** (3 commits: strip audio from every feed, remove WebRTC, percent-encode credentials, reconnect on focus only when stalled). Codex's review rated one finding High: the MediaMTX API is published to the LAN while the OBS/camera credential has unrestricted `api` permission (`docker-compose.prod.yml:13`, `mediamtx.yml.template:24`). Resolve that before merging.
3. **Feed toggles:** on 2026-11-12, montclair.tv went dark because SKYLINE was switched off in `/admin`; the reconcile loop deletes an off feed's MediaMTX paths, so OBS gets `path 'cam_other' is not configured`. Several Tapo feeds also appeared to be off in production. Check `/admin` first when a feed is dark.
4. **Plans in `_PLANS/`:** `feed-admin-panel.md` is kept but not started.

## Gotchas

- Bandwidth scales with viewers: each one pulls every segment from the NAS over the home upload (about 6 Mbps each), because Cloudflare does not cache auth-gated segments.
- `mediamtx.yml` is still tracked and shows a credential diff after every regeneration. Never commit it.
- `.claude/` (holding `settings.json`) is untracked and its intent is unrecorded.
