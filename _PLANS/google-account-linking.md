# Let emailed-link friends add a Google account

Updated: 2026-11-12

## Goal

A friend who signs in with an emailed link can add a Google account once, then sign in with Google from then on. The Google account may have a different address from the one on the access list.

## Design

### Data

The friend's access entry gains a server-owned `google: { sub, email, added }`. `sub` is Google's stable account ID and is what sign-in matches; `email` is only for display. One Google account per entry, and one entry per Google account.

### Adding

`POST /api/magic-link/google` with `{ credential }` (the path sits under the existing nginx `/api/magic-link` location on both server blocks, so nginx does not change). It requires all of:

1. Same-origin JSON from a tv page (`tvOrigin` plus `sameOriginJson`).
2. An emailed-link session (`m: 1` cookie that still passes `resolveLink`) redeemed in the last 30 minutes, checked before and again after the Google token is verified. The cookie carries the redeem time as `i`. Added after Codex's review: a 30-day link session on a shared or stolen browser must not be enough.
3. A verified Google ID token for this client.

It refuses with 409 when the entry already has a Google account, when that Google account is linked to another entry, or when that Google address already has access of its own. Only an emailed-link session may add one; a session that began with the linked Google account may not, so a stolen Google-linked session cannot swap accounts.

### Signing in

`POST /api/session` and `POST /api/access/verify` (3d) resolve the Google address directly first, as today. If that yields nothing, they look for an entry whose `google.sub` matches and sign the viewer in as the entry's listed address. The cookie carries `g: <sub>`; every request re-checks that the entry still exists, still holds that `sub`, is not an admin by any route, and has a channel. A linked account never grants admin.

### Admin

`GET`/`PUT /api/access` show `google` as the display address. The server owns the field: `PUT` keeps the stored link for an entry with the same `match`, ignores any value the client sends, and drops it only when the client sends `google: null`, or the entry becomes an admin or an `@domain`. That keeps a stale admin tab from wiping a link a friend just added. `/admin` shows the address under the entry with a Remove button.

Unticking Email link does not remove the Google account; removing the entry or the link does.

### Browser

`auth.js` shows a small panel while `GET /api/session` says `add_google: true` (a recent link session with no Google account yet): one line, Google's button, and Not now (dismissed for the browser session). On success it names the account to pick next time. `GET /api/session` adds `google` (the display address, or absent).

## Not in this change

Adding from the 3d site. Its proxy keeps its own session and the hub has no way to trust "this is a link session for X" from it without a shared secret. A 3d-only friend can add the account at feralcreative.tv; once added, Google sign-in works on 3d through `/api/access/verify`.

## Files

`backend/access.js`, `auth.js`, `admin.js`, `admin.html`, `styles/scss/main.scss`, cache-busting versions in the HTML pages, `docs/api.md`, `AGENTS.md`.
