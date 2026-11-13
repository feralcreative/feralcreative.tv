// Sign-in for every feralcreative.tv page. Everyone signs in at the hub (feralcreative.tv),
// with Google or an emailed link for listed friends without Google. A channel page with no
// session sends the visitor to the hub with ?return=<its origin>&challenge=<hash>; the hub
// signs them in and sends them back to /signin with a one-time code, which signin.html
// redeems with the verifier kept in sessionStorage. A friend signed in with a link can add a Google account and use
// Google from then on. The backend owns the access list:
// signing in trades the Google token for a session cookie, and GET /api/session says
// who you are and which channels you may watch. nginx enforces the same list on every
// stream, so nothing here is a security boundary; it only decides what to show.
// A page names its channel with <body data-channel="...">; the hub names none.
class GoogleAuth {
  constructor() {
    this.user = null;
    this.addGooglePanel = null;
    this.channel = document.body.dataset.channel || null;
    // On the hub: the site a visitor is on their way to, { return, challenge }, and whether
    // it asked for a new Google sign-in (3d does, for printer controls).
    this.onward = null;
    this.fresh = false;
  }

  isHub() {
    return !this.channel;
  }

  hubUrl() {
    const local = location.hostname === "localhost" || location.hostname.endsWith(".localhost");
    return local ? `${location.protocol}//localhost${location.port ? `:${location.port}` : ""}/` : "https://feralcreative.tv/";
  }

  // Channel pages: go to the hub to sign in. The verifier stays here; only its hash goes in
  // the URL, so nothing in history or a log lets anyone else finish this sign-in. On its own
  // this happens at most once every 30 seconds per tab, so a failure cannot loop.
  async leaveForHub(force = false) {
    try {
      const last = Number(sessionStorage.getItem("fctv-left-at") || 0);
      if (!force && Date.now() - last < 30000) return this.renderHubLink();
      const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      sessionStorage.setItem("fctv-verifier", verifier);
      sessionStorage.setItem("fctv-return-path", location.pathname + location.search);
      sessionStorage.setItem("fctv-left-at", String(Date.now()));
      this.renderHubLink("Taking you to feralcreative.tv to sign in…");
      location.assign(`${this.hubUrl()}?return=${encodeURIComponent(location.origin)}&challenge=${challenge}`);
    } catch (error) {
      console.error("[AUTH] Could not start sign-in at the hub:", error);
      this.renderHubLink();
    }
  }

  // Channel pages: the way in when the automatic trip to the hub did not happen.
  renderHubLink(message = "") {
    const anchor = document.getElementById("google-signin-button");
    if (!anchor) return;
    anchor.replaceChildren();
    if (message) {
      anchor.textContent = message;
      return;
    }
    const link = document.createElement("a");
    link.className = "email-link-button";
    link.href = this.hubUrl();
    link.textContent = "Sign in at feralcreative.tv";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      this.leaveForHub(true);
    });
    anchor.append(link);
  }

  // Hub: send a signed-in visitor on to the site they came from, with a one-time code.
  async continueOnward() {
    try {
      const response = await fetch("/api/handoff", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.onward),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        location.replace(data.url);
        return;
      }
      console.error(`[AUTH] Handoff refused: ${data.error}`);
      this.stayOnHub(data.error || "Could not sign you in to that site. Try again.");
    } catch (error) {
      console.error("[AUTH] Handoff failed:", error);
      this.stayOnHub("Could not reach the server. Try again.");
    }
  }

  // Hub: the onward trip is off; show the sign-in screen with the reason, so another
  // account can be tried.
  stayOnHub(message) {
    this.onward = null;
    this.fresh = false;
    history.replaceState(null, "", "/");
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("stream-container").style.display = "none";
    this.showError(message, true);
    this.renderSignInButtonWhenReady();
  }

  // Restore an existing session from the cookie.
  async restore() {
    try {
      const response = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
      if (response.ok) this.user = await response.json();
    } catch (error) {
      console.error("[AUTH] Could not check the session:", error);
    }
    return Boolean(this.user);
  }

  // Google Identity Services keeps one callback per page, so this one serves both buttons:
  // while the add-a-Google-account panel is open the credential goes there, otherwise it
  // signs in.
  init() {
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: (response) => (this.addGooglePanel ? this.addGoogle(response, this.addGooglePanel) : this.handleCredentialResponse(response)),
    });
  }

  async handleCredentialResponse(response) {
    try {
      const result = await fetch("/api/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) {
        this.showError(data.error || "Sign-in failed. Please try again.");
        return;
      }
      this.user = data;
      console.log(`[AUTH] User logged in: ${this.user.email}`);
      if (this.onward) return this.continueOnward();
      this.onAuthStateChanged();
    } catch (error) {
      console.error("[AUTH] Authentication error:", error);
      this.showError("Sign-in failed. Please try again.");
    }
  }

  // PTZ controls and the admin link
  hasAdvancedFeatures() {
    return Boolean(this.user && this.user.admin);
  }

  canWatch(channel = this.channel) {
    if (!this.user) return false;
    return !channel || this.user.admin || this.user.channels.includes(channel);
  }

  renderSignInButton() {
    google.accounts.id.renderButton(document.getElementById("google-signin-button"), {
      theme: "filled_blue",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
    });
  }

  // For listed friends without a Google account: ask the backend to email a one-time link.
  // The answer is the same whether or not the address is on the list.
  renderEmailLinkForm() {
    if (!this.isHub() || this.fresh || document.getElementById("email-link-form")) return;
    const anchor = document.getElementById("google-signin-button");
    if (!anchor) return;
    const form = document.createElement("form");
    form.id = "email-link-form";
    form.className = "email-link-form";
    form.innerHTML = `
      <label for="email-link-address">No Google account? Get a sign-in link by email.</label>
      <div class="email-link-row">
        <input id="email-link-address" type="email" autocomplete="email" required placeholder="you@example.com">
        <button type="submit" class="email-link-button">Email me a link</button>
      </div>
      <p class="email-link-status" role="status"></p>`;
    anchor.after(form);
    form.addEventListener("submit", (event) => this.requestEmailLink(event, form));
  }

  async requestEmailLink(event, form) {
    event.preventDefault();
    const button = form.querySelector("button");
    const status = form.querySelector(".email-link-status");
    button.disabled = true;
    try {
      const response = await fetch("/api/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          this.onward ? { email: form.querySelector("input").value, return: this.onward.return } : { email: form.querySelector("input").value },
        ),
      });
      const data = await response.json().catch(() => ({}));
      status.textContent = data.message || data.error || "Something went wrong. Try again.";
    } catch (error) {
      console.error("[AUTH] Email link request failed:", error);
      status.textContent = "Could not reach the server. Try again.";
    } finally {
      button.disabled = false;
    }
  }

  // For a viewer signed in with an emailed link: add a Google account once, and sign in
  // with Google from then on. The backend stores it on their entry in the access list.
  renderAddGoogle() {
    if (!this.user || !this.user.add_google || !window.google) return;
    if (document.getElementById("add-google")) return;
    try {
      if (sessionStorage.getItem("fctv-add-google-dismissed")) return;
    } catch (error) {}
    const panel = document.createElement("aside");
    panel.id = "add-google";
    panel.className = "add-google";
    panel.setAttribute("aria-label", "Add a Google account");
    panel.innerHTML = `
      <p class="add-google-text">Have a Google account? Add it once and sign in with Google from now&nbsp;on.</p>
      <div id="add-google-button"></div>
      <p class="add-google-status" role="status"></p>
      <button type="button" class="add-google-dismiss"></button>`;
    // On the way to another site, the panel holds the visitor here until they choose.
    panel.querySelector(".add-google-dismiss").textContent = this.onward ? `Continue to ${new URL(this.onward.return).host}` : "Not now";
    document.body.append(panel);
    this.addGooglePanel = panel;
    panel.querySelector(".add-google-dismiss").addEventListener("click", () => {
      try {
        sessionStorage.setItem("fctv-add-google-dismissed", "1");
      } catch (error) {}
      panel.remove();
      this.addGooglePanel = null;
      if (this.onward) this.continueOnward();
    });
    this.init();
    google.accounts.id.renderButton(panel.querySelector("#add-google-button"), {
      theme: "outline",
      size: "medium",
      text: "continue_with",
      shape: "rectangular",
    });
  }

  closeAddGoogle() {
    if (this.addGooglePanel) this.addGooglePanel.remove();
    this.addGooglePanel = null;
  }

  async addGoogle(response, panel) {
    const status = panel.querySelector(".add-google-status");
    try {
      const result = await fetch("/api/magic-link/google", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) {
        status.textContent = data.error || "Could not add that account. Try again.";
        return;
      }
      this.user = data;
      this.addGooglePanel = null; // the panel stays up as a confirmation; Google's button is gone
      console.log(`[AUTH] Added Google account ${data.google} for ${data.email}`);
      panel.querySelector("#add-google-button").remove();
      panel.querySelector(".add-google-text").textContent = `Added. Next time, choose Sign in with Google and pick ${data.google}.`;
      status.textContent = "";
      if (!this.onward) panel.querySelector(".add-google-dismiss").textContent = "Close";
    } catch (error) {
      console.error("[AUTH] Adding a Google account failed:", error);
      status.textContent = "Could not reach the server. Try again.";
    }
  }

  async signOut() {
    console.log(`[AUTH] User logged out: ${this.user?.email}`);
    this.user = null;
    this.closeAddGoogle();
    document.getElementById("add-google")?.remove();
    try {
      await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
    } catch (error) {
      console.error("[AUTH] Sign-out request failed:", error);
    }
    if (window.google) google.accounts.id.disableAutoSelect();
    // Signing out of a channel page also signs out of the hub; otherwise the next visit
    // would go there and come straight back signed in. This site's cookie is gone first.
    if (!this.isHub()) {
      location.assign(`${this.hubUrl()}signout`);
      return;
    }
    this.onAuthStateChanged();
    this.renderSignInButtonWhenReady();
  }

  // The way to sign in: Google and the email form on the hub, a link to the hub elsewhere.
  renderSignInButtonWhenReady() {
    if (!this.isHub()) return this.renderHubLink();
    this.renderEmailLinkForm();
    if (!window.google) return;
    this.init();
    this.renderSignInButton();
  }

  onAuthStateChanged() {
    const loginScreen = document.getElementById("login-screen");
    const streamContainer = document.getElementById("stream-container");
    const userEmail = document.getElementById("user-email");

    if (this.canWatch()) {
      loginScreen.style.display = "none";
      streamContainer.style.display = "block";
      if (userEmail) userEmail.textContent = this.user.email;
      document.dispatchEvent(new CustomEvent("auth:user", { detail: this.user }));
      if (typeof initializeCameras === "function") initializeCameras();
      this.renderAddGoogle();
      return;
    }

    loginScreen.style.display = "flex";
    streamContainer.style.display = "none";
    if (this.user) {
      this.showError(`${this.user.email} doesn't have access to this channel.`, true);
      this.renderSignInButtonWhenReady();
    }
  }

  showError(message, sticky = false) {
    const errorDiv = document.getElementById("error-message");
    if (!errorDiv) return;
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    if (!sticky) {
      setTimeout(() => {
        errorDiv.style.display = "none";
      }, 5000);
    }
  }
}

let auth;
window.addEventListener("load", async () => {
  auth = new GoogleAuth();
  // Sessions used to live in localStorage; the cookie replaces them.
  try {
    localStorage.removeItem("user");
  } catch (error) {}

  if (auth.isHub()) {
    const params = new URLSearchParams(location.search);
    if (params.get("return") && params.get("challenge")) {
      auth.onward = { return: params.get("return"), challenge: params.get("challenge") };
      auth.fresh = params.get("fresh") === "1";
    }
  }

  // fresh asks for a new Google sign-in even when a session exists.
  if (!auth.fresh && (await auth.restore())) {
    console.log(`[AUTH] Session restored for: ${auth.user.email}`);
    if (!auth.onward) return auth.onAuthStateChanged();
    // On the way to another site: go on at once, unless the add-a-Google-account offer is
    // showing, which waits for its Continue button.
    if (auth.user.add_google) {
      auth.onAuthStateChanged();
      if (auth.addGooglePanel) return;
    }
    return auth.continueOnward();
  }

  if (!auth.isHub()) {
    console.log("[AUTH] No session, going to feralcreative.tv to sign in");
    // The hub sends a visitor here with #signed-in after an emailed link; see signin.html.
    const expected = location.hash === "#signed-in";
    if (expected) history.replaceState(null, "", location.pathname + location.search);
    return auth.leaveForHub(expected);
  }

  console.log("[AUTH] No session, showing Google Sign-In");
  if (auth.fresh) {
    const text = document.querySelector("#login-screen p");
    if (text) text.textContent = "Sign in with Google again to use the printer controls.";
  }
  auth.renderSignInButtonWhenReady();
});
