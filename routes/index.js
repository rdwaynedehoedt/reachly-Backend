var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  if (req.isAuthenticated()) {
    res.render("index", { title: "Express" });
  } else {
    res.render("login", { title: "Express" });
  }
});

// Debug endpoint to check environment variables (only in development)
router.get('/debug-env', function(req, res) {
  // Only allow in development environment
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  
  // Return relevant environment variables (without exposing secrets)
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    CALLBACK_URL: process.env.CALLBACK_URL,
    ASGARDEO_ORGANISATION: process.env.ASGARDEO_ORGANISATION ? 'Set' : 'Not set',
    ASGARDEO_CLIENT_ID: process.env.ASGARDEO_CLIENT_ID ? 'Set' : 'Not set',
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN
  });
});

module.exports = router;
