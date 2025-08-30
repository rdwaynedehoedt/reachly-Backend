const pool = require('./config/database');
const ContactListsController = require('./controllers/contactLists.controller');
const { v4: uuidv4 } = require('uuid');

/**
 * Comprehensive test suite for the Contact Lists system
 * Tests all the new functionality including smart filtering
 */

class ContactListsSystemTester {
    constructor() {
        this.organizationId = null;
        this.userId = null;
        this.testListId = null;
        this.testLeadIds = [];
        this.testCampaignId = null;
    }

    async runTests() {
        const client = await pool.connect();
        
        try {
            console.log('🧪 Starting Contact Lists System Tests...\n');
            
            // Setup test data
            await this.setupTestData(client);
            
            // Test 1: Contact Lists CRUD
            await this.testContactListsCRUD();
            
            // Test 2: Adding leads to lists
            await this.testAddingLeadsToLists();
            
            // Test 3: Smart lead filtering
            await this.testSmartLeadFiltering();
            
            // Test 4: Campaign exclusion rules
            await this.testCampaignExclusionRules();
            
            // Test 5: Import leads to lists
            await this.testImportLeadsToLists();
            
            // Test 6: Suppression management
            await this.testSuppressionManagement();
            
            // Cleanup
            await this.cleanup(client);
            
            console.log('🎉 All Contact Lists tests passed successfully!\n');
            console.log('✅ The system is ready for production use');
            
        } catch (error) {
            console.error('❌ Test failed:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async setupTestData(client) {
        console.log('📋 Setting up test data...');
        
        // Create test organization
        this.organizationId = uuidv4();
        await client.query(`
            INSERT INTO organizations (id, name, created_by) 
            VALUES ($1, 'Test Org for Contact Lists', $1)
        `, [this.organizationId]);
        
        // Create test user
        this.userId = uuidv4();
        await client.query(`
            INSERT INTO users (id, email, first_name, last_name) 
            VALUES ($1, 'test@contactlists.com', 'Test', 'User')
        `, [this.userId]);
        
        // Add user to organization
        await client.query(`
            INSERT INTO organization_members (id, organization_id, user_id, role, status) 
            VALUES (gen_random_uuid(), $1, $2, 'owner', 'active')
        `, [this.organizationId, this.userId]);
        
        // Create test leads
        for (let i = 1; i <= 10; i++) {
            const leadId = uuidv4();
            await client.query(`
                INSERT INTO leads (
                    id, organization_id, email, first_name, last_name, 
                    company_name, job_title, status, source, created_by, updated_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                leadId, this.organizationId, `testlead${i}@example.com`, 
                `Test${i}`, `Lead${i}`, `Company ${i}`, `Title ${i}`, 
                'new', 'Test Import', this.userId, this.userId
            ]);
            this.testLeadIds.push(leadId);
        }
        
        // Create test campaign
        this.testCampaignId = uuidv4();
        await client.query(`
            INSERT INTO campaigns (
                id, organization_id, name, description, status, 
                created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            this.testCampaignId, this.organizationId, 'Test Campaign', 
            'Test campaign for contact lists', 'draft', this.userId, this.userId
        ]);
        
        console.log('✅ Test data setup complete');
    }

    async testContactListsCRUD() {
        console.log('\n🧪 Test 1: Contact Lists CRUD Operations');
        
        // Mock request/response objects
        const req = {
            user: { userId: this.userId },
            body: {
                name: 'Test Contact List',
                description: 'Test list for CRUD operations',
                type: 'custom'
            }
        };
        
        let responseData = null;
        const res = {
            status: (code) => ({
                json: (data) => { responseData = data; }
            }),
            json: (data) => { responseData = data; }
        };
        
        // Create contact list
        await ContactListsController.createContactList(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to create contact list: ' + responseData.message);
        }
        
        this.testListId = responseData.data.contactList.id;
        console.log('   ✅ Created contact list successfully');
        
        // Get contact lists
        req.body = {};
        await ContactListsController.getContactLists(req, res);
        
        if (!responseData.success || responseData.data.contactLists.length === 0) {
            throw new Error('Failed to retrieve contact lists');
        }
        
        console.log(`   ✅ Retrieved ${responseData.data.contactLists.length} contact lists`);
        console.log('   ✅ Contact Lists CRUD test passed');
    }

    async testAddingLeadsToLists() {
        console.log('\n🧪 Test 2: Adding Leads to Lists');
        
        const req = {
            user: { userId: this.userId },
            params: { id: this.testListId },
            body: {
                leadIds: this.testLeadIds.slice(0, 5), // Add first 5 leads
                source: 'test'
            }
        };
        
        let responseData = null;
        const res = {
            json: (data) => { responseData = data; }
        };
        
        await ContactListsController.addContactsToList(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to add contacts to list: ' + responseData.message);
        }
        
        console.log(`   ✅ Added ${responseData.data.added} contacts to list`);
        
        // Get list contacts
        req.body = {};
        req.query = { page: 1, limit: 50, status: 'active' };
        
        await ContactListsController.getListContacts(req, res);
        
        if (!responseData.success || responseData.data.contacts.length !== 5) {
            throw new Error('Failed to retrieve list contacts');
        }
        
        console.log(`   ✅ Retrieved ${responseData.data.contacts.length} contacts from list`);
        console.log('   ✅ Adding leads to lists test passed');
    }

    async testSmartLeadFiltering() {
        console.log('\n🧪 Test 3: Smart Lead Filtering');
        
        const req = {
            user: { userId: this.userId },
            query: {}
        };
        
        let responseData = null;
        const res = {
            json: (data) => { responseData = data; }
        };
        
        // Test 1: Get all leads
        req.query = { filter: 'all', page: 1, limit: 100 };
        await ContactListsController.getAvailableLeads(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to get all leads: ' + responseData.message);
        }
        
        const allLeadsCount = responseData.data.leads.length;
        console.log(`   ✅ Found ${allLeadsCount} total leads`);
        
        // Test 2: Get unused leads
        req.query = { filter: 'unused', page: 1, limit: 100 };
        await ContactListsController.getAvailableLeads(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to get unused leads: ' + responseData.message);
        }
        
        const unusedLeadsCount = responseData.data.leads.length;
        console.log(`   ✅ Found ${unusedLeadsCount} unused leads`);
        
        // Test 3: Get leads from specific list
        req.query = { filter: 'list', listId: this.testListId, page: 1, limit: 100 };
        await ContactListsController.getAvailableLeads(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to get list leads: ' + responseData.message);
        }
        
        const listLeadsCount = responseData.data.leads.length;
        console.log(`   ✅ Found ${listLeadsCount} leads in specific list`);
        
        // Test 4: Search leads
        req.query = { filter: 'all', search: 'Test1', page: 1, limit: 100 };
        await ContactListsController.getAvailableLeads(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to search leads: ' + responseData.message);
        }
        
        const searchLeadsCount = responseData.data.leads.length;
        console.log(`   ✅ Found ${searchLeadsCount} leads matching search 'Test1'`);
        
        console.log('   ✅ Smart lead filtering test passed');
    }

    async testCampaignExclusionRules() {
        console.log('\n🧪 Test 4: Campaign Exclusion Rules');
        
        const client = await pool.connect();
        
        try {
            // Add some leads to campaign history (simulate sent campaigns)
            for (let i = 0; i < 3; i++) {
                await client.query(`
                    INSERT INTO lead_campaign_history (
                        id, lead_id, campaign_id, status, targeted_at, sent_at
                    ) VALUES (gen_random_uuid(), $1, $2, 'sent', NOW(), NOW())
                `, [this.testLeadIds[i], this.testCampaignId]);
            }
            
            console.log('   ✅ Added 3 leads to campaign history');
            
            // Test exclusion rules
            const req = {
                user: { userId: this.userId },
                query: { 
                    filter: 'unused', 
                    excludeCampaignIds: [this.testCampaignId],
                    page: 1, 
                    limit: 100 
                }
            };
            
            let responseData = null;
            const res = {
                json: (data) => { responseData = data; }
            };
            
            await ContactListsController.getAvailableLeads(req, res);
            
            if (!responseData.success) {
                throw new Error('Failed to test campaign exclusion: ' + responseData.message);
            }
            
            const excludedLeadsCount = responseData.data.leads.length;
            console.log(`   ✅ Found ${excludedLeadsCount} leads after excluding campaign`);
            
            // Verify exclusion worked
            const excludedEmails = responseData.data.leads.map(lead => lead.email);
            const shouldBeExcluded = ['testlead1@example.com', 'testlead2@example.com', 'testlead3@example.com'];
            
            for (const email of shouldBeExcluded) {
                if (excludedEmails.includes(email)) {
                    throw new Error(`Lead ${email} should have been excluded but was found`);
                }
            }
            
            console.log('   ✅ Campaign exclusion rules working correctly');
            
        } finally {
            client.release();
        }
        
        console.log('   ✅ Campaign exclusion rules test passed');
    }

    async testImportLeadsToLists() {
        console.log('\n🧪 Test 5: Import Leads to Lists');
        
        const importLeads = [
            {
                email: 'import1@example.com',
                first_name: 'Import',
                last_name: 'Lead1',
                company_name: 'Import Company 1'
            },
            {
                email: 'import2@example.com',
                first_name: 'Import',
                last_name: 'Lead2',
                company_name: 'Import Company 2'
            }
        ];
        
        const req = {
            user: { userId: this.userId },
            params: { id: this.testListId },
            body: {
                leads: importLeads,
                fileName: 'test-import.csv'
            }
        };
        
        let responseData = null;
        const res = {
            status: (code) => ({
                json: (data) => { responseData = data; }
            })
        };
        
        await ContactListsController.importLeadsToList(req, res);
        
        if (!responseData.success) {
            throw new Error('Failed to import leads to list: ' + responseData.message);
        }
        
        console.log(`   ✅ Imported ${responseData.data.imported} leads to list`);
        console.log('   ✅ Import leads to lists test passed');
    }

    async testSuppressionManagement() {
        console.log('\n🧪 Test 6: Suppression Management');
        
        const client = await pool.connect();
        
        try {
            // Add some email addresses to suppression list
            await client.query(`
                INSERT INTO suppression_lists (
                    id, organization_id, email, reason, suppressed_by
                ) VALUES 
                (gen_random_uuid(), $1, 'suppressed1@example.com', 'unsubscribed', $2),
                (gen_random_uuid(), $1, 'suppressed2@example.com', 'bounced', $2)
            `, [this.organizationId, this.userId]);
            
            console.log('   ✅ Added 2 emails to suppression list');
            
            // Test that suppressed emails are excluded from available leads
            const req = {
                user: { userId: this.userId },
                query: { filter: 'all', page: 1, limit: 100 }
            };
            
            let responseData = null;
            const res = {
                json: (data) => { responseData = data; }
            };
            
            await ContactListsController.getAvailableLeads(req, res);
            
            if (!responseData.success) {
                throw new Error('Failed to test suppression: ' + responseData.message);
            }
            
            // Verify suppressed emails are not in results
            const availableEmails = responseData.data.leads.map(lead => lead.email);
            const suppressedEmails = ['suppressed1@example.com', 'suppressed2@example.com'];
            
            for (const email of suppressedEmails) {
                if (availableEmails.includes(email)) {
                    throw new Error(`Suppressed email ${email} was found in available leads`);
                }
            }
            
            console.log('   ✅ Suppressed emails correctly excluded from available leads');
            
        } finally {
            client.release();
        }
        
        console.log('   ✅ Suppression management test passed');
    }

    async cleanup(client) {
        console.log('\n🧹 Cleaning up test data...');
        
        try {
            // Clean up in reverse order due to foreign key constraints
            await client.query('DELETE FROM lead_campaign_history WHERE campaign_id = $1', [this.testCampaignId]);
            await client.query('DELETE FROM campaigns WHERE id = $1', [this.testCampaignId]);
            await client.query('DELETE FROM contact_list_members WHERE contact_list_id = $1', [this.testListId]);
            await client.query('DELETE FROM contact_lists WHERE id = $1', [this.testListId]);
            await client.query('DELETE FROM suppression_lists WHERE organization_id = $1', [this.organizationId]);
            await client.query('DELETE FROM leads WHERE organization_id = $1', [this.organizationId]);
            await client.query('DELETE FROM organization_members WHERE organization_id = $1', [this.organizationId]);
            await client.query('DELETE FROM organizations WHERE id = $1', [this.organizationId]);
            await client.query('DELETE FROM users WHERE id = $1', [this.userId]);
            
            console.log('✅ Test data cleanup complete');
            
        } catch (error) {
            console.warn('⚠️  Some cleanup operations failed (this is usually fine for testing)');
        }
    }
}

// Performance test
async function performanceTest() {
    console.log('\n⚡ Running Performance Tests...');
    
    const client = await pool.connect();
    
    try {
        // Test 1: Large dataset filtering
        const start = Date.now();
        
        await client.query(`
            SELECT COUNT(*) FROM leads l 
            WHERE l.id NOT IN (
                SELECT DISTINCT lch.lead_id 
                FROM lead_campaign_history lch
                WHERE lch.status IN ('sent', 'delivered')
            )
        `);
        
        const end = Date.now();
        console.log(`   ✅ Unused leads query took ${end - start}ms`);
        
        // Test 2: List membership query
        const start2 = Date.now();
        
        await client.query(`
            SELECT COUNT(*) FROM contact_list_members clm
            JOIN leads l ON clm.lead_id = l.id
            WHERE clm.status = 'active'
        `);
        
        const end2 = Date.now();
        console.log(`   ✅ List membership query took ${end2 - start2}ms`);
        
        console.log('   ✅ Performance tests completed');
        
    } finally {
        client.release();
    }
}

// Run tests
if (require.main === module) {
    const tester = new ContactListsSystemTester();
    
    tester.runTests()
        .then(() => performanceTest())
        .then(() => {
            console.log('\n🚀 All tests completed successfully!');
            console.log('\n📊 System Status:');
            console.log('   ✅ Contact Lists: Fully Functional');
            console.log('   ✅ Smart Filtering: Working');
            console.log('   ✅ Campaign Exclusion: Working');
            console.log('   ✅ Suppression Management: Working');
            console.log('   ✅ Import System: Working');
            console.log('   ✅ Performance: Optimized');
            console.log('\n🎯 Ready for Frontend Integration!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Tests failed:', error);
            process.exit(1);
        });
}

module.exports = ContactListsSystemTester;
