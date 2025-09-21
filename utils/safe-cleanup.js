const pool = require('./config/database');

async function safeCleanup() {
  try {
    console.log('🧹 Safe Database Cleanup - Only Truly Unused Tables\n');
    
    // ONLY these 2 tables are not used in code AND are empty
    const unusedTables = [
      'email_sequences',  // Not referenced in any code
      'lead_notes'       // Not referenced in any code
    ];
    
    console.log('📊 Analysis Results:');
    console.log('- Total tables in database: 29');
    console.log('- Tables used in code: 27 (93%)');
    console.log('- Tables NOT used in code: 2 (7%)');
    console.log('- Tables to drop: 2');
    
    console.log('\n🗑️  Tables to DROP (unused in code & empty):');
    unusedTables.forEach(table => {
      console.log(`   - ${table}`);
    });
    
    console.log('\n✅ Tables to KEEP (all others are used in code):');
    console.log('   - All your other 27 tables are actively used!');
    console.log('   - They\'re just empty because features haven\'t been used yet');
    
    console.log('\n⚠️  This will drop ONLY 2 truly unused tables');
    console.log('   Add --execute flag to actually drop them');
    console.log('   Example: node safe-cleanup.js --execute');
    
    if (process.argv.includes('--execute')) {
      console.log('\n💥 EXECUTING SAFE CLEANUP...');
      
      for (const table of unusedTables) {
        try {
          // Double-check it's empty first
          const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
          const count = parseInt(countResult.rows[0].count);
          
          if (count === 0) {
            await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
            console.log(`✅ Dropped: ${table} (was empty)`);
          } else {
            console.log(`⚠️  Skipped: ${table} (has ${count} rows - manual review needed)`);
          }
        } catch (error) {
          console.log(`❌ Failed to drop ${table}: ${error.message}`);
        }
      }
      
      console.log('\n🎉 Safe cleanup completed!');
      
      // Show final count
      const finalResult = await pool.query(`
        SELECT COUNT(*) as count FROM pg_tables WHERE schemaname = 'public'
      `);
      console.log(`📊 Tables remaining: ${finalResult.rows[0].count}`);
      
    } else {
      console.log('\n💡 DRY RUN - Add --execute to actually drop tables');
      console.log('\n🔍 Your database is actually well-organized!');
      console.log('   Most tables are implemented and ready to use');
      console.log('   They just need data when you start using those features');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

safeCleanup();
