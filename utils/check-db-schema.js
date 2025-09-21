/**
 * Check actual database schema for email_enrichment_results table
 */

const pool = require('./config/database');

async function checkDatabaseSchema() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Checking actual database schema...\n');
        
        // Check if email_enrichment_results table exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'email_enrichment_results'
            );
        `);
        
        console.log('📊 Table exists:', tableCheck.rows[0].exists);
        
        if (tableCheck.rows[0].exists) {
            // Get all column details
            const columns = await client.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = 'email_enrichment_results'
                ORDER BY ordinal_position;
            `);
            
            console.log('\n📋 Actual columns in email_enrichment_results:');
            columns.rows.forEach((col, index) => {
                console.log(`${index + 1}. ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? '- nullable' : '- NOT NULL'}`);
            });
        }
        
        // Also check findymail_credits_usage table
        const creditsTableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'findymail_credits_usage'
            );
        `);
        
        console.log('\n📊 findymail_credits_usage table exists:', creditsTableCheck.rows[0].exists);
        
        if (creditsTableCheck.rows[0].exists) {
            const creditsColumns = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'findymail_credits_usage'
                ORDER BY ordinal_position;
            `);
            
            console.log('\n📋 Columns in findymail_credits_usage:');
            creditsColumns.rows.forEach((col, index) => {
                console.log(`${index + 1}. ${col.column_name} (${col.data_type})`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking schema:', error.message);
    } finally {
        client.release();
    }
}

checkDatabaseSchema().then(() => {
    console.log('\n✅ Schema check completed!');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Schema check failed:', error);
    process.exit(1);
});
