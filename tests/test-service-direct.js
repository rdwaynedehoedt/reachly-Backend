/**
 * Test the FindyMail service directly to isolate the issue
 */

// Set environment variable for the test
process.env.FINDYMAIL_API_KEY = 'ZyxKUSdlueWLtL9IpvO7uUsHVElnQz0zz3gu91Gb965a66b3';

const findymailService = require('./services/findymailService');

async function testServiceDirect() {
    console.log('🔍 Testing FindyMail service directly...\n');
    
    try {
        console.log('⚡ Calling service method directly...');
        
        const result = await findymailService.findEmailFromLinkedIn(
            'https://www.linkedin.com/in/elonmusk',
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // organizationId
            null, // leadId
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'  // userId
        );
        
        console.log('✅ Service result:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.log('❌ Service error:');
        console.log('  Message:', error.message);
        console.log('  Stack:', error.stack);
    }
    
    // Also test credits directly
    try {
        console.log('\n💰 Testing credits service directly...');
        const creditsResult = await findymailService.getRemainingCredits();
        console.log('✅ Credits result:', JSON.stringify(creditsResult, null, 2));
    } catch (error) {
        console.log('❌ Credits service error:', error.message);
    }
}

testServiceDirect();
