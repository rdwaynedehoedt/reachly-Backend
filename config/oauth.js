/**
 * OAuth Configuration for Enterprise-Scale Architecture
 * Separates user authentication from email integration OAuth
 */

require('dotenv').config();
const { OAuth2Client } = require('google-auth-library');

// User Authentication OAuth Client (for login/signup)
const authOAuthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Email Integration OAuth Client (for Gmail API access)
const emailOAuthClient = new OAuth2Client(
  process.env.EMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
  process.env.EMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  process.env.EMAIL_OAUTH_REDIRECT_URI || 'http://localhost:5000/auth/google/callback'
);

module.exports = {
  authOAuthClient,
  emailOAuthClient,
  
  // Helper function to get the right client for the purpose
  getOAuthClient: (purpose = 'auth') => {
    switch (purpose) {
      case 'email':
        return emailOAuthClient;
      case 'auth':
      default:
        return authOAuthClient;
    }
  },
  
  // Configuration validation
  validateConfig: () => {
    const required = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required OAuth environment variables: ${missing.join(', ')}`);
    }
    
    console.log('✅ OAuth configuration validated');
    console.log(`🔑 Auth Client ID: ${process.env.GOOGLE_CLIENT_ID?.substring(0, 20)}...`);
    console.log(`📧 Email Client ID: ${(process.env.EMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)?.substring(0, 20)}...`);
  }
};
