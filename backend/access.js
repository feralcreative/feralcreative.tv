// Access control for every feralcreative.tv site. Viewers sign in with Google once per
// site; the backend then sets a signed session cookie that carries only the email.
// Every check looks the email up in the access list, so removing someone from the
// list takes effect on their next request. nginx asks GET /api/auth/check before it
// serves any stream, and the admin panel edits the list through /api/access.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");

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
const COOKIE = "fctv_session";
const SESSION_DAYS = 30;

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

function sign(value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function issueCookie(req, res, email) {
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const value = Buffer.from(JSON.stringify({ e: email, x: expires })).toString("base64url");
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

function sessionEmail(req) {
  const raw = (req.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (raw) {
    const [value, signature] = raw.slice(COOKIE.length + 1).split(".");
    const expected = sign(value || "");
    if (signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      const { e, x } = JSON.parse(Buffer.from(value, "base64url").toString());
      if (x > Date.now()) return e;
    }
  }
  return DEV_EMAIL || null;
}

function currentUser(req) {
  const email = sessionEmail(req);
  return email ? resolve(email) : null;
}

async function verifyGoogle(credential) {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload.email || !payload.email_verified) throw new Error("Unverified Google account");
  return payload.email;
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

function cleanEntries(input) {
  if (!Array.isArray(input)) throw new Error("entries must be a list");
  const seen = new Set();
  return input.map((entry) => {
    const match = String(entry.match || "").trim().toLowerCase();
    if (!/^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(match)) throw new Error(`"${match}" is not an email or @domain`);
    if (seen.has(match)) throw new Error(`${match} is listed twice`);
    seen.add(match);
    const channels = CHANNELS.filter((channel) => Array.isArray(entry.channels) && entry.channels.includes(channel));
    return { match, channels, admin: Boolean(entry.admin) };
  });
}

function register(app) {
  loadSecret();
  loadAccess();

  // Exchange a Google ID token for a session cookie on this site.
  app.post("/api/session", async (req, res) => {
    try {
      const email = await verifyGoogle(String(req.body.credential || ""));
      const user = resolve(email);
      if (!user.admin && user.channels.length === 0) {
        console.log(`[ACCESS] Refused sign-in for ${email}`);
        return res.status(403).json({ error: `${email} doesn't have access.` });
      }
      issueCookie(req, res, user.email);
      console.log(`[ACCESS] Signed in ${user.email}`);
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

  // For other sites (3d): check a Google ID token against the list without a session here.
  app.post("/api/access/verify", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const user = resolve(await verifyGoogle(String(req.body.credential || "")));
      const channel = String(req.body.channel || "");
      res.json({ ...user, allowed: user.admin || user.channels.includes(channel) });
    } catch (error) {
      res.status(401).json({ allowed: false, error: "Invalid Google sign-in" });
    }
  });

  app.get("/api/access", requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ channels: CHANNELS, owners: OWNERS, entries });
  });

  app.put("/api/access", requireAdmin, (req, res) => {
    try {
      entries = cleanEntries(req.body.entries);
      saveAccess();
      console.log(`[ACCESS] ${req.adminEmail} saved ${entries.length} access entries`);
      res.json({ channels: CHANNELS, owners: OWNERS, entries });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}

module.exports = { register, requireAdmin, requireUser, currentUser };
