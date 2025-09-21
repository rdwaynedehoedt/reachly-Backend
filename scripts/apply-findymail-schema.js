/**
 * Apply FindyMail Database Schema
 * This script applies the FindyMail schema to your PostgreSQL database
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database configuration from your environment
const dbConfig = {
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: process.env.AZURE_PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// Fallback to local database if Azure config not available
const pool = new Pool(
  dbConfig.host ? dbConfig : {
    connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/reachly_dev'
  }
);

async function applyFindyMailSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🗄️ Applying FindyMail database schema...\n');

    // Read the schema file
    const schemaPath = path.join(__dirname, '../database/findymail-schema.sql');
    console.log(`📋 Reading schema from: ${schemaPath}`);
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }

    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
    console.log('✅ Schema file loaded successfully');

    // Check current database connection
    const connectionTest = await client.query('SELECT current_database(), current_user, version()');
    const dbInfo = connectionTest.rows[0];
    
    console.log('\n📊 Database Information:');
    console.log(`   Database: ${dbInfo.current_database}`);
    console.log(`   User: ${dbInfo.current_user}`);
    console.log(`   Version: ${dbInfo.version.split(' ')[0]} ${dbInfo.version.split(' ')[1]}`);

    // Check if FindyMail tables already exist
    const existingTablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('email_enrichment_results', 'findymail_credits_usage')
      ORDER BY table_name;
    `);

    if (existingTablesResult.rows.length > 0) {
      console.log('\n⚠️  FindyMail tables already exist:');
      existingTablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      
      console.log('\n❓ Do you want to continue? This will:');
      console.log('   - Skip creating existing tables (CREATE TABLE IF NOT EXISTS)');
      console.log('   - Add missing columns to existing tables (ALTER TABLE IF NOT EXISTS)');
      console.log('   - Update functions and triggers');
      
      // For automation, we'll proceed automatically
      console.log('   ✅ Proceeding with schema updates...\n');
    }

    // Execute the schema
    console.log('🔧 Executing FindyMail schema...');
    await client.query(schemaSQL);
    console.log('✅ Schema applied successfully!');

    // Verify the installation
    console.log('\n🔍 Verifying schema installation...');
    
    // Check tables
    const tablesResult = await client.query(`
      SELECT table_name, 
             (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public' 
      AND table_name IN ('email_enrichment_results', 'findymail_credits_usage', 'leads')
      ORDER BY table_name;
    `);

    console.log('📊 FindyMail Tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name} (${row.column_count} columns)`);
    });

    // Check if leads table has new FindyMail columns
    const leadsColumnsResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leads' 
      AND (column_name LIKE '%findymail%' OR column_name IN ('enrichment_status', 'last_enrichment_attempt'))
      ORDER BY column_name;
    `);

    if (leadsColumnsResult.rows.length > 0) {
      console.log('\n📊 Enhanced Leads Table Columns:');
      leadsColumnsResult.rows.forEach(row => {
        console.log(`   ✅ ${row.column_name} (${row.data_type})`);
      });
    }

    // Check views
    const viewsResult = await client.query(`
      SELECT viewname 
      FROM pg_views 
      WHERE schemaname = 'public' 
      AND viewname = 'organization_enrichment_stats';
    `);

    if (viewsResult.rows.length > 0) {
      console.log('\n📊 Analytics Views:');
      viewsResult.rows.forEach(row => {
        console.log(`   ✅ ${row.viewname}`);
      });
    }

    // Check functions
    const functionsResult = await client.query(`
      SELECT proname as function_name
      FROM pg_proc 
      WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND proname IN ('update_lead_from_enrichment', 'insert_sample_enrichment_data');
    `);

    if (functionsResult.rows.length > 0) {
      console.log('\n📊 Custom Functions:');
      functionsResult.rows.forEach(row => {
        console.log(`   ✅ ${row.function_name}()`);
      });
    }

    console.log('\n🎉 FindyMail schema installation completed successfully!');
    console.log('\n📋 What was installed:');
    console.log('   ✅ email_enrichment_results table - Store FindyMail API responses');
    console.log('   ✅ findymail_credits_usage table - Track API credit consumption');
    console.log('   ✅ Enhanced leads table - Added FindyMail columns');
    console.log('   ✅ Automatic triggers - Update leads when emails found');
    console.log('   ✅ Analytics views - Organization enrichment statistics');
    console.log('   ✅ Helper functions - Sample data and automation');

    console.log('\n🚀 Next steps:');
    console.log('   1. Add FINDYMAIL_API_KEY to your .env file');
    console.log('   2. Test the integration using your frontend');
    console.log('   3. Monitor credit usage via organization_enrichment_stats view');
    
    return true;

  } catch (error) {
    console.error('\n❌ Schema application failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 Connection troubleshooting:');
      console.error('   - Check if your PostgreSQL server is running');
      console.error('   - Verify your database connection settings in .env');
      console.error('   - Ensure your database accepts connections');
    } else if (error.code === '28P01') {
      console.error('\n🔧 Authentication troubleshooting:');
      console.error('   - Verify your database username and password');
      console.error('   - Check if the user has CREATE TABLE permissions');
    } else if (error.code === '3D000') {
      console.error('\n🔧 Database troubleshooting:');
      console.error('   - Verify the database name exists');
      console.error('   - Check if you have access to the specified database');
    }
    
    console.error('\n📋 Current configuration:');
    if (dbConfig.host) {
      console.error(`   Host: ${dbConfig.host}`);
      console.error(`   Database: ${dbConfig.database}`);
      console.error(`   User: ${dbConfig.user}`);
      console.error(`   SSL: ${dbConfig.ssl ? 'enabled' : 'disabled'}`);
    } else {
      console.error(`   Connection string: ${process.env.DATABASE_URL || 'not set'}`);
    }
    
    return false;
  } finally {
    client.release();
  }
}

// Cleanup function
async function testConnection() {
  const client = await pool.connect();
  
  try {
    const result = await client.query('SELECT NOW() as current_time, current_database(), current_user');
    const info = result.rows[0];
    
    console.log('🔌 Database connection test:');
    console.log(`   ✅ Connected successfully`);
    console.log(`   📅 Time: ${info.current_time}`);
    console.log(`   🗄️ Database: ${info.current_database}`);
    console.log(`   👤 User: ${info.current_user}`);
    
    return true;
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    return false;
  } finally {
    client.release();
  }
}

// Main execution
async function main() {
  try {
    console.log('🚀 FindyMail Database Schema Installation');
    console.log('=' .repeat(50));
    
    // Test connection first
    console.log('\n1. Testing database connection...');
    const connectionOk = await testConnection();
    
    if (!connectionOk) {
      console.log('\n❌ Cannot proceed without database connection.');
      console.log('Please check your environment variables and database server.');
      process.exit(1);
    }
    
    // Apply schema
    console.log('\n2. Applying FindyMail schema...');
    const schemaOk = await applyFindyMailSchema();
    
    if (schemaOk) {
      console.log('\n✅ Installation completed successfully!');
      process.exit(0);
    } else {
      console.log('\n❌ Installation failed. Please check the errors above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { applyFindyMailSchema, testConnection };
