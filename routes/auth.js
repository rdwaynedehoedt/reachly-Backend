const express = require('express');
const { supabaseClient, supabaseAdmin } = require('../config/supabase');
const router = express.Router();

// Sign Up endpoint
router.post('/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Basic validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    
    if (existingUser.user) {
      return res.status(400).json({
        error: 'User with this email already exists'
      });
    }

    // Create user with Supabase Auth
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          display_name: `${firstName} ${lastName}`
        }
      }
    });

    if (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    res.status(201).json({
      message: 'User created successfully. Please check your email for verification.',
      user: {
        id: data.user?.id,
        email: data.user?.email,
        emailConfirmed: data.user?.email_confirmed_at ? true : false
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      error: 'Internal server error during signup'
    });
  }
});

// Sign In endpoint
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({
        error: error.message
      });
    }

    res.json({
      message: 'Login successful',
      user: {
        id: data.user.id,
        email: data.user.email,
        emailConfirmed: data.user.email_confirmed_at ? true : false,
        lastSignIn: data.user.last_sign_in_at
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at
      }
    });

  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({
      error: 'Internal server error during signin'
    });
  }
});

// Sign Out endpoint
router.post('/signout', async (req, res) => {
  try {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    res.json({
      message: 'Successfully signed out'
    });

  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({
      error: 'Internal server error during signout'
    });
  }
});

// Forgot Password endpoint
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`
    });

    if (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    res.json({
      message: 'Password reset email sent successfully'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      error: 'Internal server error during password reset'
    });
  }
});

// Get User Profile endpoint (requires authentication)
router.get('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization token required'
      });
    }

    const token = authHeader.split(' ')[1];
    
    const { data: { user }, error } = await supabaseClient.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Invalid or expired token'
      });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        emailConfirmed: user.email_confirmed_at ? true : false,
        metadata: user.user_metadata,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      error: 'Internal server error while fetching profile'
    });
  }
});

// Refresh Token endpoint
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Refresh token is required'
      });
    }

    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      return res.status(401).json({
        error: error.message
      });
    }

    res.json({
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      error: 'Internal server error during token refresh'
    });
  }
});

module.exports = router;