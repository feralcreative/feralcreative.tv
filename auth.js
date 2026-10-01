// Google Authentication Handler for Cat Cams
class GoogleAuth {
  constructor() {
    this.user = null;
    this.isInitialized = false;
  }

  // Initialize Google Sign-In
  async init() {
    return new Promise((resolve, reject) => {
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: (response) => this.handleCredentialResponse(response),
      });

      this.isInitialized = true;
      resolve();
    });
  }

  // Handle the credential response from Google
  handleCredentialResponse(response) {
    try {
      // Decode the JWT token to get user info
      const payload = this.parseJwt(response.credential);

      // Check if email is allowed
      if (!this.isEmailAllowed(payload.email)) {
        this.showError(`Access denied. Email ${payload.email} is not authorized.`);
        return;
      }

      // Store user info
      this.user = {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        credential: response.credential,
      };

      // Store in localStorage for persistent login
      localStorage.setItem("user", JSON.stringify(this.user));

      console.log(`[AUTH] User logged in: ${this.user.email}`);

      // Update UI
      this.onAuthStateChanged();
    } catch (error) {
      console.error("[AUTH] Authentication error:", error);
      this.showError("Authentication failed. Please try again.");
    }
  }

  // Check if email is allowed based on CONFIG
  isEmailAllowed(email) {
    // If no restrictions, allow all
    if (!CONFIG.ALLOWED_EMAILS || CONFIG.ALLOWED_EMAILS.length === 0) {
      return true;
    }

    // Check against allowed emails/domains
    return CONFIG.ALLOWED_EMAILS.some((allowed) => {
      if (allowed.startsWith("@")) {
        // Domain check
        return email.endsWith(allowed);
      } else {
        // Exact email check
        return email === allowed;
      }
    });
  }

  // Check if user has advanced features (ONVIF controls, etc.)
  hasAdvancedFeatures() {
    if (!this.user || !this.user.email) {
      return false;
    }

    // If no advanced features list, deny all
    if (!CONFIG.ADVANCED_FEATURES || CONFIG.ADVANCED_FEATURES.length === 0) {
      return false;
    }

    // Check against advanced features emails/domains
    return CONFIG.ADVANCED_FEATURES.some((allowed) => {
      if (allowed.startsWith("@")) {
        // Domain check
        return this.user.email.endsWith(allowed);
      } else {
        // Exact email check
        return this.user.email === allowed;
      }
    });
  }

  // Parse JWT token
  parseJwt(token) {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
    return JSON.parse(jsonPayload);
  }

  // Render the sign-in button
  renderSignInButton() {
    google.accounts.id.renderButton(document.getElementById("google-signin-button"), {
      theme: "filled_blue",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
    });
  }

  // Check if user is already signed in (from localStorage)
  checkSession() {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      this.user = JSON.parse(storedUser);
      console.log(`[AUTH] Session restored for: ${this.user.email}`);
      this.onAuthStateChanged();
      return true;
    }
    return false;
  }

  // Sign out
  signOut() {
    console.log(`[AUTH] User logged out: ${this.user?.email}`);
    this.user = null;
    localStorage.removeItem("user");
    google.accounts.id.disableAutoSelect();
    this.onAuthStateChanged();
  }

  // Update UI based on auth state
  onAuthStateChanged() {
    const loginScreen = document.getElementById("login-screen");
    const streamContainer = document.getElementById("stream-container");
    const userEmail = document.getElementById("user-email");

    if (this.user) {
      // User is signed in
      loginScreen.style.display = "none";
      streamContainer.style.display = "block";
      if (userEmail) {
        userEmail.textContent = this.user.email;
      }

      // Initialize camera streams
      if (typeof initializeCameras === "function") {
        initializeCameras();
      }
    } else {
      // User is signed out
      loginScreen.style.display = "flex";
      streamContainer.style.display = "none";
    }
  }

  // Show error message
  showError(message) {
    const errorDiv = document.getElementById("error-message");
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.style.display = "block";
      setTimeout(() => {
        errorDiv.style.display = "none";
      }, 5000);
    }
  }
}

// Initialize auth when page loads
let auth;
window.addEventListener("load", async () => {
  console.log("[AUTH] Page loaded, initializing auth...");
  console.log("[AUTH] Hostname:", window.location.hostname);
  console.log("[AUTH] DEV_MODE:", CONFIG.DEV_MODE);

  auth = new GoogleAuth();

  // Check if in dev mode (only works on localhost)
  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
  console.log("[AUTH] Is localhost:", isLocalhost);

  if (CONFIG.DEV_MODE && isLocalhost) {
    console.log("[AUTH] DEV_MODE enabled - bypassing authentication");
    // Bypass authentication in dev mode
    // Use an email that has advanced features access
    auth.user = {
      email: "dev@feralcreative.co",
      name: "Developer (Local)",
      picture: null,
      credential: null,
    };
    console.log("[AUTH] Dev user set:", auth.user);
    auth.onAuthStateChanged();
    console.log("[AUTH] onAuthStateChanged called");
    return;
  }

  console.log("[AUTH] Not in dev mode, checking session...");
  // Check if already signed in
  if (!auth.checkSession()) {
    console.log("[AUTH] No session found, initializing Google Sign-In...");
    // Wait for Google API to load, then initialize
    await auth.init();
    auth.renderSignInButton();
  }
});
