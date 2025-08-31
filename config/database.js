const { Pool } = require('pg');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.AZURE_PG_HOST,
    port: process.env.AZURE_PG_PORT || 5432,
    database: process.env.AZURE_PG_DATABASE,
    user: process.env.AZURE_PG_USER,
    password: process.env.AZURE_PG_PASSWORD,
    ssl: process.env.AZURE_PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    
    // Connection pool settings optimized for Azure PostgreSQL
    max: 10,                // Maximum number of clients in the pool
    min: 2,                 // Minimum pool size
    idleTimeoutMillis: 60000, // How long a client is allowed to remain idle (60s)
    connectionTimeoutMillis: 10000, // How long to wait for connection (10s for Azure)
    acquireTimeoutMillis: 60000, // How long to wait for a connection from pool
    createTimeoutMillis: 10000, // Max wait for connection creation
};

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err, client) => {
    console.error('❌ Unexpected error on idle database client:', err);
    process.exit(-1);
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
    } else {
        console.log('✅ Database connected successfully at', res.rows[0].now);
    }
});

module.exports = pool;
