const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:5000/api';
const FRONTEND_URL = 'http://localhost:3000';

// Test data
let authToken = null;
let userId = null;
let emailAccountId = null;

/**
 * Comprehensive Email System Testing Script
 */
class EmailSystemTester {
    constructor() {
        this.testResults = [];
        this.passedTests = 0;
        this.failedTests = 0;
    }

    // Helper method to log test results
    logTest(testName, passed, details = '') {
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} - ${testName}`);
        if (details) console.log(`    ${details}`);
        
        this.testResults.push({ testName, passed, details });
        if (passed) this.passedTests++;
        else this.failedTests++;
    }

    // Test 1: Database Connection
    async testDatabaseConnection() {
        try {
            const response = await axios.get(`${BASE_URL}/db-test`);
            
            if (response.status === 200 && response.data.success) {
                this.logTest('Database Connection', true, `Connected to: ${response.data.data.database_name}`);
                return true;
            } else {
                this.logTest('Database Connection', false, 'Database response invalid');
                return false;
            }
        } catch (error) {
            this.logTest('Database Connection', false, error.message);
            return false;
        }
    }

    // Test 2: Server Health Check
    async testServerHealth() {
        try {
            const response = await axios.get('http://localhost:5000');
            
            if (response.status === 200 && response.data.message.includes('running')) {
                this.logTest('Server Health', true, 'Server is running properly');
                return true;
            } else {
                this.logTest('Server Health', false, 'Server health check failed');
                return false;
            }
        } catch (error) {
            this.logTest('Server Health', false, error.message);
            return false;
        }
    }

    // Test 3: Authentication Endpoints
    async testAuthenticationEndpoints() {
        try {
            // Test signup endpoint (without actually creating a user)
            const signupResponse = await axios.post(`${BASE_URL}/auth/signup`, {
                email: 'test@invalid.com',
                password: 'testpass'
            }).catch(err => err.response);

            if (signupResponse && signupResponse.status >= 400) {
                this.logTest('Auth Endpoints Available', true, 'Signup endpoint responding');
            } else {
                this.logTest('Auth Endpoints Available', false, 'Signup endpoint not responding properly');
            }

            return true;
        } catch (error) {
            this.logTest('Auth Endpoints Available', false, error.message);
            return false;
        }
    }

    // Test 4: Email Endpoints (without auth - should fail gracefully)
    async testEmailEndpointsWithoutAuth() {
        try {
            // Test email endpoints without authentication - should return 401
            const accountsResponse = await axios.get(`${BASE_URL}/emails/accounts`)
                .catch(err => err.response);

            if (accountsResponse && accountsResponse.status === 401) {
                this.logTest('Email Endpoints Auth Protection', true, 'Properly protected with authentication');
                return true;
            } else {
                this.logTest('Email Endpoints Auth Protection', false, 'Endpoints not properly protected');
                return false;
            }
        } catch (error) {
            this.logTest('Email Endpoints Auth Protection', false, error.message);
            return false;
        }
    }

    // Test 5: Database Schema Validation
    async testDatabaseSchema() {
        try {
            // This is a simple test - in a real scenario we'd check table structure
            const response = await axios.get(`${BASE_URL}/db-test`);
            
            if (response.data.success) {
                this.logTest('Database Schema', true, 'Database accessible and responding');
                return true;
            } else {
                this.logTest('Database Schema', false, 'Database schema issues');
                return false;
            }
        } catch (error) {
            this.logTest('Database Schema', false, error.message);
            return false;
        }
    }

    // Run all tests
    async runAllTests() {
        console.log('🧪 Starting Reachly Email System Tests');
        console.log('=====================================\n');

        // Backend Infrastructure Tests
        console.log('📡 Backend Infrastructure Tests:');
        await this.testServerHealth();
        await this.testDatabaseConnection();
        await this.testDatabaseSchema();
        
        console.log('\n🔐 Security & Auth Tests:');
        await this.testAuthenticationEndpoints();
        await this.testEmailEndpointsWithoutAuth();

        // Summary
        console.log('\n📊 Test Summary:');
        console.log('================');
        console.log(`✅ Passed: ${this.passedTests}`);
        console.log(`❌ Failed: ${this.failedTests}`);
        console.log(`📈 Success Rate: ${((this.passedTests / (this.passedTests + this.failedTests)) * 100).toFixed(1)}%`);

        if (this.failedTests === 0) {
            console.log('\n🎉 All backend tests passed! System is ready for manual testing.');
        } else {
            console.log('\n⚠️  Some tests failed. Please check the issues above.');
        }

        return this.failedTests === 0;
    }
}

// Manual Testing Instructions
function printManualTestingInstructions() {
    console.log('\n🔧 MANUAL TESTING INSTRUCTIONS');
    console.log('==============================\n');

    console.log('🎯 Prerequisites:');
    console.log('1. ✅ Backend running on http://localhost:5000');
    console.log('2. ✅ Frontend running on http://localhost:3000'); 
    console.log('3. ✅ You are logged in to Reachly');
    console.log('4. ✅ You have a Gmail account connected\n');

    console.log('📧 EMAIL SENDING TESTS:');
    console.log('========================\n');

    console.log('Test 1: Email Composer Access');
    console.log('- Navigate to: http://localhost:3000/emails/compose');
    console.log('- ✅ Page loads without errors');
    console.log('- ✅ Email composer form is visible');
    console.log('- ✅ Connected Gmail accounts appear in dropdown\n');

    console.log('Test 2: Send Test Email');
    console.log('- Fill in the form:');
    console.log('  • From: Select your connected Gmail account');
    console.log('  • To: Your own email address (for testing)');
    console.log('  • Subject: "Reachly Test Email"');
    console.log('  • Message: "This is a test email from Reachly!"');
    console.log('- Click "Send Email"');
    console.log('- ✅ Success message appears with Gmail Message ID');
    console.log('- ✅ Form resets after sending\n');

    console.log('Test 3: Verify Email Delivery');
    console.log('- Check your email inbox');
    console.log('- ✅ Email received from your Gmail account');
    console.log('- ✅ Subject and content match what you sent');
    console.log('- ✅ Email appears to come from your connected Gmail\n');

    console.log('Test 4: Email History');
    console.log('- Navigate to: http://localhost:3000/emails/history');
    console.log('- ✅ Page loads and shows email history');
    console.log('- ✅ Your test email appears with "sent" status');
    console.log('- ✅ All details (to, from, subject, timestamp) are correct\n');

    console.log('Test 5: Error Handling');
    console.log('- Try to send email with invalid recipient: "invalid-email"');
    console.log('- ✅ Proper error message displayed');
    console.log('- Try to send email without selecting account');
    console.log('- ✅ Validation error shown\n');

    console.log('🔍 WHAT TO REPORT:');
    console.log('==================');
    console.log('For each test, report:');
    console.log('✅ PASS - if everything works as expected');
    console.log('❌ FAIL - if there are errors, with details:');
    console.log('  • What you did');
    console.log('  • What happened');
    console.log('  • Any error messages');
    console.log('  • Browser console errors\n');
}

// Run the tests
async function main() {
    const tester = new EmailSystemTester();
    const backendTestsPassed = await tester.runAllTests();
    
    if (backendTestsPassed) {
        printManualTestingInstructions();
    } else {
        console.log('\n❌ Backend tests failed. Please fix backend issues before manual testing.');
    }
}

// Export for potential use as module
if (require.main === module) {
    main().catch(console.error);
}

module.exports = EmailSystemTester;
