var passport = require("passport");
var AsgardeoStrategy = require("@asgardeo/passport-asgardeo");
const ASGARDEO_BASE_URL = "https://api.asgardeo.io/t/";
var express = require("express");
var qs = require("querystring");
var router = express.Router();

// Check if required environment variables are set
if (!process.env.ASGARDEO_ORGANISATION || !process.env.ASGARDEO_CLIENT_ID || !process.env.ASGARDEO_CLIENT_SECRET) {
  console.error("Missing required environment variables for Asgardeo configuration");
  console.error("Make sure ASGARDEO_ORGANISATION, ASGARDEO_CLIENT_ID, and ASGARDEO_CLIENT_SECRET are set in .env file");
}

// Asgardeo Strategy Configuration
passport.use(
  new AsgardeoStrategy(
    {
      issuer:
        ASGARDEO_BASE_URL + process.env.ASGARDEO_ORGANISATION + "/oauth2/token",
      authorizationURL:
        ASGARDEO_BASE_URL +
        process.env.ASGARDEO_ORGANISATION +
        "/oauth2/authorize",
      tokenURL:
        ASGARDEO_BASE_URL + process.env.ASGARDEO_ORGANISATION + "/oauth2/token",
      userInfoURL:
        ASGARDEO_BASE_URL +
        process.env.ASGARDEO_ORGANISATION +
        "/oauth2/userinfo",
      clientID: process.env.ASGARDEO_CLIENT_ID,
      clientSecret: process.env.ASGARDEO_CLIENT_SECRET,
      callbackURL: process.env.CALLBACK_URL || "http://localhost:5000/auth/callback",
      scope: ["profile", "email"],
    },
    function verify(
      issuer,
      uiProfile,
      idProfile,
      context,
      idToken,
      accessToken,
      refreshToken,
      params,
      verified
    ) {
      return verified(null, {
        uiProfile: uiProfile,
        accessToken: accessToken,
        refreshToken: refreshToken,
        idToken: idToken
      });
    }
  )
);

// Serialize and deserialize user
passport.serializeUser(function (user, cb) {
    process.nextTick(function () {
      cb(null, {
        id: user?.uiProfile?.id,
        username: user?.uiProfile?._json?.username,
        givenName: user?.uiProfile?.name?.givenName,
        familyName: user?.uiProfile?.name?.familyName,
      email: user?.uiProfile?._json?.email,
      accessToken: user?.accessToken,
      refreshToken: user?.refreshToken,
      idToken: user?.idToken
      });
    });
  });
  
  passport.deserializeUser(function (user, cb) {
    process.nextTick(function () {
      return cb(null, user);
    });
  });
  
// Authentication routes
router.get("/login", (req, res, next) => {
  console.log("Login request received");
  console.log("Callback URL configured:", process.env.CALLBACK_URL || "http://localhost:5000/auth/callback");
  passport.authenticate("asgardeo")(req, res, next);
});

router.get(
  "/callback",
  (req, res, next) => {
    console.log("Callback received with query:", req.query);
    next();
  },
  passport.authenticate("asgardeo", {
    successRedirect: "/auth/success",
    failureRedirect: "/auth/failure",
  })
);

// Success and failure endpoints
router.get("/success", (req, res) => {
  console.log("Authentication successful, redirecting to:", process.env.CORS_ORIGIN || "http://localhost:3000");
  res.redirect(process.env.CORS_ORIGIN || "http://localhost:3000");
});

router.get("/failure", (req, res) => {
  res.status(401).json({ success: false, message: "Authentication failed" });
});

// User info endpoint
router.get("/user", (req, res) => {
  console.log("Auth check - User authenticated:", req.isAuthenticated());
  console.log("Auth check - Session:", req.session);
  console.log("Auth check - Cookies:", req.headers.cookie);
  
  if (req.isAuthenticated()) {
    res.json({ 
      success: true, 
      user: req.user,
      isAuthenticated: true 
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: "Not authenticated",
      isAuthenticated: false 
    });
  }
});

// Logout endpoint
router.post("/logout", function (req, res, next) {
  // Get ID token from user session
  const idToken = req.user?.idToken;
  
  // Debug user session and ID token
  console.log("User session during logout:", req.user);
  console.log("ID token available:", !!idToken);
  
  if (!idToken) {
    console.error("ID token is missing from the session. This will cause incomplete logout.");
    // Continue with logout anyway, but it won't be a complete IdP logout
  }

  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    
    // Make sure the redirect URI includes the /auth/signin path
    const baseRedirectUri = process.env.CORS_ORIGIN || "http://localhost:3000";
    const fullRedirectUri = `${baseRedirectUri}/auth/signin`;
    
    // Properly encode all parameters
    const postLogoutRedirectUri = encodeURIComponent(fullRedirectUri);
    const clientId = encodeURIComponent(process.env.ASGARDEO_CLIENT_ID);
    const organisation = encodeURIComponent(process.env.ASGARDEO_ORGANISATION);
    
    // Construct the logout URL
    let logoutUrl = `${ASGARDEO_BASE_URL}${organisation}/oidc/logout?post_logout_redirect_uri=${postLogoutRedirectUri}&client_id=${clientId}`;
    
    // Add ID token hint if available
    if (idToken) {
      logoutUrl += `&id_token_hint=${encodeURIComponent(idToken)}`;
      console.log("Added ID token hint to logout URL");
    } else {
      console.warn("No ID token available for logout. This may cause incomplete logout at the IdP level.");
    }
    
    // Log the constructed URL for testing
    console.log("Logout URL:", logoutUrl);
    
    res.json({
      success: true,
      logoutUrl: logoutUrl
    });
  });
});

module.exports = router;
  