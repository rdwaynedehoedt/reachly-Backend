const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  const client = await pool.connect();
  try {
    console.log('📊 Checking email_accounts table structure...\n');
    
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'email_accounts'
      ORDER BY ordinal_position
    `);
    
    console.log('📧 email_accounts columns:');
    result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    
    // Check actual data
    const data = await client.query('SELECT * FROM email_accounts LIMIT 2');
    console.log(`\n📋 Sample data (${data.rows.length} records):`);
    data.rows.forEach((row, index) => {
      console.log(`${index + 1}. Keys: ${Object.keys(row).join(', ')}`);
    });
    
    if (data.rows.length > 0) {
      console.log('\nFirst record:', data.rows[0]);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema();
