/**
 * Simple test of LinkedIn search to debug the 500 error
 */

const axios = require('axios');

async function testLinkedInSimple() {
    console.log('🔍 Testing LinkedIn search with detailed error logging...\n');
    
    try {
        const response = await axios.post('http://localhost:5000/api/findymail/find-email-linkedin', {
            linkedin_url: 'https://www.linkedin.com/in/elonmusk'
        }, {
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ Success! Response:', JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        console.log('❌ Error details:');
        console.log('  Status:', error.response?.status);
        console.log('  Status Text:', error.response?.statusText);
        console.log('  Response Data:', JSON.stringify(error.response?.data, null, 2));
        console.log('  Error Message:', error.message);
        
        if (error.code) {
            console.log('  Error Code:', error.code);
        }
    }
}

testLinkedInSimple();
