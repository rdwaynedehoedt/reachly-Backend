const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// Database configuration from environment variables
const dbConfig = {
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
};

const pool = new Pool(dbConfig);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

// Generate refresh token
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );
};

// Store refresh token in database
const storeRefreshToken = async (userId, token) => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
};

// Google OAuth login
const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required'
      });
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const {
      sub: googleId,
      email,
      given_name: firstName,
      family_name: lastName,
      picture: avatarUrl,
      email_verified
    } = payload;

    // Check if user exists with this email and get profile data
    let userResult = await pool.query(`
      SELECT u.*, p.onboarding_completed
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.email = $1
    `, [email]);

    let user;
    let isNewUser = false;

    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
      
      // Update user with Google info if they signed up with email/password
      if (user.auth_provider === 'local' && !user.provider_id) {
        await pool.query(
          `UPDATE users 
           SET auth_provider = 'google', 
               provider_id = $1, 
               avatar_url = $2,
               email_verified = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [googleId, avatarUrl, email_verified, user.id]
        );
      }
    } else {
      // Create new user
      isNewUser = true;
      userResult = await pool.query(
        `INSERT INTO users (
          email, first_name, last_name, avatar_url, 
          email_verified, auth_provider, provider_id
        ) VALUES ($1, $2, $3, $4, $5, 'google', $6) 
        RETURNING *`,
        [email, firstName, lastName, avatarUrl, email_verified, googleId]
      );
      user = userResult.rows[0];

      // Create user profile
      await pool.query(
        'INSERT INTO user_profiles (user_id) VALUES ($1)',
        [user.id]
      );
      
      // Set onboarding_completed to false for new users
      user.onboarding_completed = false;
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token
    await storeRefreshToken(user.id, refreshToken);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Return user data and token
    const userData = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      isVerified: user.email_verified,
      onboardingCompleted: user.onboarding_completed || false,
      authProvider: user.auth_provider,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };

    res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      data: {
        user: userData,
        token,
        isNewUser
      }
    });

  } catch (error) {
    console.error('Google OAuth error:', error);
    
    if (error.message.includes('Invalid token')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error during Google authentication'
    });
  }
};

// Microsoft OAuth login (placeholder for future implementation)
const microsoftAuth = async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Microsoft OAuth not implemented yet'
  });
};

module.exports = {
  googleAuth,
  microsoftAuth
};