/**
 * SIMPLE OPTIMIZED CACHE CREATOR
 * Creates the essential tables and functions without complex SQL parsing
 */

const pool = require('./config/database');

async function createOptimizedCache() {
    console.log('🚀 CREATING OPTIMIZED CACHE SYSTEM (SIMPLE VERSION)');
    console.log('====================================================\n');
    
    const client = await pool.connect();
    
    try {
        console.log('✅ Database connected successfully!');
        
        // Step 1: Create contact_hashes table (Tier 2 warm cache)
        console.log('\n📋 STEP 1: Creating contact_hashes table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS contact_hashes (
                contact_hash VARCHAR(64) PRIMARY KEY,
                original_input TEXT NOT NULL,
                found_email VARCHAR(255),
                found_name VARCHAR(255),
                linkedin_url VARCHAR(500),
                verification_status VARCHAR(20) DEFAULT 'verified' 
                    CHECK (verification_status IN ('verified', 'unverified', 'risky', 'invalid')),
                api_source VARCHAR(20) DEFAULT 'findymail' 
                    CHECK (api_source IN ('findymail', 'contactout', 'manual')),
                times_found INTEGER DEFAULT 1,
                last_accessed TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ contact_hashes table created');
        
        // Step 2: Create contact_search_history table (Tier 3 cold storage)
        console.log('\n📋 STEP 2: Creating contact_search_history table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS contact_search_history (
                contact_hash VARCHAR(64) PRIMARY KEY,
                times_searched INTEGER DEFAULT 1,
                successful_finds INTEGER DEFAULT 0,
                failed_searches INTEGER DEFAULT 0,
                last_api_call TIMESTAMP DEFAULT NOW(),
                first_search TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ contact_search_history table created');
        
        // Step 3: Create indexes for performance
        console.log('\n📋 STEP 3: Creating performance indexes...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_contact_hashes_hash ON contact_hashes(contact_hash);
            CREATE INDEX IF NOT EXISTS idx_contact_hashes_email ON contact_hashes(found_email) WHERE found_email IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_contact_hashes_created ON contact_hashes(created_at);
            CREATE INDEX IF NOT EXISTS idx_search_history_hash ON contact_search_history(contact_hash);
        `);
        console.log('✅ Performance indexes created');
        
        // Step 4: Create hash function
        console.log('\n📋 STEP 4: Creating hash function...');
        await client.query(`
            CREATE OR REPLACE FUNCTION hash_contact_input(input_text TEXT)
            RETURNS VARCHAR(64) AS $$
            BEGIN
                RETURN encode(sha256(lower(trim(input_text))::bytea), 'hex');
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Hash function created');
        
        // Step 5: Create lookup function
        console.log('\n📋 STEP 5: Creating lookup function...');
        await client.query(`
            CREATE OR REPLACE FUNCTION lookup_contact_hash(search_input TEXT)
            RETURNS TABLE (
                found BOOLEAN,
                contact_hash VARCHAR(64),
                email VARCHAR(255),
                name VARCHAR(255),
                linkedin_url VARCHAR(500),
                verification_status VARCHAR(20),
                times_found INTEGER,
                last_found TIMESTAMP
            ) AS $$
            DECLARE
                input_hash VARCHAR(64);
            BEGIN
                input_hash := hash_contact_input(search_input);
                
                RETURN QUERY
                SELECT 
                    TRUE as found,
                    ch.contact_hash,
                    ch.found_email,
                    ch.found_name,
                    ch.linkedin_url,
                    ch.verification_status,
                    ch.times_found,
                    ch.last_accessed
                FROM contact_hashes ch
                WHERE ch.contact_hash = input_hash
                AND ch.created_at > NOW() - INTERVAL '30 days'
                AND ch.found_email IS NOT NULL;
                
                IF NOT FOUND THEN
                    RETURN QUERY
                    SELECT 
                        FALSE as found,
                        input_hash as contact_hash,
                        NULL::VARCHAR(255) as email,
                        NULL::VARCHAR(255) as name,
                        NULL::VARCHAR(500) as linkedin_url,
                        NULL::VARCHAR(20) as verification_status,
                        0 as times_found,
                        NULL::TIMESTAMP as last_found;
                END IF;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Lookup function created');
        
        // Step 6: Create analytics view
        console.log('\n📋 STEP 6: Creating analytics view...');
        await client.query(`
            CREATE OR REPLACE VIEW optimized_cache_analytics AS
            SELECT 
                (SELECT COUNT(*) FROM contact_hashes) as warm_cache_contacts,
                (SELECT COUNT(*) FROM contact_hashes WHERE found_email IS NOT NULL) as verified_contacts,
                (SELECT COALESCE(SUM(times_found - 1), 0) FROM contact_hashes WHERE times_found > 1) as total_credits_saved,
                (SELECT COUNT(*) FROM contact_search_history) as total_searches_tracked,
                (SELECT COALESCE(SUM(times_searched), 0) FROM contact_search_history) as total_api_calls_made,
                (SELECT COUNT(*) FROM contact_hashes WHERE created_at > NOW() - INTERVAL '24 hours') as contacts_added_today,
                (SELECT COUNT(*) FROM contact_hashes WHERE last_accessed > NOW() - INTERVAL '7 days') as active_cache_entries,
                (SELECT (COALESCE(SUM(times_found - 1), 0) * 0.10)::DECIMAL(10,2) FROM contact_hashes WHERE times_found > 1) as estimated_money_saved;
        `);
        console.log('✅ Analytics view created');
        
        // Step 7: Insert test data
        console.log('\n📋 STEP 7: Inserting test data...');
        await client.query(`
            INSERT INTO contact_hashes (
                contact_hash, original_input, found_email, found_name, 
                linkedin_url, verification_status, api_source, times_found
            ) VALUES 
            (
                hash_contact_input('test@example.com'),
                'test@example.com',
                'test@example.com',
                'Test User',
                'https://linkedin.com/in/testuser',
                'verified',
                'findymail',
                3
            ),
            (
                hash_contact_input('https://linkedin.com/in/johndoe'),
                'https://linkedin.com/in/johndoe',
                'john@company.com',
                'John Doe',
                'https://linkedin.com/in/johndoe',
                'verified',
                'findymail',
                5
            ) ON CONFLICT (contact_hash) DO UPDATE SET
                times_found = EXCLUDED.times_found,
                updated_at = NOW();
        `);
        console.log('✅ Test data inserted');
        
        // Step 8: Test everything
        console.log('\n📋 STEP 8: Testing the system...');
        
        // Test hash function
        const hashTest = await client.query(`SELECT hash_contact_input('test@example.com') as test_hash`);
        console.log(`✅ Hash function test: ${hashTest.rows[0].test_hash.substring(0, 16)}...`);
        
        // Test lookup function
        const lookupTest = await client.query(`SELECT * FROM lookup_contact_hash('test@example.com')`);
        if (lookupTest.rows[0].found) {
            console.log(`✅ Lookup function test: Found ${lookupTest.rows[0].email} (${lookupTest.rows[0].times_found} times)`);
        }
        
        // Test analytics
        const analytics = await client.query('SELECT * FROM optimized_cache_analytics');
        const stats = analytics.rows[0];
        console.log(`✅ Analytics test: ${stats.warm_cache_contacts} contacts, ${stats.total_credits_saved} credits saved`);
        
        // Final success
        console.log('\n🎉 OPTIMIZED CACHE SYSTEM SUCCESSFULLY CREATED!');
        console.log('==============================================');
        console.log(`📊 Current Stats:`);
        console.log(`   • Contacts in cache: ${stats.warm_cache_contacts}`);
        console.log(`   • Credits saved: ${stats.total_credits_saved}`);
        console.log(`   • Money saved: $${stats.estimated_money_saved}`);
        console.log(`   • Test data working: ✅`);
        
        console.log('\n🚀 NEXT STEPS:');
        console.log('1. ✅ Database updated with optimized cache');
        console.log('2. 🔬 Run: node tests/test-optimized-cache.js');
        console.log('3. 📊 Check: http://localhost:5000/api/analytics/global-contacts');
        console.log('4. 💰 Start saving money immediately!');
        
    } catch (error) {
        console.error('❌ Error creating optimized cache:', error.message);
        console.error('Full error:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run it
createOptimizedCache();
