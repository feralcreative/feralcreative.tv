// Feed and access admin. Uses the same session cookie as the viewers; the backend
// checks that the signed-in email is an admin on every change.
let camerasStarted = false;
// app.js reads `auth` for PTZ access; the admin page never shows PTZ controls.
const auth = { hasAdvancedFeatures: () => false };
let access = { channels: [], owners: [], entries: [] };

function showLogin(message) {
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

function showPanel(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("admin-panel").hidden = false;
  document.getElementById("user-email").textContent = user.email;
  if (!camerasStarted) {
    camerasStarted = true;
    initializeCameras();
    setInterval(loadFeeds, 15000);
  }
  loadFeeds();
  loadAccess();
}

// Show the panel for an admin session, or the sign-in screen with the reason.
function handleUser(user) {
  if (!user) return showLogin();
  if (!user.admin) return showLogin(`${user.email} is not an admin.`);
  console.log(`[ADMIN] Signed in: ${user.email}`);
  showPanel(user);
}

function showError(message) {
  const el = document.getElementById("feed-error");
  el.textContent = message || "";
  el.hidden = !message;
}

function renderFeeds(feeds) {
  for (const toggle of document.querySelectorAll(".feed-switch")) {
    const feed = feeds[toggle.dataset.feed];
    if (!feed) continue;
    toggle.setAttribute("aria-checked", String(feed.enabled));
    toggle.disabled = false;
    toggle.classList.remove("busy");
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
  toggle.disabled = true;
  toggle.classList.add("busy");
  try {
    const response = await fetch(`/api/feeds/${feed}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) return showLogin(data.error || "Sign in again to continue.");
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    console.log(`[ADMIN] Turned ${feed} ${enabled ? "on" : "off"}`);
    renderFeeds(data.feeds);
    showError("");
    pollFeeds(); // update the tile now rather than on app.js's next poll
  } catch (error) {
    console.error(`[ADMIN] Failed to turn ${feed} ${enabled ? "on" : "off"}:`, error);
    showError(`Could not turn ${feed} ${enabled ? "on" : "off"}: ${error.message}`);
    toggle.disabled = false;
    toggle.classList.remove("busy");
  }
}

// ---- Access list ----

function accessMessage(text, isError) {
  const errorEl = document.getElementById("access-error");
  const statusEl = document.getElementById("access-status");
  errorEl.textContent = isError ? text : "";
  errorEl.hidden = !isError;
  statusEl.textContent = isError ? "" : text;
}

function isOwner(match) {
  return access.owners.includes(match);
}

// Mirrors the backend: an address is an admin through the owner list, its own entry, or an
// admin @domain. Such addresses sign in with Google only, so Email link is not offered.
function isEffectiveAdmin(entry) {
  const covers = (pattern) => (pattern.startsWith("@") ? entry.match.endsWith(pattern) : entry.match === pattern);
  return entry.admin || access.owners.some(covers) || access.entries.some((other) => other.admin && covers(other.match));
}

function checkbox(label, checked, onChange, disabled) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = Boolean(disabled);
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

function renderAccess() {
  document.getElementById("access-owners").textContent = access.owners.length
    ? `Always admins: ${access.owners.join(", ")}.`
    : "";
  const tbody = document.getElementById("access-rows");
  tbody.replaceChildren();
  const sorted = [...access.entries].sort((a, b) => Number(b.admin) - Number(a.admin) || a.match.localeCompare(b.match));
  for (const entry of sorted) {
    const row = document.createElement("tr");
    row.classList.toggle("is-owner", isOwner(entry.match));
    const name = document.createElement("td");
    name.textContent = entry.match;
    row.append(name);
    for (const channel of access.channels) {
      const cell = document.createElement("td");
      cell.append(
        checkbox(`${entry.match}: ${channel}`, entry.admin || entry.channels.includes(channel), (on) => {
          entry.channels = on ? [...entry.channels, channel] : entry.channels.filter((c) => c !== channel);
          saveAccess();
        }, entry.admin),
      );
      row.append(cell);
    }
    const adminCell = document.createElement("td");
    adminCell.append(
      checkbox(`${entry.match}: admin`, entry.admin, (on) => {
        entry.admin = on;
        if (on) {
          entry.channels = [...access.channels];
          delete entry.email_link; // admins sign in with Google only
        }
        saveAccess();
      }),
    );
    row.append(adminCell);
    // Emailed sign-in links: single addresses that are not admins (the backend enforces it too).
    const linkCell = document.createElement("td");
    linkCell.append(
      checkbox(`${entry.match}: email link`, Boolean(entry.email_link), (on) => {
        if (on) entry.email_link = true;
        else delete entry.email_link;
        saveAccess();
      }, entry.match.startsWith("@") || isEffectiveAdmin(entry)),
    );
    row.append(linkCell);
    const removeCell = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "access-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${entry.match}`);
    remove.addEventListener("click", () => {
      if (!confirm(`Remove ${entry.match}? They lose access on their next request.`)) return;
      access.entries = access.entries.filter((e) => e !== entry);
      saveAccess();
    });
    removeCell.append(remove);
    row.append(removeCell);
    tbody.append(row);
  }
}

async function loadAccess() {
  try {
    const response = await fetch("/api/access", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) return showLogin("Sign in again to continue.");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    access = await response.json();
    renderAccess();
    accessMessage("");
  } catch (error) {
    console.error("[ADMIN] Failed to load the access list:", error);
    accessMessage("Could not load the access list.", true);
  }
}

async function saveAccess() {
  renderAccess();
  accessMessage("Saving…");
  try {
    const response = await fetch("/api/access", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: access.entries }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) return showLogin(data.error || "Sign in again to continue.");
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    access = data;
    renderAccess();
    accessMessage("Saved.");
    console.log(`[ADMIN] Saved ${access.entries.length} access entries`);
  } catch (error) {
    console.error("[ADMIN] Failed to save the access list:", error);
    accessMessage(`Not saved: ${error.message}`, true);
    loadAccess();
  }
}

function addAccess(event) {
  event.preventDefault();
  const input = document.getElementById("access-new");
  const match = input.value.trim().toLowerCase();
  if (!match) return;
  if (access.entries.some((entry) => entry.match === match)) {
    accessMessage(`${match} is already on the list.`, true);
    return;
  }
  access.entries.push({ match, channels: [...access.channels], admin: false });
  input.value = "";
  saveAccess();
}

window.addEventListener("load", async () => {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: async (response) => {
      const result = await fetch("/api/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) return showLogin(data.error || "Sign-in failed. Try again.");
      handleUser(data);
    },
  });

  for (const toggle of document.querySelectorAll(".feed-switch")) {
    toggle.addEventListener("click", () => setFeed(toggle.dataset.feed, toggle.getAttribute("aria-checked") !== "true", toggle));
  }
  document.getElementById("access-add").addEventListener("submit", addAccess);

  document.getElementById("sign-out").addEventListener("click", async () => {
    await fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    google.accounts.id.disableAutoSelect();
    showLogin();
  });

  const session = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" }).catch(() => null);
  handleUser(session && session.ok ? await session.json() : null);
});
