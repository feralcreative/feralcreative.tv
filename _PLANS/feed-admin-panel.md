# Feed admin panel

Branch: `feat/feed-admin-panel`. Started 2026-09-30.

## Decisions

- "Off" stops the stream entirely: the backend deletes the feed's MediaMTX paths through the MediaMTX API, so MediaMTX stops pulling from the camera (or rejects OBS). "On" re-adds the saved path config.
- Admin actions are verified server-side: the backend checks the Google ID token with `google-auth-library` against an admin email list.

## Tasks

1. Migrate `mediamtx.yml.template` from deprecated `readUser`/`publishUser` keys to `authInternalUsers`, granting the camera account `api` so the backend can call MediaMTX. Fix the other deprecated keys while there.
2. Backend: `GET /api/feeds` (public state), `PUT /api/feeds/:feed` (admin only), state persisted to `/app/state/feeds.json`, reconcile loop that re-applies "off" after a MediaMTX restart.
3. nginx: proxy `/api/feeds`, serve `/admin` from the cats server block only.
4. Viewer: Tapo tiles and the modal show the off-air slate when a feed is off, and pick up changes by polling.
5. `admin.html` / `admin.js`: real Google sign-in (ignores `DEV_MODE`), one switch per feed. Admin link in the user bar for advanced users.
6. Compose volumes for backend state, `.gitignore`, AGENTS.md and docs.
