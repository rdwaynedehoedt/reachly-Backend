/**
 * OAuth Configuration Verification Script
 * Run this after updating .env files to verify everything is correctly configured
 */

require('dotenv').config();
const { OAuth2Client } = require('google-auth-library');

async function verifyOAuthConfig() {
    console.log('🔍 Verifying Google OAuth Configuration...\n');
    
    // Check environment variables
    const requiredEnvVars = [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI'
    ];
    
    let allEnvVarsPresent = true;
    
    console.log('📋 Environment Variables:');
    requiredEnvVars.forEach(varName => {
        const value = process.env[varName];
        if (value && value !== 'your-google-client-id-from-cloud-console') {
            console.log(`✅ ${varName}: ${value.substring(0, 20)}...`);
        } else {
            console.log(`❌ ${varName}: NOT SET or still placeholder`);
            allEnvVarsPresent = false;
        }
    });
    
    if (!allEnvVarsPresent) {
        console.log('\n❌ Please update your .env file with actual Google OAuth credentials');
        return;
    }
    
    console.log('\n🔧 Testing OAuth2 Client...');
    
    try {
        // Test OAuth2 client creation
        const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        console.log('✅ OAuth2 Client created successfully');
        
        // Test URL generation
        const authUrl = googleClient.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            redirect_uri: process.env.GOOGLE_REDIRECT_URI
        });
        
        console.log('✅ OAuth URL generation working');
        console.log(`🔗 Redirect URI: ${process.env.GOOGLE_REDIRECT_URI}`);
        
    } catch (error) {
        console.log('❌ OAuth2 Client error:', error.message);
        return;
    }
    
    console.log('\n🎉 OAuth Configuration looks good!');
    console.log('\n📋 Next steps:');
    console.log('   1. ✅ Backend .env - CONFIGURED');
    console.log('   2. 🔧 Frontend .env.local - Make sure it exists');
    console.log('   3. ☁️ Google Cloud Console - Verify authorized origins');
    console.log('   4. 🔄 Restart both servers');
    console.log('   5. 🧪 Test Google login');
}

// Check for duplicate client IDs in .env content
function checkForDuplicates() {
    const fs = require('fs');
    try {
        const envContent = fs.readFileSync('.env', 'utf8');
        const clientIdMatches = envContent.match(/GOOGLE_CLIENT_ID=/g);
        
        if (clientIdMatches && clientIdMatches.length > 1) {
            console.log(`⚠️  Found ${clientIdMatches.length} GOOGLE_CLIENT_ID entries in .env`);
            console.log('🔧 Please remove duplicates and keep only one');
            return false;
        }
        
        console.log('✅ No duplicate GOOGLE_CLIENT_ID entries found');
        return true;
    } catch (error) {
        console.log('⚠️  Could not read .env file');
        return true;
    }
}

// Run verification
console.log('🧪 Google OAuth Configuration Verification\n');
console.log('='.repeat(50));

if (checkForDuplicates()) {
    verifyOAuthConfig();
} else {
    console.log('\n❌ Please fix duplicate GOOGLE_CLIENT_ID entries in .env first');
}

console.log('\n' + '='.repeat(50));
