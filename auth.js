// Google sign-in for every feralcreative.tv page. The backend owns the access list:
// signing in trades the Google token for a session cookie, and GET /api/session says
// who you are and which channels you may watch. nginx enforces the same list on every
// stream, so nothing here is a security boundary; it only decides what to show.
// A page names its channel with <body data-channel="...">; the hub names none.
class GoogleAuth {
  constructor() {
    this.user = null;
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

  init() {
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: (response) => this.handleCredentialResponse(response),
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

  async signOut() {
    console.log(`[AUTH] User logged out: ${this.user?.email}`);
    this.user = null;
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
  auth.init();
  auth.renderSignInButton();
});
