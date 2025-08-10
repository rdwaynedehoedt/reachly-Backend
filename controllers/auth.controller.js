const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Database connection from environment variables
const pool = new Pool({
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

// JWT secret - in production, use a secure random string
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Generate refresh token
 */
const generateRefreshToken = async (userId) => {
  const refreshToken = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, refreshToken, expiresAt]
    );
    return refreshToken;
  } finally {
    client.release();
  }
};

/**
 * User signup
 */
exports.signup = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { email, password, firstName, lastName } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate verification token
    const verificationToken = uuidv4();

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, verification_token) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, first_name, last_name, created_at`,
      [email.toLowerCase(), passwordHash, firstName, lastName, verificationToken]
    );

    const user = userResult.rows[0];

    // Create user profile
    await client.query(
      'INSERT INTO user_profiles (user_id) VALUES ($1)',
      [user.id]
    );

    // Generate tokens
    const accessToken = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          onboardingCompleted: false, // New users haven't completed onboarding
          createdAt: user.created_at
        },
        accessToken
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during signup'
    });
  } finally {
    client.release();
  }
};

/**
 * User login
 */
exports.login = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user with profile data
    const userResult = await client.query(`
      SELECT 
        u.id, u.email, u.password_hash, u.first_name, u.last_name,
        p.onboarding_completed
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.email = $1
    `, [email.toLowerCase()]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    await client.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const accessToken = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          onboardingCompleted: user.onboarding_completed || false
        },
        accessToken
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login'
    });
  } finally {
    client.release();
  }
};

/**
 * User logout
 */
exports.logout = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
      // Remove refresh token from database
      await client.query(
        'DELETE FROM refresh_tokens WHERE token = $1',
        [refreshToken]
      );
    }

    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    return res.status(200).json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during logout'
    });
  } finally {
    client.release();
  }
};

/**
 * Get current user
 */
exports.getCurrentUser = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.userId;

    // Get user with profile
    const userResult = await client.query(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.email_verified, u.last_login, u.created_at,
        p.avatar_url, p.bio, p.job_title, p.company, p.phone, p.timezone, p.preferences,
        p.onboarding_completed, p.role, p.experience_level, p.goals
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          emailVerified: user.email_verified,
          onboardingCompleted: user.onboarding_completed || false,
          lastLogin: user.last_login,
          createdAt: user.created_at,
          profile: {
            avatarUrl: user.avatar_url,
            bio: user.bio,
            jobTitle: user.job_title,
            company: user.company,
            phone: user.phone,
            timezone: user.timezone,
            preferences: user.preferences,
            role: user.role,
            experienceLevel: user.experience_level,
            goals: user.goals
          }
        }
      }
    });

  } catch (error) {
    console.error('Get current user error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while getting user information'
    });
  } finally {
    client.release();
  }
};

/**
 * Refresh access token
 */
exports.refreshToken = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token not provided'
      });
    }

    // Verify refresh token
    const tokenResult = await client.query(
      'SELECT user_id, expires_at FROM refresh_tokens WHERE token = $1',
      [refreshToken]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    const tokenData = tokenResult.rows[0];

    // Check if token is expired
    if (new Date() > new Date(tokenData.expires_at)) {
      // Remove expired token
      await client.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired'
      });
    }

    // Generate new access token
    const accessToken = generateToken(tokenData.user_id);

    return res.status(200).json({
      success: true,
      data: {
        accessToken
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while refreshing token'
    });
  } finally {
    client.release();
  }
};