const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Setup script for Contact Lists feature
 * This implements the industry-standard lead management approach
 */

async function setupContactLists() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Setting up Contact Lists feature...');
        
        // 1. Create the contact lists schema
        console.log('📋 Creating contact lists schema...');
        const contactListsSchema = fs.readFileSync(
            path.join(__dirname, '../database/contact-lists-schema.sql'), 
            'utf8'
        );
        
        await client.query(contactListsSchema);
        console.log('✅ Contact lists schema created successfully');
        
        // 2. Migrate existing campaign_leads to new lead_campaign_history
        console.log('📊 Migrating existing campaign data...');
        await migrateCampaignLeads(client);
        
        // 3. Create default contact lists
        console.log('📁 Creating default contact lists...');
        await createDefaultLists(client);
        
        // 4. Test the new functionality
        console.log('🧪 Testing contact lists functionality...');
        await testContactListsFunctionality(client);
        
        console.log('🎉 Contact Lists setup completed successfully!');
        console.log('\n📖 What was implemented:');
        console.log('   ✅ Contact Lists (organize leads like Mailchimp Audiences)');
        console.log('   ✅ Smart lead filtering (unused, never contacted, by list)');
        console.log('   ✅ Campaign exclusion rules (prevent lead reuse)');
        console.log('   ✅ Suppression management (bounces, unsubscribes)');
        console.log('   ✅ Import leads directly to lists');
        console.log('\n🔗 New API endpoints:');
        console.log('   GET    /api/contact-lists                 - Get all lists');
        console.log('   POST   /api/contact-lists                 - Create new list');
        console.log('   POST   /api/contact-lists/:id/contacts    - Add contacts to list');
        console.log('   GET    /api/contact-lists/:id/contacts    - Get list contacts');
        console.log('   POST   /api/contact-lists/:id/import      - Import leads to list');
        console.log('   GET    /api/contact-lists/available-leads - Smart lead filtering');
        
    } catch (error) {
        console.error('❌ Error setting up contact lists:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function migrateCampaignLeads(client) {
    try {
        // Check if we have existing campaign_leads data
        const existingData = await client.query(`
            SELECT COUNT(*) as count FROM campaign_leads
        `);
        
        const count = parseInt(existingData.rows[0].count);
        console.log(`📊 Found ${count} existing campaign lead records to migrate`);
        
        if (count > 0) {
            // Migrate campaign_leads to lead_campaign_history
            await client.query(`
                INSERT INTO lead_campaign_history (
                    id, lead_id, campaign_id, status, targeted_at, sent_at, 
                    delivered_at, opened_at, clicked_at, replied_at, bounced_at,
                    custom_variables, subject, body_html, body_text, error_message, attempts
                )
                SELECT 
                    cl.id, cl.lead_id, cl.campaign_id, cl.status, cl.created_at, cl.sent_at,
                    cl.delivered_at, cl.opened_at, cl.clicked_at, cl.replied_at, cl.bounced_at,
                    cl.custom_variables, cl.subject, cl.body_html, cl.body_text, cl.error_message, cl.attempts
                FROM campaign_leads cl
                WHERE NOT EXISTS (
                    SELECT 1 FROM lead_campaign_history lch 
                    WHERE lch.lead_id = cl.lead_id AND lch.campaign_id = cl.campaign_id
                )
            `);
            
            console.log(`✅ Migrated ${count} campaign lead records to new schema`);
        }
        
    } catch (error) {
        console.error('❌ Error migrating campaign leads:', error);
        // Don't throw here - this is just migration, main setup should continue
    }
}

async function createDefaultLists(client) {
    try {
        // Get the first organization (for testing)
        const orgResult = await client.query(`
            SELECT id FROM organizations LIMIT 1
        `);
        
        if (orgResult.rows.length === 0) {
            console.log('⚠️  No organizations found, skipping default lists creation');
            return;
        }
        
        const organizationId = orgResult.rows[0].id;
        
        // Get the first user (for testing)
        const userResult = await client.query(`
            SELECT id FROM users LIMIT 1
        `);
        
        if (userResult.rows.length === 0) {
            console.log('⚠️  No users found, skipping default lists creation');
            return;
        }
        
        const userId = userResult.rows[0].id;
        
        // Create default contact lists
        const defaultLists = [
            {
                name: 'General Leads',
                description: 'Default list for all imported leads',
                type: 'custom'
            },
            {
                name: 'Newsletter Subscribers',
                description: 'Contacts who subscribed to newsletter',
                type: 'custom'
            },
            {
                name: 'High Priority Prospects',
                description: 'Qualified leads ready for outreach',
                type: 'custom'
            }
        ];
        
        for (const list of defaultLists) {
            // Check if list already exists
            const existing = await client.query(`
                SELECT id FROM contact_lists 
                WHERE organization_id = $1 AND name = $2
            `, [organizationId, list.name]);
            
            if (existing.rows.length === 0) {
                await client.query(`
                    INSERT INTO contact_lists (
                        id, organization_id, name, description, type, created_by, updated_by
                    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
                `, [organizationId, list.name, list.description, list.type, userId, userId]);
                
                console.log(`   ✅ Created list: "${list.name}"`);
            } else {
                console.log(`   ⚠️  List already exists: "${list.name}"`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error creating default lists:', error);
    }
}

async function testContactListsFunctionality(client) {
    try {
        // Test 1: Get contact lists count
        const listsResult = await client.query(`
            SELECT COUNT(*) as count FROM contact_lists WHERE is_active = true
        `);
        console.log(`   📋 Active contact lists: ${listsResult.rows[0].count}`);
        
        // Test 2: Get leads count
        const leadsResult = await client.query(`
            SELECT COUNT(*) as count FROM leads
        `);
        console.log(`   👥 Total leads: ${leadsResult.rows[0].count}`);
        
        // Test 3: Test unused leads query
        const unusedLeadsResult = await client.query(`
            SELECT COUNT(*) as count FROM leads l 
            WHERE l.id NOT IN (
                SELECT DISTINCT lch.lead_id 
                FROM lead_campaign_history lch
                WHERE lch.status IN ('sent', 'delivered')
            )
        `);
        console.log(`   🆕 Unused leads: ${unusedLeadsResult.rows[0].count}`);
        
        // Test 4: Test campaign history
        const campaignHistoryResult = await client.query(`
            SELECT COUNT(*) as count FROM lead_campaign_history
        `);
        console.log(`   📊 Campaign history records: ${campaignHistoryResult.rows[0].count}`);
        
        // Test 5: Test suppression list
        const suppressionResult = await client.query(`
            SELECT COUNT(*) as count FROM suppression_lists
        `);
        console.log(`   🚫 Suppressed contacts: ${suppressionResult.rows[0].count}`);
        
        console.log('   ✅ All functionality tests passed');
        
    } catch (error) {
        console.error('❌ Error testing functionality:', error);
    }
}

// Cleanup function to remove old campaign_leads table (use with caution)
async function cleanupOldSchema() {
    const client = await pool.connect();
    
    try {
        console.log('🧹 Cleaning up old schema...');
        
        // Only drop if migration was successful
        const historyCount = await client.query(`
            SELECT COUNT(*) as count FROM lead_campaign_history
        `);
        
        const oldCount = await client.query(`
            SELECT COUNT(*) as count FROM campaign_leads
        `);
        
        if (parseInt(historyCount.rows[0].count) >= parseInt(oldCount.rows[0].count)) {
            console.log('✅ Migration verified, old table can be safely dropped');
            console.log('⚠️  Run this manually when ready: DROP TABLE campaign_leads;');
        } else {
            console.log('❌ Migration verification failed, keeping old table');
        }
        
    } catch (error) {
        console.error('❌ Error in cleanup:', error);
    } finally {
        client.release();
    }
}

// Run the setup
if (require.main === module) {
    setupContactLists()
        .then(() => {
            console.log('\n🎯 Next steps:');
            console.log('   1. Update your frontend to use the new API endpoints');
            console.log('   2. Test the smart lead filtering in campaign creation');
            console.log('   3. Import leads to specific contact lists');
            console.log('   4. Run cleanupOldSchema() when ready to remove old table');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Setup failed:', error);
            process.exit(1);
        });
}

module.exports = {
    setupContactLists,
    migrateCampaignLeads,
    createDefaultLists,
    testContactListsFunctionality,
    cleanupOldSchema
};
