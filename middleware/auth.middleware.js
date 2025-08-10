const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  host: 'reachly-datebase-server.postgres.database.azure.com',
  port: 5432,
  database: 'postgres',
  user: 'Dwayne',
  password: '@Anton2004',
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

/**
 * Authentication middleware
 * Verifies JWT token and adds user information to request
 */
const authenticate = async (req, res, next) => {
  const client = await pool.connect();
  
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is missing'
      });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Access token expired'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid access token'
      });
    }

    // Get user from database
    const userResult = await client.query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add user to request object
    req.user = {
      userId: userResult.rows[0].id,
      email: userResult.rows[0].email,
      firstName: userResult.rows[0].first_name,
      lastName: userResult.rows[0].last_name
    };
    
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  } finally {
    client.release();
  }
};

/**
 * Optional authentication middleware
 * Adds user information if token is present but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  const client = await pool.connect();
  
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      const userResult = await client.query(
        'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (userResult.rows.length > 0) {
        req.user = {
          userId: userResult.rows[0].id,
          email: userResult.rows[0].email,
          firstName: userResult.rows[0].first_name,
          lastName: userResult.rows[0].last_name
        };
      }
    } catch (error) {
      // Token invalid or expired, but that's ok for optional auth
    }
    
    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next();
  } finally {
    client.release();
  }
};

/**
 * Organization access middleware
 * Checks if user has access to a specific organization
 */
const checkOrganizationAccess = async (req, res, next) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.userId;
    const organizationId = req.params.organizationId || req.body.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required'
      });
    }

    // Check if user is a member of the organization
    const memberResult = await client.query(`
      SELECT om.role, om.status, o.name 
      FROM organization_members om
      JOIN organizations o ON om.organization_id = o.id
      WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'
    `, [userId, organizationId]);

    if (memberResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this organization'
      });
    }

    // Add organization info to request
    req.organization = {
      id: organizationId,
      memberRole: memberResult.rows[0].role,
      name: memberResult.rows[0].name
    };
    
    next();
  } catch (error) {
    console.error('Organization access middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Organization access check failed'
    });
  } finally {
    client.release();
  }
};

/**
 * Admin role middleware
 * Checks if user has admin or owner role in organization
 */
const requireAdmin = (req, res, next) => {
  if (!req.organization || !['admin', 'owner'].includes(req.organization.memberRole)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

/**
 * Owner role middleware
 * Checks if user has owner role in organization
 */
const requireOwner = (req, res, next) => {
  if (!req.organization || req.organization.memberRole !== 'owner') {
    return res.status(403).json({
      success: false,
      message: 'Owner access required'
    });
  }
  next();
};

module.exports = {
  authenticate,
  optionalAuth,
  checkOrganizationAccess,
  requireAdmin,
  requireOwner
};