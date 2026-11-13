// Access control for every feralcreative.tv site. Viewers sign in with Google once per
// site; the backend then sets a signed session cookie that carries only the email.
// Every check looks the email up in the access list, so removing someone from the
// list takes effect on their next request. nginx asks GET /api/auth/check before it
// serves any stream, and the admin panel edits the list through /api/access.
// Friends without a Google account can sign in with an emailed link instead (see
// magic-link.js) when their exact address is listed with email_link and is not an admin.
// From such a session they can add a Google account once; it is stored on their entry as
// google: { sub, email, added } and signs them in as the listed address from then on.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");
const magicLink = require("./magic-link");

const STATE_DIR = path.dirname(process.env.FEEDS_STATE_FILE || "/app/state/feeds.json");
const ACCESS_FILE = path.join(STATE_DIR, "access.json");
const SECRET_FILE = path.join(STATE_DIR, "session-secret");
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || "233064289536-85l4kha72ecka84gmf6f2d1bgkn3h16g.apps.googleusercontent.com";
// Always admins, whatever the list says, so nobody can lock the owner out.
const OWNERS = (process.env.ADMIN_EMAILS || "@feralcreative.co,ziadezzat@gmail.com")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
// Local development only: treat cookie-less requests as this user. Never set in production.
const DEV_EMAIL = (process.env.AUTH_DEV_EMAIL || "").trim().toLowerCase();

const CHANNELS = ["cats", "montclair", "3d"];
// Pages on this stack that may receive a sign-in link, and the channel each one shows.
// The hub shows none of its own, so any channel admits a viewer there.
const TV_HOSTS = { "feralcreative.tv": null, "cats.feralcreative.tv": "cats", "montclair.tv": "montclair" };
const LOCAL_HOSTS = { localhost: null, "feralcreative.localhost": null, "cats.localhost": "cats", "montclair.localhost": "montclair" };
// Local development only: let links point at the *.localhost hosts.
const ALLOW_LOCAL_LINKS = process.env.MAGIC_LINK_ALLOW_LOCAL === "true";
// Where the 3d site may receive links; its proxy relays requests and redemptions here.
const THREE_D_ORIGINS = (process.env.THREE_D_ORIGINS || "https://3d.feralcreative.co,https://3d.feralcreative.tv")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const COOKIE = "fctv_session";
const SESSION_DAYS = 30;
// How long after redeeming an emailed link the viewer may add a Google account. A link
// session lasts 30 days, and an old one on a shared or stolen browser must not be enough
// to attach someone else's Google account for good.
const ADD_GOOGLE_MINUTES = 30;

// First-run list, carried over from the old client-side ALLOWED_EMAILS / ADVANCED_FEATURES.
const SEED = [
  { match: "@feralcreative.co", channels: CHANNELS, admin: true },
  { match: "ziadezzat@gmail.com", channels: CHANNELS, admin: true },
  { match: "rhobbs007@gmail.com", channels: CHANNELS, admin: true },
  { match: "@cannonballcreative.agency", channels: CHANNELS, admin: false },
  { match: "ziadandrebecca@gmail.com", channels: CHANNELS, admin: false },
  { match: "zmezzat@gmail.com", channels: CHANNELS, admin: false },
  { match: "brian.donnellan@gmail.com", channels: CHANNELS, admin: false },
  { match: "aschur@gmail.com", channels: CHANNELS, admin: false },
  { match: "dslavik@gmail.com", channels: CHANNELS, admin: false },
  { match: "dylan.seidner@gmail.com", channels: CHANNELS, admin: false },
  { match: "dizzydezidee@gmail.com", channels: CHANNELS, admin: false },
  { match: "tess.evans@gmail.com", channels: CHANNELS, admin: false },
  { match: "tyler.phelps@gmail.com", channels: CHANNELS, admin: false },
  { match: "daveablees@gmail.com", channels: CHANNELS, admin: false },
  { match: "ohbandit@gmail.com", channels: CHANNELS, admin: false },
  { match: "connormstock@gmail.com", channels: CHANNELS, admin: false },
  { match: "epdale@gmail.com", channels: CHANNELS, admin: false },
  { match: "jpenick@gmail.com", channels: CHANNELS, admin: false },
  { match: "melanie.sensarn@gmail.com", channels: CHANNELS, admin: false },
  { match: "nancyricken@gmail.com", channels: CHANNELS, admin: false },
  { match: "lmftnancylyle@gmail.com", channels: CHANNELS, admin: false },
  { match: "yakamoosedev@gmail.com", channels: CHANNELS, admin: false },
  { match: "dave@trifoxdesigns.com", channels: CHANNELS, admin: false },
];

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
let entries = [];
let secret;

function matches(pattern, email) {
  return pattern.startsWith("@") ? email.endsWith(pattern) : email === pattern;
}

function loadAccess() {
  try {
    entries = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8")).entries;
    console.log(`[ACCESS] Loaded ${entries.length} access entries`);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[ACCESS] Failed to read access list:", error.stack);
    entries = SEED;
    saveAccess();
    console.log(`[ACCESS] Seeded access list with ${entries.length} entries`);
  }
}

function saveAccess() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${ACCESS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ACCESS_FILE);
}

function loadSecret() {
  try {
    secret = fs.readFileSync(SECRET_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fs.mkdirSync(STATE_DIR, { recursive: true });
    secret = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    console.log("[ACCESS] Generated a new session secret");
  }
}

// What an email may do right now: { email, admin, channels }.
function resolve(email) {
  const lower = email.toLowerCase();
  const owner = OWNERS.some((pattern) => matches(pattern, lower));
  const hits = entries.filter((entry) => matches(entry.match, lower));
  const admin = owner || hits.some((entry) => entry.admin);
  const channels = admin ? CHANNELS : CHANNELS.filter((channel) => hits.some((entry) => entry.channels.includes(channel)));
  return { email: lower, admin, channels };
}

// What an emailed link may grant this address, or null. Only an exact entry flagged
// email_link qualifies, and never an address that is an admin by any route (owner list,
// an admin @domain, an admin entry), so a link can never reach the admin panel.
function resolveLink(email) {
  const user = resolve(email);
  if (user.admin) return null;
  const entry = entries.find((candidate) => candidate.match === user.email && candidate.email_link);
  if (!entry || !user.channels.length) return null;
  return entry.google ? { ...user, link: true, google: entry.google.email } : { ...user, link: true };
}

// What a Google account added to an entry may do, or null. The entry must still hold that
// account (matched by Google's stable ID, never by its address), and like a link it never
// reaches an admin.
function resolveGoogle(email, sub) {
  const entry = entries.find((candidate) => candidate.match === email && candidate.google && candidate.google.sub === sub);
  if (!entry) return null;
  const user = resolve(email);
  if (user.admin || !user.channels.length) return null;
  return { ...user, google: entry.google.email };
}

// Who a verified Google sign-in is: the address itself when it has access of its own,
// otherwise the entry that added this Google account. Returns { user, sub } or null; sub
// is set only for an added account, and goes in the cookie.
function resolveGoogleSignIn(identity) {
  const direct = resolve(identity.email);
  if (direct.admin || direct.channels.length) return { user: direct, sub: null };
  const entry = entries.find((candidate) => candidate.google && candidate.google.sub === identity.sub);
  const user = entry && resolveGoogle(entry.match, identity.sub);
  return user ? { user, sub: identity.sub } : null;
}

// The scheme, host and port a request was made to, if it is a page that may receive links.
function tvOrigin(req) {
  const hostPort = req.get("host") || "";
  const host = hostPort.split(":")[0];
  if (host in TV_HOSTS) return { origin: `https://${host}`, channel: TV_HOSTS[host] };
  if (ALLOW_LOCAL_LINKS && host in LOCAL_HOSTS) return { origin: `http://${hostPort}`, channel: LOCAL_HOSTS[host] };
  return null;
}

// A link user may open a page only if they hold its channel (or any channel, on the hub).
function linkAllows(user, channel) {
  return Boolean(user) && (!channel || user.channels.includes(channel));
}

// Refuse a state-changing POST that did not come from this page's own origin as JSON.
function sameOriginJson(req, origin) {
  const site = req.get("sec-fetch-site");
  return req.is("application/json") && req.get("origin") === origin && (!site || site === "same-origin");
}

const EMAIL = /^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/;

function sign(value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

// kind marks how the session began: { m: 1, i: <redeemed at> } for an emailed link,
// { g: sub } for a Google account added to the entry. Either is re-checked on every request.
function issueCookie(req, res, email, kind = {}) {
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const value = Buffer.from(JSON.stringify({ e: email, x: expires, ...kind })).toString("base64url");
  res.append("Set-Cookie", cookieHeader(req, `${value}.${sign(value)}`, SESSION_DAYS * 86400));
}

function clearCookie(req, res) {
  res.append("Set-Cookie", cookieHeader(req, "", 0));
}

// The hub and cats share a cookie across feralcreative.tv; other sites keep their own.
function cookieHeader(req, value, maxAge) {
  const host = (req.get("x-forwarded-host") || req.get("host") || "").split(":")[0];
  const local = host === "localhost" || host.endsWith(".localhost");
  const parts = [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (host === "feralcreative.tv" || host.endsWith(".feralcreative.tv")) parts.push("Domain=feralcreative.tv");
  if (!local) parts.push("Secure");
  return parts.join("; ");
}

function readSession(req) {
  const raw = (req.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (raw) {
    const [value, signature] = raw.slice(COOKIE.length + 1).split(".");
    const expected = sign(value || "");
    if (signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      const { e, x, m, g, i } = JSON.parse(Buffer.from(value, "base64url").toString());
      if (x > Date.now()) return { email: e, link: m === 1, google: typeof g === "string" ? g : null, issued: typeof i === "number" ? i : 0 };
    }
  }
  return DEV_EMAIL ? { email: DEV_EMAIL, link: false, google: null, issued: 0 } : null;
}

// The viewer behind a link session redeemed recently enough to add a Google account, or null.
function recentLinkUser(req) {
  const session = readSession(req);
  if (!session || !session.link || Date.now() - session.issued > ADD_GOOGLE_MINUTES * 60000) return null;
  return resolveLink(session.email);
}

// The signed-in viewer as the list stands now, or null. A session with no channels at all
// counts as signed out, so removing someone ends their session on every page.
function currentUser(req) {
  const session = readSession(req);
  if (!session) return null;
  const user = session.link
    ? resolveLink(session.email)
    : session.google
      ? resolveGoogle(session.email, session.google)
      : resolve(session.email);
  if (!user || (!user.admin && user.channels.length === 0)) return null;
  // Tells the page to offer adding a Google account.
  if (session.link && !user.google && recentLinkUser(req)) return { ...user, add_google: true };
  return user;
}

async function verifyGoogle(credential) {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload.email || !payload.email_verified || !payload.sub) throw new Error("Unverified Google account");
  return { email: payload.email.toLowerCase(), sub: String(payload.sub) };
}

// Which channel a proxied URI belongs to. SKYLINE (cam_other) also shows in the cats grid.
function channelsFor(uri) {
  if (/^\/cam_(left|right|top)(_low)?\//.test(uri)) return ["cats"];
  if (/^\/cam_other(_low)?\//.test(uri) || uri.startsWith("/api/streams/other/")) return ["cats", "montclair"];
  return null;
}

function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  if (!user.admin) return res.status(403).json({ error: `${user.email} is not an admin` });
  req.user = user;
  req.adminEmail = user.email;
  next();
}

// The list as the admin panel sees it: an added Google account shows as its address only.
function publicEntries() {
  return entries.map((entry) => (entry.google ? { ...entry, google: entry.google.email } : entry));
}

// An added Google account belongs to the server: a save keeps the one already stored for
// the same address and ignores whatever the client sent, so a stale admin tab cannot wipe
// or forge one. Sending google: null removes it, as does making the entry an admin.
function cleanEntries(input) {
  if (!Array.isArray(input)) throw new Error("entries must be a list");
  const seen = new Set();
  return input.map((entry) => {
    const match = String(entry.match || "").trim().toLowerCase();
    if (!/^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(match)) throw new Error(`"${match}" is not an email or @domain`);
    if (seen.has(match)) throw new Error(`${match} is listed twice`);
    seen.add(match);
    const channels = CHANNELS.filter((channel) => Array.isArray(entry.channels) && entry.channels.includes(channel));
    const admin = Boolean(entry.admin);
    // Links are for single addresses that are not admins.
    const emailLink = Boolean(entry.email_link) && !admin && !match.startsWith("@");
    const clean = emailLink ? { match, channels, admin, email_link: true } : { match, channels, admin };
    const stored = entries.find((existing) => existing.match === match);
    if (stored && stored.google && entry.google !== null && !admin && !match.startsWith("@")) clean.google = stored.google;
    return clean;
  });
}

function register(app) {
  loadSecret();
  loadAccess();

  // Exchange a Google ID token for a session cookie on this site.
  app.post("/api/session", async (req, res) => {
    try {
      const identity = await verifyGoogle(String(req.body.credential || ""));
      const signIn = resolveGoogleSignIn(identity);
      if (!signIn) {
        console.log(`[ACCESS] Refused sign-in for ${identity.email}`);
        return res.status(403).json({ error: `${identity.email} doesn't have access.` });
      }
      const { user, sub } = signIn;
      issueCookie(req, res, user.email, sub ? { g: sub } : {});
      console.log(`[ACCESS] Signed in ${user.email}${sub ? ` through added Google account ${identity.email}` : ""}`);
      res.json(user);
    } catch (error) {
      console.error("[ACCESS] Sign-in failed:", error.message);
      res.status(401).json({ error: "Sign-in failed. Try again." });
    }
  });

  app.get("/api/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Not signed in" });
    res.json(user);
  });

  app.delete("/api/session", (req, res) => {
    clearCookie(req, res);
    res.status(204).end();
  });

  // nginx auth_request: 204 lets the request through, 401/403 stops it.
  app.get("/api/auth/check", (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).end();
    const uri = req.get("x-original-uri") || "";
    if (uri.startsWith("/api/onvif/")) return res.status(user.admin ? 204 : 403).end();
    const needed = channelsFor(uri);
    if (needed && !needed.some((channel) => user.channels.includes(channel))) return res.status(403).end();
    res.status(204).end();
  });

  // Email a sign-in link. A tv page asks for its own origin; the 3d proxy relays with
  // family "3d" and its origin. The answer is the same whoever asks and is sent before any
  // lookup, so neither it nor its timing says who is on the list.
  app.post("/api/magic-link", (req, res) => {
    res.set("Cache-Control", "no-store");
    const email = String(req.body.email || "").trim().toLowerCase();
    const family = req.body.family === "3d" ? "3d" : "tv";
    const target = family === "3d"
      ? THREE_D_ORIGINS.includes(req.body.origin) && { origin: req.body.origin, channel: "3d" }
      : tvOrigin(req);
    if (!target) return res.status(400).json({ error: "Sign-in links are not available here." });
    // Only this site's own pages, or the 3d proxy server to server (which sends no Origin),
    // may ask; a browser on any other site would let it email-bomb listed friends.
    const allowed = family === "3d" ? !req.get("origin") : sameOriginJson(req, target.origin);
    if (!allowed) return res.status(403).json({ error: "Request refused." });
    if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    res.status(202).json({ message: "If that address has access, a sign-in link is on its way. It expires in 15 minutes." });

    setImmediate(async () => {
      const user = resolveLink(email);
      if (!linkAllows(user, target.channel)) {
        console.log(`[ACCESS] No sign-in link for ${email}: not eligible for ${target.origin}`);
        return;
      }
      try {
        await magicLink.issue(email, family, target.origin, new URL(target.origin).host);
      } catch (error) {
        console.error(`[ACCESS] Sign-in link for ${email} failed:`, error.stack);
      }
    });
  });

  // Redeem a link on a tv page: the token comes from the page's fragment as JSON.
  app.post("/api/magic-link/redeem", (req, res) => {
    res.set("Cache-Control", "no-store");
    const target = tvOrigin(req);
    if (!target || !sameOriginJson(req, target.origin)) return res.status(403).json({ error: "Sign-in refused." });
    const email = magicLink.consume(req.body.token, "tv", target.origin);
    const user = email && resolveLink(email);
    if (!linkAllows(user, target.channel)) {
      return res.status(400).json({ error: "This link has expired, was already used, or no longer has access. Ask for a new one." });
    }
    issueCookie(req, res, user.email, { m: 1, i: Date.now() });
    console.log(`[ACCESS] Signed in ${user.email} with an emailed link`);
    res.json(user);
  });

  // Add a Google account to the entry of a viewer signed in with an emailed link, so they
  // can use Google from then on. Only a link session redeemed in the last ADD_GOOGLE_MINUTES
  // may do this, once per entry; an admin removes it in /admin. Everything is checked again
  // after the token is verified, with no await before the save, because the list can change
  // while that request is out.
  app.post("/api/magic-link/google", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const target = tvOrigin(req);
    if (!target || !sameOriginJson(req, target.origin)) return res.status(403).json({ error: "Request refused." });
    const refused = `Sign out and ask for a new sign-in link, then add your Google account within ${ADD_GOOGLE_MINUTES} minutes of using it.`;
    if (!recentLinkUser(req)) return res.status(401).json({ error: refused });
    let identity;
    try {
      identity = await verifyGoogle(String(req.body.credential || ""));
    } catch (error) {
      console.error("[ACCESS] Adding a Google account failed:", error.message);
      return res.status(401).json({ error: "Google sign-in failed. Try again." });
    }
    const user = recentLinkUser(req);
    const entry = user && entries.find((candidate) => candidate.match === user.email);
    if (!entry) return res.status(401).json({ error: refused });
    if (entry.google) {
      return res.status(409).json({ error: `This address already has a Google account, ${entry.google.email}. Ask for it to be removed first.` });
    }
    if (entries.some((candidate) => candidate.google && candidate.google.sub === identity.sub)) {
      return res.status(409).json({ error: `${identity.email} is already added to another address.` });
    }
    const direct = resolve(identity.email);
    if (direct.admin || direct.channels.length) {
      return res.status(409).json({ error: `${identity.email} already has access. Sign out, then sign in with Google.` });
    }
    entry.google = { sub: identity.sub, email: identity.email, added: new Date().toISOString() };
    try {
      saveAccess();
    } catch (error) {
      delete entry.google;
      console.error("[ACCESS] Could not save an added Google account:", error.stack);
      return res.status(500).json({ error: "Could not save that. Try again." });
    }
    console.log(`[ACCESS] ${user.email} added Google account ${identity.email}`);
    res.json({ ...user, google: identity.email });
  });

  // For other sites (3d): check a Google ID token, or consume a 3d sign-in link, against
  // the list without a session here.
  app.post("/api/access/verify", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.body.magic_token !== undefined) {
      const channel = String(req.body.channel || "");
      const origin = THREE_D_ORIGINS.includes(req.body.origin) ? req.body.origin : null;
      const email = channel === "3d" && origin ? magicLink.consume(req.body.magic_token, "3d", origin) : null;
      const user = email && resolveLink(email);
      if (!user) return res.status(401).json({ allowed: false, error: "This link has expired or was already used." });
      return res.json({ ...user, allowed: user.channels.includes(channel) });
    }
    try {
      const identity = await verifyGoogle(String(req.body.credential || ""));
      const channel = String(req.body.channel || "");
      // No access at all still answers with the Google address, so the 3d site can name it.
      const user = (resolveGoogleSignIn(identity) || { user: resolve(identity.email) }).user;
      res.json({ ...user, allowed: user.admin || user.channels.includes(channel) });
    } catch (error) {
      res.status(401).json({ allowed: false, error: "Invalid Google sign-in" });
    }
  });

  app.get("/api/access", requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ channels: CHANNELS, owners: OWNERS, entries: publicEntries() });
  });

  app.put("/api/access", requireAdmin, (req, res) => {
    try {
      entries = cleanEntries(req.body.entries);
      saveAccess();
      console.log(`[ACCESS] ${req.adminEmail} saved ${entries.length} access entries`);
      res.json({ channels: CHANNELS, owners: OWNERS, entries: publicEntries() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}

module.exports = { register, requireAdmin, requireUser, currentUser };
