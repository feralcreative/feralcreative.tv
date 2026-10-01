// Feed admin panel. Always uses a real Google sign-in (DEV_MODE does not apply):
// the backend verifies the ID token, so a fabricated dev user cannot toggle feeds.
const TOKEN_KEY = "adminCredential";
let memoryToken = null; // fallback when sessionStorage is unavailable

function parseJwt(token) {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decodeURIComponent(atob(base64).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")));
}

// Google ID tokens last an hour; treat one as expired a minute early.
function storedToken() {
  let token = memoryToken;
  try {
    token = token || sessionStorage.getItem(TOKEN_KEY);
  } catch (error) {}
  if (token && parseJwt(token).exp * 1000 > Date.now() + 60000) return token;
  return null;
}

function showLogin(message) {
  memoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch (error) {}
  document.getElementById("admin-panel").hidden = true;
  document.getElementById("login-screen").style.display = "flex";
  const errorDiv = document.getElementById("error-message");
  errorDiv.textContent = message || "";
  errorDiv.style.display = message ? "block" : "none";
  google.accounts.id.renderButton(document.getElementById("google-signin-button"), {
    theme: "filled_blue",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
  });
}

function showPanel(token) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("admin-panel").hidden = false;
  document.getElementById("user-email").textContent = parseJwt(token).email;
  loadFeeds();
}

function showError(message) {
  const el = document.getElementById("feed-error");
  el.textContent = message || "";
  el.hidden = !message;
}

function renderFeeds(feeds) {
  const list = document.getElementById("feed-list");
  list.innerHTML = "";
  for (const [key, feed] of Object.entries(feeds)) {
    const item = document.createElement("li");
    item.className = "feed-row";

    const label = document.createElement("span");
    label.className = "feed-name";
    label.id = `feed-label-${key}`;
    label.textContent = feed.name;

    const state = document.createElement("span");
    state.className = `status ${feed.enabled ? "connected" : "offline"}`;
    state.textContent = feed.enabled ? "On" : "Off";

    const toggle = document.createElement("button");
    toggle.className = "feed-switch";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(feed.enabled));
    toggle.setAttribute("aria-labelledby", label.id);
    toggle.addEventListener("click", () => setFeed(key, !feed.enabled, toggle));

    item.append(label, state, toggle);
    list.append(item);
  }
}

async function loadFeeds() {
  try {
    const response = await fetch("/api/feeds", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderFeeds((await response.json()).feeds);
    showError("");
  } catch (error) {
    console.error("[ADMIN] Failed to load feeds:", error);
    showError("Could not load feed status. Is the backend running?");
  }
}

async function setFeed(feed, enabled, toggle) {
  const token = storedToken();
  if (!token) return showLogin("Your sign-in expired. Sign in again to continue.");
  toggle.disabled = true;
  toggle.classList.add("busy");
  try {
    const response = await fetch(`/api/feeds/${feed}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) return showLogin(data.error || "Sign in again to continue.");
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    console.log(`[ADMIN] Turned ${feed} ${enabled ? "on" : "off"}`);
    renderFeeds(data.feeds);
    showError("");
  } catch (error) {
    console.error(`[ADMIN] Failed to turn ${feed} ${enabled ? "on" : "off"}:`, error);
    showError(`Could not turn ${feed} ${enabled ? "on" : "off"}: ${error.message}`);
    toggle.disabled = false;
    toggle.classList.remove("busy");
  }
}

window.addEventListener("load", () => {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: (response) => {
      memoryToken = response.credential;
      try {
        sessionStorage.setItem(TOKEN_KEY, response.credential);
      } catch (error) {
        console.error("[ADMIN] Could not store sign-in:", error);
      }
      console.log(`[ADMIN] Signed in: ${parseJwt(response.credential).email}`);
      showPanel(response.credential);
    },
  });

  document.getElementById("sign-out").addEventListener("click", () => {
    google.accounts.id.disableAutoSelect();
    showLogin();
  });

  const token = storedToken();
  if (token) showPanel(token);
  else showLogin();
});
