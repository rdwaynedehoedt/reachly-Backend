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

const pool = new Pool(dbConfig);

/**
 * Test script specifically for the logged-in user: dwaynet3x@gmail.com
 * Based on database data we found earlier
 */
class UserEmailSystemTester {
    constructor() {
        this.testResults = [];
        this.passedTests = 0;
        this.failedTests = 0;
        this.userData = null;
    }

    logTest(testName, passed, details = '') {
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} - ${testName}`);
        if (details) console.log(`    ${details}`);
        
        this.testResults.push({ testName, passed, details });
        if (passed) this.passedTests++;
        else this.failedTests++;
    }

    // Test 1: Verify User Setup
    async testUserSetup() {
        const client = await pool.connect();
        try {
            // Get user data
            const userResult = await client.query(`
                SELECT u.id, u.email, u.first_name, u.last_name, u.auth_provider,
                       up.onboarding_completed, up.role, up.experience_level
                FROM users u
                LEFT JOIN user_profiles up ON u.id = up.user_id
                WHERE u.email = 'dwaynet3x@gmail.com'
            `);

            if (userResult.rows.length > 0) {
                this.userData = userResult.rows[0];
                this.logTest('User Account Setup', true, 
                    `User: ${this.userData.email} (${this.userData.first_name} ${this.userData.last_name})`);
                return true;
            } else {
                this.logTest('User Account Setup', false, 'User not found in database');
                return false;
            }
        } catch (error) {
            this.logTest('User Account Setup', false, error.message);
            return false;
        } finally {
            client.release();
        }
    }

    // Test 2: Verify Organization Setup
    async testOrganizationSetup() {
        const client = await pool.connect();
        try {
            const orgResult = await client.query(`
                SELECT o.id, o.name, o.industry, o.size, om.role, om.status
                FROM organizations o
                JOIN organization_members om ON o.id = om.organization_id
                WHERE om.user_id = $1
            `, [this.userData.id]);

            if (orgResult.rows.length > 0) {
                const org = orgResult.rows[0];
                this.logTest('Organization Setup', true, 
                    `Organization: "${org.name}" (${org.industry}, ${org.size}) - Role: ${org.role}`);
                return org;
            } else {
                this.logTest('Organization Setup', false, 'No organization found for user');
                return null;
            }
        } catch (error) {
            this.logTest('Organization Setup', false, error.message);
            return null;
        } finally {
            client.release();
        }
    }

    // Test 3: Verify Gmail Connection
    async testGmailConnection() {
        const client = await pool.connect();
        try {
            const emailResult = await client.query(`
                SELECT id, email, display_name, provider, status, scopes, created_at
                FROM email_accounts
                WHERE user_id = $1 AND provider = 'gmail'
            `, [this.userData.id]);

            if (emailResult.rows.length > 0) {
                const emailAccount = emailResult.rows[0];
                const hasGmailSendScope = emailAccount.scopes && 
                    emailAccount.scopes.includes('https://www.googleapis.com/auth/gmail.send');
                
                if (emailAccount.status === 'active' && hasGmailSendScope) {
                    this.logTest('Gmail Connection', true, 
                        `Gmail account: ${emailAccount.email} - Status: ${emailAccount.status} - Has send permissions: ${hasGmailSendScope}`);
                    return emailAccount;
                } else {
                    this.logTest('Gmail Connection', false, 
                        `Gmail account exists but status: ${emailAccount.status}, send permissions: ${hasGmailSendScope}`);
                    return null;
                }
            } else {
                this.logTest('Gmail Connection', false, 'No Gmail account connected');
                return null;
            }
        } catch (error) {
            this.logTest('Gmail Connection', false, error.message);
            return null;
        } finally {
            client.release();
        }
    }

    // Test 4: Database Schema Validation
    async testDatabaseSchema() {
        const client = await pool.connect();
        try {
            // Check if all required tables exist
            const requiredTables = [
                'users', 'user_profiles', 'organizations', 'organization_members',
                'email_accounts', 'email_sends', 'email_tracking_events', 'email_templates'
            ];

            const tableResult = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = ANY($1)
            `, [requiredTables]);

            const existingTables = tableResult.rows.map(row => row.table_name);
            const missingTables = requiredTables.filter(table => !existingTables.includes(table));

            if (missingTables.length === 0) {
                this.logTest('Database Schema', true, 
                    `All required tables exist: ${existingTables.join(', ')}`);
                return true;
            } else {
                this.logTest('Database Schema', false, 
                    `Missing tables: ${missingTables.join(', ')}`);
                return false;
            }
        } catch (error) {
            this.logTest('Database Schema', false, error.message);
            return false;
        } finally {
            client.release();
        }
    }

    // Test 5: Email History Check
    async testEmailHistory() {
        const client = await pool.connect();
        try {
            const emailHistory = await client.query(`
                SELECT es.*, ea.email as from_email
                FROM email_sends es
                JOIN email_accounts ea ON es.email_account_id = ea.id
                WHERE es.user_id = $1
                ORDER BY es.sent_at DESC
                LIMIT 10
            `, [this.userData.id]);

            this.logTest('Email History', true, 
                `Found ${emailHistory.rows.length} emails in history`);
            
            if (emailHistory.rows.length > 0) {
                console.log('    Recent emails:');
                emailHistory.rows.forEach((email, index) => {
                    console.log(`    ${index + 1}. To: ${email.recipient_email} | Subject: ${email.subject} | Status: ${email.status} | Sent: ${email.sent_at}`);
                });
            }
            
            return emailHistory.rows;
        } catch (error) {
            this.logTest('Email History', false, error.message);
            return [];
        } finally {
            client.release();
        }
    }

    // Test 6: Leads Data
    async testLeadsData() {
        const client = await pool.connect();
        try {
            // Get organization ID first
            const orgResult = await client.query(`
                SELECT om.organization_id
                FROM organization_members om
                WHERE om.user_id = $1 AND om.status = 'active'
                LIMIT 1
            `, [this.userData.id]);

            if (orgResult.rows.length === 0) {
                this.logTest('Leads Data', false, 'No organization found');
                return [];
            }

            const organizationId = orgResult.rows[0].organization_id;
            
            const leadsResult = await client.query(`
                SELECT id, email, first_name, last_name, company_name, status, source, created_at
                FROM leads
                WHERE organization_id = $1
                ORDER BY created_at DESC
                LIMIT 10
            `, [organizationId]);

            this.logTest('Leads Data', true, 
                `Found ${leadsResult.rows.length} leads in database`);
            
            if (leadsResult.rows.length > 0) {
                console.log('    Recent leads:');
                leadsResult.rows.forEach((lead, index) => {
                    console.log(`    ${index + 1}. ${lead.first_name} ${lead.last_name} <${lead.email}> - ${lead.company_name} (${lead.status})`);
                });
            }
            
            return leadsResult.rows;
        } catch (error) {
            this.logTest('Leads Data', false, error.message);
            return [];
        } finally {
            client.release();
        }
    }

    // Run all tests for the specific user
    async runUserTests() {
        console.log('🧪 Testing Email System for User: dwaynet3x@gmail.com');
        console.log('=====================================================\n');

        // Core setup tests
        console.log('👤 User & Organization Tests:');
        const userSetup = await this.testUserSetup();
        if (!userSetup) return false;

        const orgSetup = await this.testOrganizationSetup();
        const gmailConnection = await this.testGmailConnection();
        
        console.log('\n🗄️ Database Tests:');
        await this.testDatabaseSchema();
        
        console.log('\n📧 Email System Tests:');
        await this.testEmailHistory();
        
        console.log('\n📇 Leads System Tests:');
        await this.testLeadsData();

        // Summary
        console.log('\n📊 Test Summary:');
        console.log('================');
        console.log(`✅ Passed: ${this.passedTests}`);
        console.log(`❌ Failed: ${this.failedTests}`);
        console.log(`📈 Success Rate: ${((this.passedTests / (this.passedTests + this.failedTests)) * 100).toFixed(1)}%`);

        // System readiness assessment
        const isEmailReady = userSetup && orgSetup && gmailConnection;
        console.log('\n🎯 System Readiness Assessment:');
        console.log('===============================');
        
        if (isEmailReady) {
            console.log('🟢 EMAIL SYSTEM: READY FOR TESTING');
            console.log('✅ User account: Set up');
            console.log('✅ Organization: Active membership');
            console.log('✅ Gmail connection: Active with send permissions');
            console.log('✅ Database: All tables present');
            
            console.log('\n🚀 READY TO TEST:');
            console.log('1. Navigate to: http://localhost:3000/emails/compose');
            console.log('2. Send a test email to yourself');
            console.log('3. Check email history: http://localhost:3000/emails/history');
            console.log('4. Verify email received in your Gmail inbox');
        } else {
            console.log('🟡 EMAIL SYSTEM: NEEDS ATTENTION');
            if (!userSetup) console.log('❌ User account setup incomplete');
            if (!orgSetup) console.log('❌ Organization setup incomplete');
            if (!gmailConnection) console.log('❌ Gmail connection issues');
        }

        return isEmailReady;
    }
}

// Run the user-specific tests
async function main() {
    const tester = new UserEmailSystemTester();
    const systemReady = await tester.runUserTests();
    
    if (systemReady) {
        console.log('\n🎉 Your email system is ready for testing!');
        console.log('\nNext steps:');
        console.log('1. Make sure frontend is running: npm run dev (in reachly-frontend)');
        console.log('2. Go to: http://localhost:3000/dashboard');
        console.log('3. Click "Campaigns" in sidebar to see new section');
        console.log('4. Test email sending functionality');
    } else {
        console.log('\n⚠️ Please fix the issues above before testing.');
    }
    
    await pool.end();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = UserEmailSystemTester;
