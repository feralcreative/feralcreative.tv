// Google sign-in, or an emailed link for listed friends without Google, for every
// feralcreative.tv page. A friend signed in with a link can add a Google account and use
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
    if (document.getElementById("email-link-form")) return;
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
        body: JSON.stringify({ email: form.querySelector("input").value }),
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
      <button type="button" class="add-google-dismiss">Not now</button>`;
    document.body.append(panel);
    this.addGooglePanel = panel;
    panel.querySelector(".add-google-dismiss").addEventListener("click", () => {
      try {
        sessionStorage.setItem("fctv-add-google-dismissed", "1");
      } catch (error) {}
      panel.remove();
      this.addGooglePanel = null;
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
      panel.querySelector(".add-google-dismiss").textContent = "Close";
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
    this.onAuthStateChanged();
    this.renderSignInButtonWhenReady();
  }

  renderSignInButtonWhenReady() {
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

  if (await auth.restore()) {
    console.log(`[AUTH] Session restored for: ${auth.user.email}`);
    auth.onAuthStateChanged();
    return;
  }

  console.log("[AUTH] No session, showing Google Sign-In");
  auth.renderEmailLinkForm();
  auth.init();
  auth.renderSignInButton();
});
