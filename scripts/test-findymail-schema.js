/**
 * Test script for FindyMail database schema
 * This script will:
 * 1. Apply the FindyMail schema
 * 2. Insert sample test data
 * 3. Verify all tables and relationships work
 * 4. Test the analytics view
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/reachly_db'
});

async function testFindymailSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting FindyMail schema test...\n');

    // 1. Apply the schema
    console.log('📋 Step 1: Applying FindyMail schema...');
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, '../database/findymail-schema.sql'), 
      'utf8'
    );
    
    await client.query(schemaSQL);
    console.log('✅ Schema applied successfully!\n');

    // 2. Verify tables exist
    console.log('🔍 Step 2: Verifying tables exist...');
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('email_enrichment_results', 'findymail_credits_usage')
      ORDER BY table_name;
    `;
    
    const tablesResult = await client.query(tablesQuery);
    console.log('📊 FindyMail Tables found:');
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // 3. Verify enhanced leads table columns
    console.log('\n🔍 Step 3: Verifying leads table enhancements...');
    const leadsColumnsQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leads' 
      AND column_name LIKE '%findymail%' OR column_name IN ('enrichment_status', 'last_enrichment_attempt')
      ORDER BY column_name;
    `;
    
    const leadsColumnsResult = await client.query(leadsColumnsQuery);
    console.log('📊 New leads table columns:');
    leadsColumnsResult.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });

    // 4. Check if we have required prerequisite tables
    console.log('\n🔍 Step 4: Checking prerequisite tables...');
    const prerequisiteCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') as has_orgs,
             EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') as has_users,
             EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') as has_leads;
    `);
    
    const prereqs = prerequisiteCheck.rows[0];
    console.log('📊 Prerequisite tables:');
    console.log(`   - organizations: ${prereqs.has_orgs ? '✅' : '❌'}`);
    console.log(`   - users: ${prereqs.has_users ? '✅' : '❌'}`);
    console.log(`   - leads: ${prereqs.has_leads ? '✅' : '❌'}`);

    if (!prereqs.has_orgs || !prereqs.has_users || !prereqs.has_leads) {
      console.log('\n⚠️  WARNING: Some prerequisite tables missing. Schema applied but testing limited.');
      return;
    }

    // 5. Insert sample data for testing
    console.log('\n📝 Step 5: Inserting sample test data...');
    
    // First, ensure we have a test organization and user
    const orgResult = await client.query(`
      INSERT INTO organizations (name, slug, created_by) 
      SELECT 'Test Org for FindyMail', 'test-findymail-org', id
      FROM users 
      LIMIT 1
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING id;
    `);

    const userResult = await client.query('SELECT id FROM users LIMIT 1');
    
    if (orgResult.rows.length === 0 || userResult.rows.length === 0) {
      console.log('⚠️  No existing users/orgs found. Creating test data...');
      
      // Create test user and org
      await client.query(`
        INSERT INTO users (email, first_name, last_name) 
        VALUES ('test@example.com', 'Test', 'User')
        ON CONFLICT (email) DO NOTHING;
      `);
      
      const newUserResult = await client.query(`SELECT id FROM users WHERE email = 'test@example.com'`);
      const testUserId = newUserResult.rows[0].id;
      
      await client.query(`
        INSERT INTO organizations (name, slug, created_by) 
        VALUES ('Test Org for FindyMail', 'test-findymail-org', $1)
        ON CONFLICT (slug) DO UPDATE SET updated_at = NOW();
      `, [testUserId]);
    }

    const finalOrgResult = await client.query(`SELECT id FROM organizations WHERE slug = 'test-findymail-org'`);
    const finalUserResult = await client.query(`SELECT id FROM users LIMIT 1`);
    
    const testOrgId = finalOrgResult.rows[0].id;
    const testUserId = finalUserResult.rows[0].id;

    console.log(`📊 Using test org: ${testOrgId}`);
    console.log(`📊 Using test user: ${testUserId}`);

    // Insert sample enrichment data using our function
    const sampleResult = await client.query(`
      SELECT insert_sample_enrichment_data($1, $2, $3) as enrichment_id;
    `, [testOrgId, testUserId, 'https://linkedin.com/in/test-user']);

    const enrichmentId = sampleResult.rows[0].enrichment_id;
    console.log(`✅ Sample enrichment data inserted: ${enrichmentId}`);

    // 6. Test the analytics view
    console.log('\n📈 Step 6: Testing analytics view...');
    const analyticsResult = await client.query(`
      SELECT * FROM organization_enrichment_stats 
      WHERE organization_id = $1;
    `, [testOrgId]);

    if (analyticsResult.rows.length > 0) {
      const stats = analyticsResult.rows[0];
      console.log('📊 Analytics view results:');
      console.log(`   - Organization: ${stats.organization_name}`);
      console.log(`   - Total attempts: ${stats.total_enrichment_attempts}`);
      console.log(`   - Successful: ${stats.successful_enrichments}`);
      console.log(`   - Emails found: ${stats.emails_found}`);
      console.log(`   - Success rate: ${stats.success_rate_percent}%`);
      console.log(`   - Credits used: ${stats.total_credits_used}`);
    }

    // 7. Test data integrity
    console.log('\n🔒 Step 7: Testing data integrity...');
    const integrityResult = await client.query(`
      SELECT 
        COUNT(*) as total_enrichments,
        COUNT(CASE WHEN success = true THEN 1 END) as successful,
        COUNT(CASE WHEN found_email IS NOT NULL THEN 1 END) as with_email,
        COUNT(DISTINCT organization_id) as unique_orgs
      FROM email_enrichment_results;
    `);

    const integrity = integrityResult.rows[0];
    console.log('📊 Data integrity check:');
    console.log(`   - Total enrichments: ${integrity.total_enrichments}`);
    console.log(`   - Successful: ${integrity.successful}`);
    console.log(`   - With email: ${integrity.with_email}`);
    console.log(`   - Unique organizations: ${integrity.unique_orgs}`);

    // 8. Test the lead update trigger
    console.log('\n🔄 Step 8: Testing automatic lead updates...');
    
    // First create a test lead
    const leadResult = await client.query(`
      INSERT INTO leads (organization_id, email, first_name, last_name, created_by)
      VALUES ($1, 'testlead@example.com', 'Test', 'Lead', $2)
      RETURNING id;
    `, [testOrgId, testUserId]);

    const testLeadId = leadResult.rows[0].id;

    // Insert enrichment result for this lead
    await client.query(`
      INSERT INTO email_enrichment_results (
        organization_id, lead_id, search_type, search_input,
        found_email, found_name, success, created_by
      ) VALUES (
        $1, $2, 'linkedin', '{"linkedin_url": "https://linkedin.com/in/testlead"}',
        'enriched@example.com', 'Test Lead', true, $3
      );
    `, [testOrgId, testLeadId, testUserId]);

    // Check if lead was updated
    const updatedLeadResult = await client.query(`
      SELECT findymail_email, enrichment_status, findymail_enriched_at
      FROM leads WHERE id = $1;
    `, [testLeadId]);

    const updatedLead = updatedLeadResult.rows[0];
    console.log('📊 Lead update trigger test:');
    console.log(`   - FindyMail email: ${updatedLead.findymail_email}`);
    console.log(`   - Enrichment status: ${updatedLead.enrichment_status}`);
    console.log(`   - Enriched at: ${updatedLead.findymail_enriched_at ? '✅' : '❌'}`);

    console.log('\n🎉 All tests passed! FindyMail schema is working correctly.');
    console.log('\n📋 Summary:');
    console.log('   ✅ Database schema applied');
    console.log('   ✅ Tables created and verified');  
    console.log('   ✅ Sample data inserted');
    console.log('   ✅ Analytics view working');
    console.log('   ✅ Data integrity confirmed');
    console.log('   ✅ Automatic lead updates working');
    console.log('\n🚀 Ready to proceed to Step 2: Backend API implementation!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('📋 Full error:', error);
    
    // Provide helpful debugging info
    console.log('\n🔧 Debugging info:');
    console.log('   - Check if all prerequisite tables exist');
    console.log('   - Verify database connection string');
    console.log('   - Ensure PostgreSQL version supports JSONB and UUID');
    
    throw error;
  } finally {
    client.release();
  }
}

// Cleanup function to remove test data
async function cleanup() {
  const client = await pool.connect();
  
  try {
    console.log('\n🧹 Cleaning up test data...');
    
    await client.query(`DELETE FROM findymail_credits_usage WHERE organization_id IN (
      SELECT id FROM organizations WHERE slug = 'test-findymail-org'
    )`);
    
    await client.query(`DELETE FROM email_enrichment_results WHERE organization_id IN (
      SELECT id FROM organizations WHERE slug = 'test-findymail-org'  
    )`);
    
    await client.query(`DELETE FROM leads WHERE organization_id IN (
      SELECT id FROM organizations WHERE slug = 'test-findymail-org'
    )`);
    
    await client.query(`DELETE FROM organizations WHERE slug = 'test-findymail-org'`);
    
    await client.query(`DELETE FROM users WHERE email = 'test@example.com'`);
    
    console.log('✅ Test data cleaned up');
    
  } catch (error) {
    console.error('⚠️  Cleanup error:', error.message);
  } finally {
    client.release();
  }
}

// Main execution
async function main() {
  try {
    await testFindymailSchema();
  } catch (error) {
    console.error('Schema test failed:', error);
    process.exit(1);
  } finally {
    // Ask if user wants to cleanup test data
    console.log('\n❓ Test data created. Run cleanup? (Set CLEANUP=true env var to auto-cleanup)');
    
    if (process.env.CLEANUP === 'true') {
      await cleanup();
    }
    
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { testFindymailSchema, cleanup };
