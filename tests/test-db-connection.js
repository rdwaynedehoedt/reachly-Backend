/**
 * Test database connection to diagnose timeout issues
 */

const pool = require('./config/database');

async function testDatabaseConnection() {
    console.log('🔍 Testing database connection...\n');
    
    try {
        console.log('⏳ Attempting to connect...');
        const client = await pool.connect();
        
        console.log('✅ Connection successful!');
        
        // Test a simple query
        console.log('📊 Testing simple query...');
        const result = await client.query('SELECT NOW() as current_time, current_database(), current_user');
        
        console.log('✅ Query successful:');
        console.log('   Time:', result.rows[0].current_time);
        console.log('   Database:', result.rows[0].current_database);
        console.log('   User:', result.rows[0].current_user);
        
        client.release();
        
        console.log('\n🎉 Database is working perfectly!');
        
    } catch (error) {
        console.log('❌ Database connection failed:');
        console.log('   Error:', error.message);
        console.log('   Code:', error.code);
        
        if (error.code === 'ENOTFOUND') {
            console.log('\n💡 Fix: Check your database host URL');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 Fix: Database server may be down');
        } else if (error.code === 'ETIMEDOUT') {
            console.log('\n💡 Fix: Connection timeout - check firewall/VPN');
        }
    }
    
    await pool.end();
}

testDatabaseConnection();
