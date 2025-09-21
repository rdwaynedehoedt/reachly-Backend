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

async function resetLeadStatus() {
  const client = await pool.connect();
  try {
    console.log('🔄 Resetting lead status...');
    
    const result = await client.query(`
      UPDATE campaign_leads 
      SET status = 'pending', sent_at = NULL, error_message = NULL
      WHERE campaign_id IN (
        SELECT id FROM campaigns WHERE name = 'Test Campaign'
      )
    `);
    
    console.log(`✅ Reset ${result.rowCount} leads to pending status`);
    
    // Show current status
    const statusResult = await client.query(`
      SELECT cl.status, COUNT(*) as count
      FROM campaign_leads cl
      JOIN campaigns c ON cl.campaign_id = c.id
      WHERE c.name = 'Test Campaign'
      GROUP BY cl.status
    `);
    
    console.log('\n📊 Current lead status:');
    statusResult.rows.forEach(row => {
      console.log(`  ${row.status}: ${row.count}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

resetLeadStatus();
