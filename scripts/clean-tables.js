const { Pool } = require('pg');
require('dotenv').config();

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

async function cleanAllTables() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting database cleanup...');
    
    // Start transaction
    await client.query('BEGIN');
    
    // Clean tables in correct order (respecting foreign key constraints)
    const tablesToClean = [
      'refresh_tokens',
      'organization_members', 
      'organizations',
      'user_profiles',
      'users'
    ];
    
    for (const table of tablesToClean) {
      try {
        console.log(`🗑️  Cleaning table: ${table}`);
        const countBefore = await client.query(`SELECT COUNT(*) FROM ${table}`);
        await client.query(`DELETE FROM ${table}`);
        const countAfter = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`   ✅ Deleted ${countBefore.rows[0].count} rows from ${table}`);
      } catch (error) {
        console.log(`   ⚠️  Table ${table} might not exist or is empty`);
      }
    }
    
    // Commit transaction
    await client.query('COMMIT');
    
    console.log('✅ Database cleanup completed successfully!');
    
    // Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    for (const table of tablesToClean) {
      try {
        const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
        const count = countResult.rows[0].count;
        console.log(`   ${table}: ${count} rows`);
      } catch (error) {
        console.log(`   ${table}: table not found`);
      }
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during database cleanup:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the cleanup
cleanAllTables()
  .then(() => {
    console.log('\n🎉 All table data has been cleaned!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Database cleanup failed:', error);
    process.exit(1);
  });
