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

// Helper function to determine the callback URL based on environment
function getAppropriateCallbackUrl(req) {
  // Check if running locally
  const host = req.headers.host || '';
  
  if (host.includes('localhost')) {
    console.log("Using localhost callback URL for local development");
    return "http://localhost:5000/auth/callback";
  } else {
    console.log("Using production callback URL");
    return "https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback";
  }
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
      // Use a dynamic callback URL that will be overridden in the routes
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
  
  // Get the host from the request
  const host = req.headers.host || '';
  console.log("Host header:", host);
  
  // Use the appropriate callback URL based on environment
  const callbackUrl = getAppropriateCallbackUrl(req);
  
  console.log("Using callback URL for login:", callbackUrl);
  
  // Create a custom passport authenticator with the selected callback URL
  const authenticator = passport.authenticate("asgardeo", {
    callbackURL: callbackUrl
  });
  
  // Use the custom authenticator
  authenticator(req, res, next);
});

router.get(
  "/callback",
  (req, res, next) => {
    console.log("Callback received with query:", req.query);
    
    // Use the same callback URL determination logic
    const callbackUrl = getAppropriateCallbackUrl(req);
    
    console.log("Using callback URL for callback handler:", callbackUrl);
    
    // Store it in the request for the authenticator to use
    req.authCallbackURL = callbackUrl;
    
    next();
  },
  (req, res, next) => {
    // Create a custom passport authenticator with the dynamic callback URL
    const authenticator = passport.authenticate("asgardeo", {
      callbackURL: req.authCallbackURL,
      successRedirect: "/auth/success",
      failureRedirect: "/auth/failure",
    });
    
    // Use the custom authenticator
    authenticator(req, res, next);
  }
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

// Debug endpoint to check callback URL
router.get("/debug-callback", (req, res) => {
  const callbackUrl = getAppropriateCallbackUrl(req);
  
  res.json({
    callbackUrl: callbackUrl,
    headers: {
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      CALLBACK_URL: process.env.CALLBACK_URL,
      CORS_ORIGIN: process.env.CORS_ORIGIN
    }
  });
});

// Debug endpoint to test Asgardeo configuration
router.get("/debug-config", (req, res) => {
  // Get the passport strategy
  const strategy = passport._strategies['asgardeo'];
  
  // Extract configuration (but don't expose secrets)
  const config = {
    issuer: strategy._options.issuer,
    authorizationURL: strategy._options.authorizationURL,
    tokenURL: strategy._options.tokenURL,
    userInfoURL: strategy._options.userInfoURL,
    clientID: strategy._options.clientID ? 'Set' : 'Not set',
    clientSecret: strategy._options.clientSecret ? 'Set' : 'Not set',
    callbackURL: strategy._options.callbackURL,
    scope: strategy._options.scope
  };
  
  res.json({
    config: config,
    requestUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
    headers: {
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer
    }
  });
});

module.exports = router;
  