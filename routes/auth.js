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
      callbackURL: "http://localhost:5000/auth/callback",
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
router.get("/login", passport.authenticate("asgardeo"));

router.get(
  "/callback",
  passport.authenticate("asgardeo", {
    successRedirect: "/auth/success",
    failureRedirect: "/auth/failure",
  })
);

// Success and failure endpoints
router.get("/success", (req, res) => {
  res.redirect(process.env.CORS_ORIGIN || "http://localhost:3000");
});

router.get("/failure", (req, res) => {
  res.status(401).json({ success: false, message: "Authentication failed" });
});

// User info endpoint
router.get("/user", (req, res) => {
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
  const idToken = req.user?.idToken;

  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    
    var params = {
      post_logout_redirect_uri: process.env.CORS_ORIGIN || "http://localhost:3000/auth/signin",
      client_id: process.env.ASGARDEO_CLIENT_ID,
    };

    if (idToken) {
      params.id_token_hint = idToken;
    }

    res.json({
      success: true,
      logoutUrl: ASGARDEO_BASE_URL +
        process.env.ASGARDEO_ORGANISATION +
        "/oidc/logout?" +
        qs.stringify(params)
    });
  });
});

module.exports = router;
  