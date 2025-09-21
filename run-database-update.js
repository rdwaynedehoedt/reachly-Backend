/**
 * DATABASE UPDATER: Run the optimized cache SQL update
 * This runs the COMPLETE-DATABASE-UPDATE.sql via Node.js
 */

const fs = require('fs');
const path = require('path');
const pool = require('./config/database');

async function runDatabaseUpdate() {
    console.log('🚀 RUNNING OPTIMIZED CACHE DATABASE UPDATE');
    console.log('==========================================\n');
    
    const client = await pool.connect();
    
    try {
        // Read the SQL file
        const sqlFile = path.join(__dirname, 'database', 'COMPLETE-DATABASE-UPDATE.sql');
        console.log(`📖 Reading SQL file: ${sqlFile}`);
        
        const sql = fs.readFileSync(sqlFile, 'utf8');
        console.log(`✅ SQL file loaded (${sql.length} characters)`);
        
        // Split into individual statements (basic splitting on semicolons)
        const statements = sql
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--') && !stmt.startsWith('\\echo'));
        
        console.log(`🔧 Executing ${statements.length} SQL statements...\n`);
        
        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            
            // Skip comments and empty statements
            if (statement.startsWith('/*') || statement.length < 10) {
                continue;
            }
            
            try {
                console.log(`📝 Executing statement ${i + 1}/${statements.length}...`);
                await client.query(statement);
                console.log(`✅ Statement ${i + 1} completed successfully`);
            } catch (error) {
                if (error.message.includes('already exists') || 
                    error.message.includes('does not exist') ||
                    error.message.includes('duplicate key')) {
                    console.log(`⚠️ Statement ${i + 1} - Expected warning: ${error.message}`);
                } else {
                    console.error(`❌ Statement ${i + 1} failed: ${error.message}`);
                    // Continue with other statements
                }
            }
        }
        
        console.log('\n🎉 DATABASE UPDATE COMPLETED!');
        console.log('==============================');
        
        // Test if tables were created
        console.log('\n🔍 Verifying table creation...');
        
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name IN ('contact_hashes', 'contact_search_history') 
            AND table_schema = 'public'
        `);
        
        console.log(`✅ Found ${tablesResult.rows.length} optimized cache tables:`);
        tablesResult.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });
        
        // Test functions
        console.log('\n🔍 Testing hash function...');
        const hashTest = await client.query(`SELECT hash_contact_input('test@example.com') as test_hash`);
        console.log(`✅ Hash function working: ${hashTest.rows[0].test_hash.substring(0, 16)}...`);
        
        // Get sample analytics
        console.log('\n📊 Current cache analytics:');
        const analytics = await client.query('SELECT * FROM optimized_cache_analytics');
        if (analytics.rows.length > 0) {
            const stats = analytics.rows[0];
            console.log(`   Warm cache contacts: ${stats.warm_cache_contacts}`);
            console.log(`   Total credits saved: ${stats.total_credits_saved}`);
            console.log(`   Estimated money saved: $${stats.estimated_money_saved}`);
        }
        
        console.log('\n🚀 SUCCESS! Your optimized cache system is now active!');
        console.log('🔬 Run: node tests/test-optimized-cache.js to test it');
        
    } catch (error) {
        console.error('❌ Database update failed:', error.message);
        console.error('Full error:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the update
runDatabaseUpdate();
