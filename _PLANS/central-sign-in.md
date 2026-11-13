# One sign-in screen for every site, at feralcreative.tv

Updated: 2026-11-12

## Goal

Everyone signs in at feralcreative.tv, whichever URL they arrived at. cats.feralcreative.tv, montclair.tv, and the 3d site stop showing their own Google button and email-link form; an unsigned visitor is sent to the hub, signs in there, and is sent back signed in. Access stays decided by the hub's list.

## Where things stand

- Each site has its own sign-in screen. The hub and cats share the `fctv_session` cookie (`Domain=feralcreative.tv`); montclair.tv has its own `fctv_session` from the same backend; 3d has its own `fc3d_session` (24 hours) set by its proxy after asking the hub's `POST /api/access/verify`.
- Emailed links are bound to a family (`tv` or `3d`) and to the origin that asked.
- Adding a Google account (`feat/link-google-account`) is offered on tv pages only, within 30 minutes of redeeming a link.

## Design

### The round trip

1. **Leave.** A site page with no session saves where the visitor was (`location.pathname + search`) and a fresh random verifier in `sessionStorage`, then goes to `https://feralcreative.tv/?return=<site origin>&challenge=<SHA-256 of the verifier>`. Only the hash travels in the URL, so nothing in history, logs, or a `Referer` lets anyone else finish the sign-in. It shows "Taking you to feralcreative.tv to sign in" with a plain link as a fallback.
2. **Sign in.** The hub checks `return` against a fixed list of exact, server-owned origin strings (cats, Montclair, and the 3d origins; the `*.localhost` hosts only when the hub itself was reached on a local host). Anything else is dropped and the hub behaves as it does today. With no session it shows the usual screen (Google, or an emailed link). With a session that holds the site's channel it goes straight on, with no click.
3. **Hand off.** The hub page calls `POST /api/handoff` with `{ return, challenge }`. The backend mints a one-time code and the page goes to `<origin>/signin#<code>`. Only the origin comes from the request; the path is always `/signin`, so there is no open redirect.
4. **Arrive.** The site's `/signin` page redeems the code together with the verifier it saved, deletes the verifier, sets the site's own cookie, and returns the visitor to the saved path. The saved path is client-writable, so it is resolved against the site's own origin and used only if it stays there, starts with a single `/`, and is not `/signin` or `/signout`.

### The code

Stored like an emailed-link token (32 random bytes, only the SHA-256 hash kept, one synchronous check-and-mark-used), in the same store with `type: "handoff"`. It also records:

- the target origin, which redemption must match;
- the challenge, which redemption must answer with the verifier, so a code minted for one browser cannot sign a different browser in as someone else;
- the session it came from: the email, its kind (plain Google, emailed link with its redeem time, or added Google account with its `sub`), and when the viewer signed in at the hub;
- a 60-second expiry.

Every consumer checks the record's `type` first, so a handoff code can never be redeemed as an emailed link or the reverse. Redemption validates type, origin, verifier, expiry, and the viewer's current access before it marks the code used, in one synchronous step, so a bad request cannot burn someone's code.

Redeeming copies the session kind, so the per-request re-check keeps working on the tv sites: a link session stays a link session, an added Google account stays tied to its `sub`, and only a plain Google session can be an admin. Minting requires a live hub session that holds the target's channel; otherwise the hub says who is signed in and that they lack that channel, and does not redirect.

### Redeeming

- **tv sites (cats, Montclair).** `POST /api/handoff/redeem` with `{ code, state }`, same-origin JSON only, sets `fctv_session`. Cats already shares the hub's cookie in production, but takes the same path so local and production behave alike.
- **3d.** The proxy's `/magic-link/redeem` becomes `/handoff/redeem` and posts `{ handoff_code, state, channel: "3d", origin }` to the hub's `POST /api/access/verify`, which answers `{ email, admin, channels, allowed }` as it does for a Google token.

### Admin on 3d

A 3d admin session can upload files and send G-code to a physical printer, and today it needs a Google sign-in on 3d itself at least every 24 hours. A hub cookie lasts 30 days, so handing admin over silently would stretch that to a month. The hub therefore answers `admin: true` to 3d only when the hub sign-in is a plain Google one made in the last 24 hours (every hub cookie gains its sign-in time). Otherwise the admin arrives as a viewer, and 3d shows "Sign in again for printer controls", which goes to the hub with `fresh=1`; the hub then asks Google again before handing off. Viewers never see any of this.

`/signin` redeems a handoff code on load with no button: the click exists for emailed links because mail scanners prefetch them, and a handoff code never travels by email.

### Emailed links

A link is always sent to the hub (`https://feralcreative.tv/signin#<token>`), and its record keeps the validated `return` origin. After redeeming, the hub goes to the return site's root with no code; that site finds no session and makes the normal round trip, which the hub now answers at once. This also covers a link opened in a different browser from the one that asked. The `3d` link family and the proxy's `/magic-link` relay go away.

A friend who has just redeemed a link is offered the add-a-Google-account panel on the hub. When a return is pending, the hub shows the panel with a Continue button, not an automatic redirect, so the offer is seen.

### Signing out

Sign out means this site and the hub, and the button's wording does not promise more. The site waits for its own cookie to be cleared, then goes to the hub's `/signout`, a dedicated page that clears the hub session before any handoff logic can run and then shows the sign-in screen. Without that, the next visit would bounce through the hub and sign straight back in. Sessions on the other sites are not reachable from there and last until they expire (3d: 24 hours) or the viewer leaves the list.

### Cookies become host-only

Today the hub's cookie is set with `Domain=feralcreative.tv`, which also sends it, admin sessions included, to `3d.feralcreative.tv`, a separate and much larger application. The handoff removes the reason to share it. Each tv host gets its own host-only cookie under a new name, `__Host-fctv`, and the old domain-wide `fctv_session` is expired on the next response. Everyone signs in once more after the deploy. Cats then takes the same round trip as Montclair in production as well as locally.

### Loops and failures

A site page redirects on its own at most once per tab every 30 seconds (a `sessionStorage` timestamp); inside that window it shows the "Sign in at feralcreative.tv" link and waits for a click, so nobody is stranded without a way in. If the code is refused or expired, `/signin` shows the error and a "Try again" link to the hub; it never redirects on its own.

## Order of work

Each step is its own commit; Codex reviews each diff.

1. **Hub backend** (`backend/access.js`, `backend/magic-link.js`): host-only cookies with a sign-in time, the return allowlist, `POST /api/handoff`, `POST /api/handoff/redeem`, `handoff_code` in `/api/access/verify` with the 24-hour admin rule, and `return` on emailed links. Old endpoints keep working.
2. **nginx**: `location /api/handoff` and `/signout` in both server blocks, passing `Host` with its port like `/api/magic-link`.
3. **Hub page** (`auth.js`, `index.html`, new `signout.html`): read `return`, `challenge`, and `fresh`, continue after sign-in, hold for the Google panel.
4. **Cats and Montclair pages** (`auth.js`, `cats.html`, `skyline.html`, `signin.html`): leave for the hub, redeem on return, sign out through the hub. Their Google button and email form go.
5. **3d** (`auth.js`, sign-in page, `printer-proxy-server.js`, in `~/www/feralcreative/3d.feralcreative.co`, on a PR): the same, through the proxy. `DEV_MODE` on localhost is unchanged.
6. **Clean up**, as a later change: the hub's `family: "3d"` link path, the proxy's `/magic-link` relay, and the docs in both repos. tv scripts are cached for an hour and old 3d tabs keep calling the old endpoints, so these stay until both sites have been on the new flow for at least a week with no rollback.

Deploy the tv stack (steps 1 to 4) first, with every `?v=` bumped; 3d keeps working against the old endpoints until its own deploy.

## Outside the code

- The Google OAuth client then needs only `https://feralcreative.tv` (and localhost) as a JavaScript origin. Removing the others is optional, is Ziad's change to make, and waits for the clean-up step.
- No DNS, Tunnel, or port change.

## Decisions taken unless Ziad says otherwise

- The redirect is automatic, not a "Sign in at feralcreative.tv" button.
- Sign out also signs out of the hub.
- Printer controls on 3d need a hub Google sign-in from the last 24 hours, as they effectively do today.
- Everyone signs in once more after the deploy, because the cookie is renamed.
- A deep link (such as a 3d `?model=` URL) survives the round trip in the same browser, and is lost only when an emailed link is opened in a different one.

## Not in this change

The 3d proxy copies `admin` into its own 24-hour cookie and does not ask the hub again, so demoting an admin reaches the printer controls up to a day late. That is how it works today; re-checking the hub before `/upload` and `/gcode` is a separate change worth making.

## Codex review, 2026-11-12

Taken in: the 24-hour admin rule for 3d, host-only cookies, a hashed challenge in place of a raw state value, a dedicated `/signout`, honest sign-out wording, strict token types, exact-origin and saved-path validation, the click-through fallback, and a later clean-up. Recorded above but left for a separate change: 3d re-checking the hub before printer actions.
