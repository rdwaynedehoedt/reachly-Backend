#!/usr/bin/env node

/**
 * Database Setup Script
 * Run this script to set up your Reachly database with all necessary tables and policies
 * 
 * Usage:
 *   npm run db:setup
 *   or
 *   node scripts/db-setup.js
 */

const { setupDatabase } = require('../database/setup');
const DatabaseMigrations = require('../database/migrations');

async function main() {
  try {
    console.log('🚀 Setting up Reachly database...\n');

    // Run migrations first
    console.log('📊 Running database migrations...');
    const migrations = new DatabaseMigrations();
    await migrations.runMigrations();
    console.log('✅ Migrations completed\n');

    // Set up main database schema
    console.log('🏗️  Setting up database schema...');
    await setupDatabase();
    console.log('✅ Database schema setup completed\n');

    console.log('🎉 Database setup completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('  1. Start your backend server: npm run dev');
    console.log('  2. Test the health endpoint: http://localhost:5000/api/health');
    console.log('  3. Create your first organization via the API');
    
  } catch (error) {
    console.error('❌ Database setup failed:');
    console.error(error.message);
    
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    
    if (error.details) {
      console.error(`Details: ${error.details}`);
    }
    
    process.exit(1);
  }
}

// Handle CLI arguments
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'migrations-only':
    const migrations = new DatabaseMigrations();
    migrations.runMigrations()
      .then(() => {
        console.log('✅ Migrations completed!');
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Migrations failed:', error);
        process.exit(1);
      });
    break;
    
  case 'schema-only':
    setupDatabase()
      .then(() => {
        console.log('✅ Schema setup completed!');
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Schema setup failed:', error);
        process.exit(1);
      });
    break;
    
  case 'help':
  case '--help':
  case '-h':
    console.log('Database Setup Script\n');
    console.log('Usage:');
    console.log('  node scripts/db-setup.js              - Full setup (migrations + schema)');
    console.log('  node scripts/db-setup.js migrations-only - Run migrations only');
    console.log('  node scripts/db-setup.js schema-only     - Run schema setup only');
    console.log('  node scripts/db-setup.js help            - Show this help');
    process.exit(0);
    break;
    
  default:
    main();
}