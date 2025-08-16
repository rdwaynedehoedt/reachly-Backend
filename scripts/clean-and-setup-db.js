const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
};

// Create a new pool
const pool = new Pool(dbConfig);

async function cleanAndSetupDatabase() {
  try {
    console.log('🔄 Cleaning existing tables and setting up authentication database...');
    
    const client = await pool.connect();
    
    try {
      // Drop existing tables if they exist (in correct order due to foreign keys)
      console.log('🧹 Dropping existing tables...');
      await client.query('DROP TABLE IF EXISTS email_tracking_events CASCADE');
      await client.query('DROP TABLE IF EXISTS email_templates CASCADE');
      await client.query('DROP TABLE IF EXISTS email_sends CASCADE');
      await client.query('DROP TABLE IF EXISTS lead_list_memberships CASCADE');
      await client.query('DROP TABLE IF EXISTS lead_lists CASCADE');
      await client.query('DROP TABLE IF EXISTS lead_import_batches CASCADE');
      await client.query('DROP TABLE IF EXISTS leads CASCADE');
      await client.query('DROP TABLE IF EXISTS email_accounts CASCADE');
      await client.query('DROP TABLE IF EXISTS refresh_tokens CASCADE');
      await client.query('DROP TABLE IF EXISTS organization_members CASCADE');
      await client.query('DROP TABLE IF EXISTS organizations CASCADE');
      await client.query('DROP TABLE IF EXISTS user_profiles CASCADE');
      await client.query('DROP TABLE IF EXISTS users CASCADE');
      
      console.log('✅ Existing tables dropped');
      
      // Read and execute the auth schema
      const authSqlFilePath = path.join(__dirname, '../database/auth-schema.sql');
      const authSqlScript = fs.readFileSync(authSqlFilePath, 'utf8');
      
      console.log('🔄 Creating authentication schema...');
      await client.query(authSqlScript);
      console.log('✅ Authentication schema created');
      
      // Read and execute the email accounts schema
      const emailSqlFilePath = path.join(__dirname, '../database/email-accounts-schema.sql');
      const emailSqlScript = fs.readFileSync(emailSqlFilePath, 'utf8');
      
      console.log('🔄 Creating email accounts schema...');
      await client.query(emailSqlScript);
      console.log('✅ Email accounts schema created');
      
      // Read and execute the leads schema
      const leadsSqlFilePath = path.join(__dirname, '../database/leads-schema.sql');
      const leadsSqlScript = fs.readFileSync(leadsSqlFilePath, 'utf8');
      
      console.log('🔄 Creating leads schema...');
      await client.query(leadsSqlScript);
      console.log('✅ Leads schema created');
      
      // Read and execute the email tracking schema
      const emailTrackingSqlFilePath = path.join(__dirname, '../database/email-tracking-schema.sql');
      const emailTrackingSqlScript = fs.readFileSync(emailTrackingSqlFilePath, 'utf8');
      
      console.log('🔄 Creating email tracking schema...');
      await client.query(emailTrackingSqlScript);
      console.log('✅ Email tracking schema created');
      
      console.log('✅ Database setup completed successfully!');
      
      // Test the setup by checking if tables exist
      const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('users', 'user_profiles', 'organizations', 'organization_members', 'refresh_tokens', 'email_accounts', 'leads', 'lead_import_batches', 'lead_lists', 'lead_list_memberships', 'email_sends', 'email_tracking_events', 'email_templates')
        ORDER BY table_name
      `);
      
      console.log('📋 Created tables:');
      result.rows.forEach(row => {
        console.log(`   ✓ ${row.table_name}`);
      });
      
      // Verify the users table structure
      const usersColumns = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'users'
        ORDER BY ordinal_position
      `);
      
      console.log('📋 Users table structure:');
      usersColumns.rows.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type}`);
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error setting up authentication database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the setup
cleanAndSetupDatabase();