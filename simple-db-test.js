const pool = require('./config/database');

async function testDatabase() {
    console.log('🔍 TESTING DATABASE CONNECTION...');
    
    try {
        const client = await pool.connect();
        console.log('✅ Connected to database');
        
        // Check if our tables exist
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name IN ('contact_hashes', 'contact_search_history') 
            AND table_schema = 'public'
        `);
        
        console.log(`📊 Found ${tablesResult.rows.length} optimized cache tables:`);
        tablesResult.rows.forEach(row => {
            console.log(`   ✅ ${row.table_name}`);
        });
        
        if (tablesResult.rows.length === 0) {
            console.log('❌ No optimized cache tables found - need to create them');
        } else {
            console.log('🎉 Optimized cache tables exist!');
            
            // Test a simple query
            const countResult = await client.query('SELECT COUNT(*) as count FROM contact_hashes');
            console.log(`📈 Contact hashes in cache: ${countResult.rows[0].count}`);
        }
        
        client.release();
        await pool.end();
        
    } catch (error) {
        console.error('❌ Database test failed:', error.message);
    }
}

testDatabase();
