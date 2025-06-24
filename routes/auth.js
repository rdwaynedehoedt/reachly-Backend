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

// Helper function to determine if running locally
function isLocalEnvironment(req) {
  const host = req.headers.host || '';
  return host.includes('localhost') || host.includes('127.0.0.1');
}

// Helper function to determine the callback URL based on environment
function getAppropriateCallbackUrl(req) {
  // Check if running locally
  if (isLocalEnvironment(req)) {
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
      // Use the fixed callback URL that's registered in Asgardeo
      callbackURL: "https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback",
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
  
  // Check if running locally
  if (isLocalEnvironment(req)) {
    // For local development, use a different strategy configuration
    console.log("Using local development configuration");
    
    const authenticator = passport.authenticate("asgardeo", {
      callbackURL: "http://localhost:5000/auth/callback"
    });
    
    authenticator(req, res, next);
  } else {
    // For production, use the fixed callback URL
    console.log("Using production configuration");
    
    // Store the callback URL in the session for later use
    const callbackUrl = "https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback";
    req.session.callbackUrl = callbackUrl;
    
    // Log the exact URL for debugging
    console.log("EXACT CALLBACK URL:", callbackUrl);
    console.log("URL LENGTH:", callbackUrl.length);
    console.log("URL CHARACTERS:", [...callbackUrl].map(c => c.charCodeAt(0)));
    
    const authenticator = passport.authenticate("asgardeo", {
      callbackURL: callbackUrl
    });
    
    authenticator(req, res, next);
  }
});

router.get(
  "/callback",
  (req, res, next) => {
    console.log("Callback received with query:", req.query);
    
    // Check if running locally
    if (isLocalEnvironment(req)) {
      console.log("Using local development callback URL");
      req.authCallbackURL = "http://localhost:5000/auth/callback";
    } else {
      console.log("Using production callback URL");
      req.authCallbackURL = "https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback";
    }
    
    next();
  },
  (req, res, next) => {
    // Create a custom passport authenticator with the appropriate callback URL
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
  try {
    // Get the passport strategy
    const strategy = passport._strategies['asgardeo'];
    
    if (!strategy || !strategy._options) {
      return res.json({
        error: "Strategy not properly initialized",
        availableStrategies: Object.keys(passport._strategies)
      });
    }
    
    // Extract configuration (but don't expose secrets)
    const config = {
      issuer: strategy._options.issuer || 'Not set',
      authorizationURL: strategy._options.authorizationURL || 'Not set',
      tokenURL: strategy._options.tokenURL || 'Not set',
      userInfoURL: strategy._options.userInfoURL || 'Not set',
      clientID: strategy._options.clientID ? 'Set' : 'Not set',
      clientSecret: strategy._options.clientSecret ? 'Set' : 'Not set',
      callbackURL: strategy._options.callbackURL || 'Not set',
      scope: strategy._options.scope || []
    };
    
    res.json({
      config: config,
      requestUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
      headers: {
        host: req.headers.host,
        origin: req.headers.origin,
        referer: req.headers.referer
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        CORS_ORIGIN: process.env.CORS_ORIGIN
      }
    });
  } catch (error) {
    // Send a safe error response
    res.status(500).json({
      error: "Error retrieving configuration",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Simple debug endpoint
router.get("/debug-simple", (req, res) => {
  res.json({
    message: "Auth routes are working",
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'Not set',
      CORS_ORIGIN: process.env.CORS_ORIGIN || 'Not set',
      CALLBACK_URL: process.env.CALLBACK_URL || 'Not set'
    },
    request: {
      host: req.headers.host,
      origin: req.headers.origin,
      referer: req.headers.referer,
      url: req.originalUrl,
      method: req.method
    }
  });
});

// Test endpoint to check the exact callback URL
router.get("/test-callback-url", (req, res) => {
  const registeredUrl = "https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback";
  const urlFromEnv = process.env.CALLBACK_URL;
  
  res.json({
    registeredUrl: {
      value: registeredUrl,
      length: registeredUrl.length,
      characters: [...registeredUrl].map(c => ({ char: c, code: c.charCodeAt(0) }))
    },
    envUrl: {
      value: urlFromEnv,
      length: urlFromEnv ? urlFromEnv.length : 0,
      characters: urlFromEnv ? [...urlFromEnv].map(c => ({ char: c, code: c.charCodeAt(0) })) : []
    },
    match: registeredUrl === urlFromEnv
  });
});

// Simple login route for testing
router.get("/login-simple", (req, res) => {
  // Construct the authorization URL manually
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ASGARDEO_CLIENT_ID,
    redirect_uri: 'https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback-simple',
    scope: 'openid profile email',
    state: 'simple-test'
  });
  
  const authUrl = `${ASGARDEO_BASE_URL}${process.env.ASGARDEO_ORGANISATION}/oauth2/authorize?${authParams.toString()}`;
  
  console.log("Simple login - Redirecting to:", authUrl);
  
  // Redirect to the authorization URL
  res.redirect(authUrl);
});

// Simple callback handler for testing
router.get("/callback-simple", async (req, res) => {
  try {
    console.log("Simple callback received with query:", req.query);
    
    // Check if there's an error
    if (req.query.error) {
      console.error("OAuth error:", req.query.error, req.query.error_description);
      return res.status(400).json({
        error: req.query.error,
        error_description: req.query.error_description
      });
    }
    
    // Check if there's a code
    if (!req.query.code) {
      console.error("No authorization code received");
      return res.status(400).json({ error: "No authorization code received" });
    }
    
    // Exchange the code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: 'https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback-simple',
      client_id: process.env.ASGARDEO_CLIENT_ID,
      client_secret: process.env.ASGARDEO_CLIENT_SECRET
    });
    
    const tokenUrl = `${ASGARDEO_BASE_URL}${process.env.ASGARDEO_ORGANISATION}/oauth2/token`;
    
    console.log("Requesting tokens from:", tokenUrl);
    
    // Make the token request
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });
    
    const tokenData = await response.json();
    
    console.log("Token response status:", response.status);
    
    if (!response.ok) {
      console.error("Token request failed:", tokenData);
      return res.status(response.status).json(tokenData);
    }
    
    console.log("Tokens received successfully");
    
    // Store tokens in session
    req.session.accessToken = tokenData.access_token;
    req.session.idToken = tokenData.id_token;
    req.session.refreshToken = tokenData.refresh_token;
    
    // Get user info
    const userInfoUrl = `${ASGARDEO_BASE_URL}${process.env.ASGARDEO_ORGANISATION}/oauth2/userinfo`;
    
    const userInfoResponse = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    const userData = await userInfoResponse.json();
    
    console.log("User info received");
    
    // Store user data in session
    req.session.user = userData;
    req.session.isAuthenticated = true;
    
    // Redirect to frontend
    res.redirect(process.env.CORS_ORIGIN || "http://localhost:3000");
  } catch (error) {
    console.error("Error in simple callback:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// Test endpoint to display all possible callback URLs
router.get("/test-all-urls", (req, res) => {
  // Generate all possible variations of the callback URL
  const baseUrl = "https://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev";
  
  const possibleUrls = [
    // Original URL
    `${baseUrl}/reachly/reachly-backend/v1.0/auth/callback`,
    
    // Without trailing slash
    `${baseUrl}/reachly/reachly-backend/v1.0/auth/callback`,
    
    // With trailing slash
    `${baseUrl}/reachly/reachly-backend/v1.0/auth/callback/`,
    
    // Simple callback
    `${baseUrl}/reachly/reachly-backend/v1.0/auth/callback-simple`,
    
    // Without v1.0
    `${baseUrl}/reachly/reachly-backend/auth/callback`,
    
    // Without reachly-backend
    `${baseUrl}/reachly/auth/callback`,
    
    // Just the domain
    `${baseUrl}/auth/callback`,
    
    // With development
    `${baseUrl}-dev/reachly/reachly-backend/v1.0/auth/callback`,
    
    // With www
    `https://www.606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback`,
    
    // HTTP instead of HTTPS
    `http://606464b5-77c7-4bb1-a1b9-9d05cefa3519-dev.e1-us-east-azure.choreoapis.dev/reachly/reachly-backend/v1.0/auth/callback`
  ];
  
  // Create HTML with links to test each URL
  let html = '<h1>Test All Possible Callback URLs</h1>';
  html += '<p>Click each link to test if it works with Asgardeo:</p>';
  html += '<ul>';
  
  possibleUrls.forEach((url, index) => {
    const authUrl = `${ASGARDEO_BASE_URL}${process.env.ASGARDEO_ORGANISATION}/oauth2/authorize?response_type=code&client_id=${process.env.ASGARDEO_CLIENT_ID}&redirect_uri=${encodeURIComponent(url)}&scope=openid%20profile%20email&state=test-${index}`;
    
    html += `<li><a href="${authUrl}" target="_blank">${url}</a></li>`;
  });
  
  html += '</ul>';
  html += '<p>Add these URLs to your Asgardeo authorized redirect URLs and try again.</p>';
  
  res.send(html);
});

// Direct test route with minimal parameters
router.get("/direct-test", (req, res) => {
  // Minimal authorization URL with just the required parameters
  const authUrl = `${ASGARDEO_BASE_URL}${process.env.ASGARDEO_ORGANISATION}/oauth2/authorize?response_type=code&client_id=${process.env.ASGARDEO_CLIENT_ID}&scope=openid`;
  
  console.log("Direct test - Redirecting to:", authUrl);
  
  // Redirect to the authorization URL without a redirect_uri
  // This will make Asgardeo use the default redirect URI registered for the client
  res.redirect(authUrl);
});

module.exports = router;
  