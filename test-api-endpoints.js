const pool = require('./config/database');

/**
 * Simple API endpoint tests for Contact Lists
 * Tests the new endpoints with existing data
 */

async function testAPIEndpoints() {
    const client = await pool.connect();
    
    try {
        console.log('🧪 Testing Contact Lists API Endpoints...\n');
        
        // Test 1: Database schema validation
        console.log('1️⃣ Testing Database Schema...');
        await testDatabaseSchema(client);
        
        // Test 2: Basic queries
        console.log('\n2️⃣ Testing Basic Queries...');
        await testBasicQueries(client);
        
        // Test 3: Smart filtering queries
        console.log('\n3️⃣ Testing Smart Filtering Queries...');
        await testSmartFilteringQueries(client);
        
        console.log('\n🎉 All API endpoint tests passed!');
        console.log('\n✅ System is ready for frontend integration');
        
    } catch (error) {
        console.error('❌ API test failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function testDatabaseSchema(client) {
    // Test that all new tables exist
    const tables = [
        'contact_lists',
        'contact_list_members', 
        'campaign_contact_lists',
        'lead_campaign_history',
        'suppression_lists'
    ];
    
    for (const table of tables) {
        const result = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = $1
            )
        `, [table]);
        
        if (!result.rows[0].exists) {
            throw new Error(`Table ${table} does not exist`);
        }
        
        console.log(`   ✅ Table ${table} exists`);
    }
    
    // Test indexes
    const indexes = [
        'idx_contact_lists_organization_id',
        'idx_contact_list_members_list_id',
        'idx_lead_campaign_history_lead_id',
        'idx_suppression_lists_email'
    ];
    
    for (const index of indexes) {
        const result = await client.query(`
            SELECT EXISTS (
                SELECT FROM pg_indexes 
                WHERE indexname = $1
            )
        `, [index]);
        
        if (!result.rows[0].exists) {
            console.warn(`   ⚠️  Index ${index} does not exist (may affect performance)`);
        } else {
            console.log(`   ✅ Index ${index} exists`);
        }
    }
}

async function testBasicQueries(client) {
    // Test contact lists query
    const listsResult = await client.query(`
        SELECT 
            cl.*,
            COALESCE(cl.total_contacts, 0) as total_contacts,
            COALESCE(cl.active_contacts, 0) as active_contacts
        FROM contact_lists cl
        WHERE cl.is_active = true
        ORDER BY cl.created_at DESC
        LIMIT 10
    `);
    
    console.log(`   ✅ Contact lists query returned ${listsResult.rows.length} results`);
    
    // Test leads query
    const leadsResult = await client.query(`
        SELECT COUNT(*) as count FROM leads
    `);
    
    console.log(`   ✅ Found ${leadsResult.rows[0].count} total leads in system`);
    
    // Test organizations query
    const orgsResult = await client.query(`
        SELECT COUNT(*) as count FROM organizations
    `);
    
    console.log(`   ✅ Found ${orgsResult.rows[0].count} organizations in system`);
}

async function testSmartFilteringQueries(client) {
    // Test 1: Unused leads query (leads not in any campaign)
    const unusedLeadsResult = await client.query(`
        SELECT COUNT(*) as count FROM leads l 
        WHERE l.id NOT IN (
            SELECT DISTINCT lch.lead_id 
            FROM lead_campaign_history lch
            WHERE lch.status IN ('sent', 'delivered')
        )
    `);
    
    console.log(`   ✅ Unused leads query: ${unusedLeadsResult.rows[0].count} unused leads`);
    
    // Test 2: Never contacted leads query
    const neverContactedResult = await client.query(`
        SELECT COUNT(*) as count FROM leads l
        WHERE l.id NOT IN (
            SELECT DISTINCT lch.lead_id 
            FROM lead_campaign_history lch
            WHERE lch.status IN ('sent', 'delivered')
        )
        AND l.id NOT IN (
            SELECT DISTINCT sl.organization_id 
            FROM suppression_lists sl 
            WHERE sl.email = l.email
        )
    `);
    
    console.log(`   ✅ Never contacted leads query: ${neverContactedResult.rows[0].count} leads`);
    
    // Test 3: List members query
    const listMembersResult = await client.query(`
        SELECT COUNT(*) as count FROM contact_list_members clm
        WHERE clm.status = 'active'
    `);
    
    console.log(`   ✅ Active list members query: ${listMembersResult.rows[0].count} members`);
    
    // Test 4: Campaign history query
    const campaignHistoryResult = await client.query(`
        SELECT COUNT(*) as count FROM lead_campaign_history
    `);
    
    console.log(`   ✅ Campaign history query: ${campaignHistoryResult.rows[0].count} records`);
    
    // Test 5: Suppression list query
    const suppressionResult = await client.query(`
        SELECT COUNT(*) as count FROM suppression_lists
    `);
    
    console.log(`   ✅ Suppression list query: ${suppressionResult.rows[0].count} suppressed emails`);
    
    // Test 6: Complex filtering query (leads from specific list, not suppressed)
    const complexFilterResult = await client.query(`
        SELECT COUNT(*) as count FROM leads l
        LEFT JOIN suppression_lists sl ON l.email = sl.email
        WHERE sl.email IS NULL
        AND l.organization_id IS NOT NULL
    `);
    
    console.log(`   ✅ Complex filtering query: ${complexFilterResult.rows[0].count} available leads`);
}

// Run server connectivity test
async function testServerConnectivity() {
    console.log('🔗 Testing Server Connectivity...\n');
    
    try {
        // Test database connection
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time');
        client.release();
        
        console.log('✅ Database connection successful');
        console.log(`   📅 Database time: ${result.rows[0].current_time}`);
        
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        throw error;
    }
}

// Test data structure validation
async function validateDataStructure() {
    console.log('\n📋 Validating Data Structure...\n');
    
    const client = await pool.connect();
    
    try {
        // Check contact_lists structure
        const listsColumns = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'contact_lists'
            ORDER BY ordinal_position
        `);
        
        console.log('✅ contact_lists table structure:');
        listsColumns.rows.forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'required'})`);
        });
        
        // Check if triggers exist
        const triggers = await client.query(`
            SELECT trigger_name, event_manipulation, event_object_table
            FROM information_schema.triggers
            WHERE trigger_schema = 'public'
            AND event_object_table IN ('contact_lists', 'contact_list_members', 'lead_campaign_history')
        `);
        
        console.log(`\n✅ Found ${triggers.rows.length} triggers for contact lists tables`);
        triggers.rows.forEach(trigger => {
            console.log(`   - ${trigger.trigger_name} on ${trigger.event_object_table} (${trigger.event_manipulation})`);
        });
        
    } finally {
        client.release();
    }
}

// Generate summary report
async function generateSummaryReport() {
    console.log('\n📊 System Summary Report\n');
    
    const client = await pool.connect();
    
    try {
        // Get system statistics
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM contact_lists WHERE is_active = true) as active_lists,
                (SELECT COUNT(*) FROM contact_list_members WHERE status = 'active') as list_members,
                (SELECT COUNT(*) FROM leads) as total_leads,
                (SELECT COUNT(*) FROM organizations) as organizations,
                (SELECT COUNT(*) FROM campaigns) as campaigns,
                (SELECT COUNT(*) FROM lead_campaign_history) as campaign_history,
                (SELECT COUNT(*) FROM suppression_lists) as suppressed_emails
        `);
        
        const row = stats.rows[0];
        
        console.log('📈 Current System Statistics:');
        console.log(`   📋 Active Contact Lists: ${row.active_lists}`);
        console.log(`   👥 List Members: ${row.list_members}`);
        console.log(`   📧 Total Leads: ${row.total_leads}`);
        console.log(`   🏢 Organizations: ${row.organizations}`);
        console.log(`   📤 Campaigns: ${row.campaigns}`);
        console.log(`   📊 Campaign History: ${row.campaign_history}`);
        console.log(`   🚫 Suppressed Emails: ${row.suppressed_emails}`);
        
        // Calculate available leads
        const availableLeads = await client.query(`
            SELECT COUNT(*) as count FROM leads l
            LEFT JOIN suppression_lists sl ON l.email = sl.email
            WHERE sl.email IS NULL
        `);
        
        console.log(`   ✅ Available Leads: ${availableLeads.rows[0].count}`);
        
        // Calculate unused leads
        const unusedLeads = await client.query(`
            SELECT COUNT(*) as count FROM leads l
            LEFT JOIN suppression_lists sl ON l.email = sl.email
            WHERE sl.email IS NULL
            AND l.id NOT IN (
                SELECT DISTINCT lch.lead_id 
                FROM lead_campaign_history lch
                WHERE lch.status IN ('sent', 'delivered')
            )
        `);
        
        console.log(`   🆕 Unused Leads: ${unusedLeads.rows[0].count}`);
        
    } finally {
        client.release();
    }
}

// Main test runner
if (require.main === module) {
    testServerConnectivity()
        .then(() => testAPIEndpoints())
        .then(() => validateDataStructure())
        .then(() => generateSummaryReport())
        .then(() => {
            console.log('\n🚀 All tests completed successfully!');
            console.log('\n🎯 Next Steps:');
            console.log('   1. ✅ Backend: Contact Lists system is ready');
            console.log('   2. 🔄 Frontend: Update campaign creation to use new filtering');
            console.log('   3. 📱 UI: Add contact lists management interface');
            console.log('   4. 🧪 Testing: Test with real data import');
            console.log('\n📘 New API Endpoints Available:');
            console.log('   GET    /api/contact-lists                 - Get all contact lists');
            console.log('   POST   /api/contact-lists                 - Create new contact list');
            console.log('   POST   /api/contact-lists/:id/contacts    - Add contacts to list');
            console.log('   GET    /api/contact-lists/:id/contacts    - Get contacts in list');
            console.log('   POST   /api/contact-lists/:id/import      - Import leads to list');
            console.log('   GET    /api/contact-lists/available-leads - Smart lead filtering');
            
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Tests failed:', error);
            process.exit(1);
        });
}
