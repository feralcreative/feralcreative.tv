// One-time sign-in links, emailed through Resend, for listed friends who have no Google
// account. Tokens are 32 random bytes; only their SHA-256 hash is stored, with the email,
// the site family ("tv" or "3d"), the exact origin the link points at, an expiry, and a
// used flag. Consuming a token is one synchronous step, so in this single Node process
// two redemptions of the same link cannot both succeed.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATE_DIR = path.dirname(process.env.FEEDS_STATE_FILE || "/app/state/feeds.json");
const STORE_FILE = path.join(STATE_DIR, "magic-links.json");
const TOKEN_MINUTES = 15;
const PER_EMAIL_PER_HOUR = 3;
const PER_DAY = 50; // stays under Resend's free 100 a day, which Routeloop shares
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "";
// Local development only: write the link to the log instead of emailing it.
const DEV_LOG = process.env.MAGIC_LINK_DEV_LOG === "true";

let links = [];
const sentByEmail = new Map();
let sentToday = { day: "", count: 0 };

function hash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function load() {
  try {
    links = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")).links;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[MAGIC] Failed to read link store:", error.stack);
    links = [];
  }
}

function save() {
  const now = Date.now();
  links = links.filter((link) => link.expires > now);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ links }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
}

// Whether another email may go out now, counting only emails actually sent.
function allowSend(email) {
  const now = Date.now();
  const recent = (sentByEmail.get(email) || []).filter((time) => now - time < 3600000);
  sentByEmail.set(email, recent);
  const day = new Date().toISOString().slice(0, 10);
  if (sentToday.day !== day) sentToday = { day, count: 0 };
  return recent.length < PER_EMAIL_PER_HOUR && sentToday.count < PER_DAY;
}

function recordSend(email) {
  sentByEmail.get(email).push(Date.now());
  sentToday.count += 1;
}

function create(email, family, origin) {
  const token = crypto.randomBytes(32).toString("base64url");
  links.push({ hash: hash(token), email, family, origin, expires: Date.now() + TOKEN_MINUTES * 60000, used: false });
  save();
  return token;
}

// The email a token belongs to, or null. Checks and marks it used in one synchronous step.
function consume(token, family, origin) {
  if (typeof token !== "string" || token.length < 40) return null;
  const digest = hash(token);
  const link = links.find((entry) => entry.hash === digest);
  if (!link || link.used || link.expires <= Date.now() || link.family !== family) return null;
  if (origin && link.origin !== origin) return null;
  link.used = true;
  save();
  return link.email;
}

async function send(email, url, siteName) {
  if (!RESEND_API_KEY || !MAIL_FROM) {
    if (DEV_LOG) {
      console.log(`[MAGIC] Dev link for ${email}: ${url}`);
      return;
    }
    throw new Error("RESEND_API_KEY and MAIL_FROM are not set");
  }
  const text = [
    `Here's your sign-in link for ${siteName}:`,
    "",
    url,
    "",
    `It works once and expires in ${TOKEN_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
  ].join("\n");
  const html = `<p>Here's your sign-in link for ${siteName}:</p>
<p><a href="${url}">Sign in to ${siteName}</a></p>
<p>It works once and expires in ${TOKEN_MINUTES}&nbsp;minutes. If you didn't ask for it, ignore this&nbsp;email.</p>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [email], subject: `Sign in to ${siteName}`, text, html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

// Issue and email a link. Callers have already checked that the email may use one.
async function issue(email, family, origin, siteName) {
  if (!allowSend(email)) {
    console.log(`[MAGIC] Rate limit reached; no link sent to ${email}`);
    return;
  }
  // Count the send before awaiting it, so parallel requests cannot slip past the caps;
  // a failed send still counts, which keeps retries from hammering Resend.
  recordSend(email);
  const token = create(email, family, origin);
  await send(email, `${origin}/signin#${token}`, siteName);
  console.log(`[MAGIC] Sent a ${family} sign-in link to ${email} for ${origin}`);
}

load();

module.exports = { issue, consume, TOKEN_MINUTES };
