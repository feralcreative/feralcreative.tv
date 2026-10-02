// Shared Google OAuth configuration for Feral TV viewers and feed admin
const CONFIG = {
  // Development mode - set to true to bypass authentication (localhost only)
  DEV_MODE: true,

  // Google OAuth 2.0 Client ID
  // Get this from: https://console.cloud.google.com/apis/credentials
  // Create OAuth 2.0 Client ID > Web application
  // Add authorized JavaScript origins:
  //   - http://localhost (for local development)
  //   - https://cats.feralcreative.co (legacy cats viewer)
  //   - https://montclair.tv (Montclair viewer)
  // Migration requires separately adding the new origins before release:
  //   - https://cats.feralcreative.tv (cats viewer)
  //   - https://feralcreative.tv (feed admin)
  GOOGLE_CLIENT_ID: "233064289536-85l4kha72ecka84gmf6f2d1bgkn3h16g.apps.googleusercontent.com",

  // Restrict to specific email addresses or domains
  // Leave empty array [] to allow any Google account
  ALLOWED_EMAILS: [
    "@feralcreative.co",
    "@cannonballcreative.agency",
    "ziadezzat@gmail.com",
    "rhobbs007@gmail.com",
    "ziadandrebecca@gmail.com",
    "zmezzat@gmail.com",
    "brian.donnellan@gmail.com",
    "aschur@gmail.com",
    "dslavik@gmail.com",
    "dylan.seidner@gmail.com",
    "dizzydezidee@gmail.com",
    "tess.evans@gmail.com",
    "tyler.phelps@gmail.com",
    "daveablees@gmail.com",
    "ohbandit@gmail.com",
    "connormstock@gmail.com",
    "epdale@gmail.com",
    "jpenick@gmail.com",
    "melanie.sensarn@gmail.com",
    "nancyricken@gmail.com",
    "lmftnancylyle@gmail.com",
    "yakamoosedev@gmail.com",
    "dave@trifoxdesigns.com",
  ],
    ADVANCED_FEATURES: [
    "@feralcreative.co",
    "ziadezzat@gmail.com",
    "rhobbs007@gmail.com"]
};
