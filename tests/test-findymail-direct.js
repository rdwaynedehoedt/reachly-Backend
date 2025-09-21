/**
 * Direct test of FindyMail API to debug authentication
 */

const axios = require('axios');

const API_KEY = 'ZyxKUSdlueWLtL9IpvO7uUsHVElnQz0zz3gu91Gb965a66b3';
const BASE_URL = 'https://app.findymail.com';

async function testFindyMailDirectly() {
    console.log('🔍 Testing FindyMail API directly...\n');
    
    // Test 1: Credits endpoint with Bearer auth
    console.log('1️⃣ Testing /api/credits with Bearer authentication...');
    try {
        const response = await axios.get(`${BASE_URL}/api/credits`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Credits response:', response.data);
    } catch (error) {
        console.log('❌ Credits error (Bearer):', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
        });
    }

    // Test 2: Try with X-Api-Key header instead  
    console.log('\n2️⃣ Testing /api/credits with X-Api-Key authentication...');
    try {
        const response = await axios.get(`${BASE_URL}/api/credits`, {
            headers: {
                'X-Api-Key': API_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Credits response (X-Api-Key):', response.data);
    } catch (error) {
        console.log('❌ Credits error (X-Api-Key):', {
            status: error.response?.status,
            statusText: error.response?.statusText,  
            data: error.response?.data
        });
    }

    // Test 3: LinkedIn search with Bearer
    console.log('\n3️⃣ Testing LinkedIn search with Bearer auth...');
    try {
        const response = await axios.post(`${BASE_URL}/api/search/linkedin`, {
            linkedin_url: 'https://www.linkedin.com/in/test'
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ LinkedIn search response:', response.data);
    } catch (error) {
        console.log('❌ LinkedIn search error:', {
            status: error.response?.status,
            data: error.response?.data
        });
    }

    console.log('\n🔑 API Key being used:', API_KEY.substring(0, 10) + '...');
    console.log('🌐 Base URL:', BASE_URL);
}

testFindyMailDirectly();
