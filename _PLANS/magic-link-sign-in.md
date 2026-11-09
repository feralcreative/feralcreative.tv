# Email sign-in links for friends without Google accounts

Updated: 2026-11-08

## Goal

Let a few named friends who have no Google account sign in to the feralcreative.tv channels (hub, cats, Montclair) and to 3d.feralcreative.co with a one-time link emailed to them. Google sign-in stays the default for everyone else. Access stays decided in one place, the hub's access list in `backend/access.js` on `feat/access-control`.

## Where things stand

- `backend/access.js` (branch `feat/access-control`, not merged to `main`) keeps the access list in `data/backend-state/access.json`, edited from `/admin`. Entries are an exact email or an `@domain`, with channels and an admin flag.
- The hub's own pages exchange a Google ID token at `POST /api/session` for a signed `fctv_session` cookie (30 days, `Domain=feralcreative.tv` on .tv hosts).
- 3d's private proxy (`printer-proxy-server.js`) posts the Google token to the hub's `POST /api/access/verify` with `channel: "3d"`, then sets its own session cookie.
- Nothing in either repo sends email.

## Design

### Who may use a link

Only exact-email entries with a new `email_link: true` flag, set per entry in `/admin`. Eligibility is checked on the effective result, not the entry: an email that `resolve()` makes an admin by any route (owner list, an admin `@domain`, an admin entry) is refused, as is anything matched only by an `@domain`. The link never becomes a back door into the admin panel or into a whole domain's mailboxes.

Link sessions carry a flag (`m: 1`) in the signed cookie, and `resolve()` forces `admin: false` whenever it is set, so a later list change cannot promote a link session.

### Scope

A link is bound to a site family, not to one page: `tv` (the hub, cats, and Montclair, which already share `fctv_session` across `feralcreative.tv` by design) or `3d`. A `tv` token cannot be redeemed on 3d or the reverse. A session also needs at least one channel; today `GET /api/session` returns 200 for a valid cookie with zero channels and the hub treats that as signed in, so this change makes it 403, which also fixes removal for Google users.

### Request

1. The sign-in screen on every site gets a "No Google account? Email me a sign-in link" field below the Google button.
2. On the tv sites it posts `{ email, family: "tv" }` to the hub's `POST /api/magic-link`. On 3d it posts `{ email }` to 3d's own proxy, which relays it server to server to the hub with `family: "3d"`; no cross-origin call and no CORS change. The hub maps the family to a fixed origin; no client ever supplies a URL.
3. The hub answers at once with the same "If that address has access, a link is on its way", then does the work after responding, so neither the response nor its timing reveals who is on the list.
4. If the email is eligible for that family, the hub creates a token: 32 random bytes, stored only as a SHA-256 hash with the email, the family, a 15-minute expiry, and a used flag, in `data/backend-state/magic-links.json` (same temp-file-and-rename write as `access.json`, expired rows pruned on each write).
5. It sends the link `https://<origin>/signin#<token>`. The token is in the fragment, so it never reaches nginx access logs, the server, or a `Referer` header.
6. Rate limit: 3 requests per email and 10 per client IP per hour, in memory. The client IP is Cloudflare's `CF-Connecting-IP`, passed through by nginx in the `proxy_set_header` block; the backend reads only that header and only from nginx, never a client-supplied `X-Forwarded-For`. 3d's relay passes the same header on.

### Redeem

1. `GET /signin` serves a static page with one "Sign in" button. Loading it consumes nothing; mail scanners (Outlook Safe Links, Gmail previews) that fetch the link in advance cannot burn the token, and cannot see it anyway, because it is in the fragment.
2. The button reads the fragment, clears it from the address bar with `history.replaceState`, and POSTs `{ token }` as JSON. On tv hosts it goes to the hub's `POST /api/magic-link/redeem`; on 3d it goes to 3d's proxy, which posts `{ magic_token, channel: "3d" }` to the hub's `POST /api/access/verify` in place of `credential` and gets the same `{ email, admin: false, channels, allowed }` shape back, so 3d's cookie code changes only to carry the link flag.
3. Both redeem routes require `Content-Type: application/json` and an exact `Origin` match for the family's hosts (with `Sec-Fetch-Site: same-origin` when present), so a third-party page cannot log a browser into a session. This is needed because the hub backend enables CORS globally.
4. Check-and-consume is atomic: the hub validates the hash, expiry, family, and unused state and marks the row used in one synchronous step, before any `await`, then writes the file. This holds because the backend runs as one Node process; note that in `docs/decisions.md`.
5. The email is then re-resolved against the current list, and the session cookie is issued exactly as Google sign-in does, plus the link flag.

### Sending the email

Resend, on User's existing free account (decided 2026-11-08), through its HTTP API with plain `fetch`, so there is no new dependency. This backend's key is the 1Password item "Resend API Key (feralcreative.tv)" (`6yseziiodkyaasum2e46fvs72m`, vault `Private`, account `ziadezzat.1password.com`), separate from Routeloop's. As of 2026-11-08 it is a full-access key (it can list domains); replace it with a "Sending access" key limited to the sending domain before it goes on the NAS. As of 2026-11-08 the account has two verified domains, `routeloop.app` and `tankbag.app`, and none for Feral; Resend's free plan normally allows one domain, so adding `feralcreative.tv` may hit that limit (see Open questions). The sending key lives in 1Password and reaches the backend container through `.env` interpolation, never in a served script or as a literal in `docker-compose.prod.yml`. Neither compose file nor `.env.example` has any mail variable today, so all three gain the sender's keys (`MAIL_FROM` plus the provider's key name) under the backend service's `environment:`.

## Changes by repo

- `feralcreative.tv`, on `feat/access-control`: `backend/access.js` (`email_link` flag in `cleanEntries` and `resolve`, the two magic-link routes, the `magic_token` path in `/api/access/verify`), a new `backend/magic-link.js` (token store, rate limit, mailer), `auth.js` and the three pages (email field and the `/signin` page), `admin.js`/`admin.html` (the per-entry checkbox), `nginx.conf` (route `/signin` and the new API paths without the session gate, and pass `CF-Connecting-IP` to the backend), `backend/server.js` (CORS stays off the redeem route), the Dockerfile `COPY` list and compose volumes for `signin.html`, both compose files and `.env.example` (mail variables), and `docs/api.md`, `docs/architecture.md`, `docs/decisions.md`, and `AGENTS.md`.
- `3d.feralcreative.co`: the private `printer-proxy-server.js` (`POST /magic-link` relay, `/signin` page, a JSON-and-Origin-checked redeem that posts `magic_token` to the hub, and the link flag in its session cookie), `auth.js` and `index.html` (the email field), the Dockerfile and Nginx routes for `/signin`, `docs/api.md`, and `AGENTS.md`.

## Verification

1. Locally with a stub mailer that writes the link to the log: request, redeem, cookie set, channels as listed.
2. Negative cases: unknown email, an `@domain`-only match, an exact entry that is an admin through an owner or admin domain, an entry without `email_link`, an expired token, a reused token, two redeems of one token fired together, a tv token on 3d and the reverse, a cross-origin redeem POST, a form-encoded redeem POST, and a scanner GET of `/signin` that must not burn anything. Confirm the request endpoint's response time does not differ between a listed and an unlisted address.
3. Remove the friend from the list and confirm their next hub request is refused (now that zero channels means 403), and that 3d refuses at its next session renewal.
4. Grep the nginx access log after a full sign-in for the token; it must not appear.
5. Production deploy and the OAuth/DNS side need no change beyond the sender's DNS records, which need User's written approval.

## Review

Codex reviewed the first draft on 2026-11-07 and found twelve problems, all folded in above: token in the query string (now the fragment), single-site scoping that contradicted the shared tv cookie (now families), "admin always false" unenforceable with an email-only cookie (now a cookie flag), admin through an overlapping domain (now an effective-admin check), zero-channel sessions treated as signed in, missing CSRF protection on redeem, non-atomic consume, timing enumeration, an IP limiter that would see only nginx, no request route on 3d, and no mail variables in either compose file or `.env.example`.

## Open questions

1. Sending domain. Resend is decided. Either add `feralcreative.tv` to Resend (its DKIM and SPF records go in Cloudflare and need User's written approval; the free plan may refuse a third domain), or send from one of the already-verified domains.
2. Session length for link sign-ins: the same 30 days as Google, or shorter.
3. `feat/access-control` is not merged to `main`. This builds on it, so it should land (or be deployed from that branch) first.
4. Other personal projects (`*.ezzat.com`, Routeloop, the client portal) have their own sign-in and are out of scope. Each could later call the hub's `/api/access/verify` the way 3d does.
