// Feed on/off control. "Off" deletes the feed's MediaMTX paths so MediaMTX
// stops pulling from the camera (or rejects OBS); "on" re-adds the saved config.
const fs = require("fs");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");

const MEDIAMTX_API = process.env.MEDIAMTX_API || "http://mediamtx:9997";
const STATE_FILE = process.env.FEEDS_STATE_FILE || "/app/state/feeds.json";
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || "233064289536-85l4kha72ecka84gmf6f2d1bgkn3h16g.apps.googleusercontent.com";
// Mirrors CONFIG.ADVANCED_FEATURES in config.js; override with a comma-separated ADMIN_EMAILS.
const ADMINS = (process.env.ADMIN_EMAILS || "@feralcreative.co,ziadezzat@gmail.com,rhobbs007@gmail.com")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
const RECONCILE_MS = 30000;
// The 3d channel lives in its own repo; its proxy serves the printer cam as MJPEG.
const THREED_STREAM_URL = process.env.THREED_STREAM_URL || "https://3dprinter.feralcreative.co/stream";
const CHANNEL_CACHE_MS = 10000;

const FEEDS = {
  left: { name: "LEFT", paths: ["cam_left", "cam_left_low"] },
  right: { name: "RIGHT", paths: ["cam_right", "cam_right_low"] },
  top: { name: "TOP", paths: ["cam_top", "cam_top_low"] },
  other: { name: "SKYLINE", paths: ["cam_other"] },
};

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const authHeader =
  "Basic " + Buffer.from(`${process.env.CAMERA_USER || ""}:${process.env.CAMERA_PASS || ""}`).toString("base64");

// { disabled: { <feed>: { <path>: <saved MediaMTX path config> } } }
let state = { disabled: {} };
let busy = Promise.resolve();

function loadState() {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!state.disabled) state.disabled = {};
    console.log(`[FEEDS] Loaded state: ${Object.keys(state.disabled).length} feed(s) off`);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[FEEDS] Failed to read state:", error.stack);
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
}

async function mediamtx(method, endpoint, body) {
  const response = await fetch(`${MEDIAMTX_API}${endpoint}`, {
    method,
    headers: { authorization: authHeader, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`MediaMTX ${method} ${endpoint} -> ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

// Delete each path that MediaMTX still has, keeping its config so it can be restored.
async function stopPaths(feed) {
  const saved = state.disabled[feed] || {};
  for (const name of FEEDS[feed].paths) {
    const config = await mediamtx("GET", `/v3/config/paths/get/${name}`);
    if (!config) continue;
    saved[name] = config;
    state.disabled[feed] = saved;
    saveState();
    await mediamtx("DELETE", `/v3/config/paths/delete/${name}`);
    console.log(`[FEEDS] Stopped ${name}`);
  }
  state.disabled[feed] = saved;
}

async function startPaths(feed) {
  const saved = state.disabled[feed] || {};
  for (const name of FEEDS[feed].paths) {
    if (!saved[name]) continue;
    const exists = await mediamtx("GET", `/v3/config/paths/get/${name}`);
    if (!exists) {
      const { name: _ignored, ...config } = saved[name];
      await mediamtx("POST", `/v3/config/paths/add/${name}`, config);
    }
    console.log(`[FEEDS] Started ${name}`);
  }
  delete state.disabled[feed];
  saveState();
}

// Serialize every MediaMTX change so a toggle and the reconcile loop never interleave.
function exclusive(task) {
  const run = busy.then(task, task);
  busy = run.catch(() => {});
  return run;
}

function setFeed(feed, enabled) {
  return exclusive(async () => {
    if (enabled) await startPaths(feed);
    else await stopPaths(feed);
  });
}

// MediaMTX reloads mediamtx.yml on restart, which brings deleted paths back.
function reconcile() {
  return exclusive(async () => {
    for (const feed of Object.keys(state.disabled)) {
      if (FEEDS[feed]) await stopPaths(feed);
    }
  }).catch((error) => console.error("[FEEDS] Reconcile failed:", error.message));
}

function feedStates() {
  return Object.fromEntries(Object.entries(FEEDS).map(([key, feed]) => [key, { name: feed.name, enabled: !state.disabled[key] }]));
}

function isAdmin(email) {
  const lower = email.toLowerCase();
  return ADMINS.some((allowed) => (allowed.startsWith("@") ? lower.endsWith(allowed) : lower === allowed));
}

async function requireAdmin(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload.email || !payload.email_verified) return res.status(401).json({ error: "Unverified Google account" });
    if (!isAdmin(payload.email)) return res.status(403).json({ error: `${payload.email} is not an admin` });
    req.adminEmail = payload.email;
    next();
  } catch (error) {
    res.status(401).json({ error: "Sign-in expired or invalid" });
  }
}

// A path is on air when MediaMTX has it and its source is publishing.
async function pathReady(name) {
  const info = await mediamtx("GET", `/v3/paths/get/${name}`);
  return Boolean(info && info.ready);
}

// Read only the response headers, then hang up so no MJPEG session stays open.
async function streamAnswers(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const type = response.headers.get("content-type") || "";
    return response.ok && (type.includes("multipart") || type.startsWith("image/"));
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

let channelCache = { at: 0, value: null };

async function channelStates() {
  if (channelCache.value && Date.now() - channelCache.at < CHANNEL_CACHE_MS) return channelCache.value;
  const settle = (promise) => promise.catch((error) => {
    console.error("[CHANNELS] Status check failed:", error.stack);
    return false;
  });
  const [left, right, top, other, printer] = await Promise.all([
    settle(pathReady("cam_left_low")),
    settle(pathReady("cam_right_low")),
    settle(pathReady("cam_top_low")),
    settle(pathReady("cam_other")),
    streamAnswers(THREED_STREAM_URL),
  ]);
  const value = {
    cats: { live: left || right || top },
    montclair: { live: other },
    "3d": { live: printer },
  };
  channelCache = { at: Date.now(), value };
  return value;
}

function register(app) {
  loadState();
  reconcile();
  setInterval(reconcile, RECONCILE_MS);

  app.get("/api/feeds", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ feeds: feedStates() });
  });

  // On-air state per channel for the feralcreative.tv hub. Public, like GET /api/feeds.
  app.get("/api/channels", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ channels: await channelStates() });
  });

  app.put("/api/feeds/:feed", requireAdmin, async (req, res) => {
    const { feed } = req.params;
    if (!FEEDS[feed]) return res.status(404).json({ error: "Unknown feed" });
    if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    try {
      await setFeed(feed, req.body.enabled);
      console.log(`[FEEDS] ${req.adminEmail} turned ${feed} ${req.body.enabled ? "on" : "off"}`);
      res.json({ feeds: feedStates() });
    } catch (error) {
      console.error(`[FEEDS] Failed to turn ${feed} ${req.body.enabled ? "on" : "off"}:`, error.stack);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { register };
