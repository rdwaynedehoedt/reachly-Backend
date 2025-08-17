const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Azure PostgreSQL connection details from environment variables
const dbConfig = {
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false } // For Azure PostgreSQL which requires SSL
};

// Create a new pool
const pool = new Pool(dbConfig);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true // Allow cookies
}));
app.use(express.json());
app.use(cookieParser());

// Test database connection route
app.get('/api/db-test', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW() as current_time');
      res.json({
        success: true,
        message: 'Database connection successful!',
        data: {
          current_time: result.rows[0].current_time,
          database_host: dbConfig.host,
          database_name: dbConfig.database,
          database_user: dbConfig.user
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to connect to the database',
      error: error.message
    });
  }
});

// Import routes
const authRoutes = require('./routes/auth');
const oauthRoutes = require('./routes/oauth');
const userRoutes = require('./routes/user');
const emailAuthRoutes = require('./routes/emailAuth');
const leadsRoutes = require('./routes/leads');
const emailRoutes = require('./routes/email');
const campaignsRoutes = require('./routes/campaigns');



// API routes
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/user', userRoutes);
app.use('/api/email-auth', emailAuthRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/campaigns', campaignsRoutes);



// Basic health check route
app.get('/', (req, res) => {
  res.json({
    message: 'Reachly Backend Server is running!',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Test database connection: http://localhost:${PORT}/api/db-test`);
  
  // Test database connection on startup
  console.log('🔄 Testing database connection...');
  pool.connect()
    .then(client => {
      console.log('✅ Database connection successful!');
      client.query('SELECT NOW() as current_time')
        .then(result => {
          console.log(`📅 Database time: ${result.rows[0].current_time}`);
          client.release();
        })
        .catch(err => {
          console.error('❌ Error executing query:', err);
          client.release();
        });
    })
    .catch(err => {
      console.error('❌ Database connection error:', err);
    });
});

module.exports = app;