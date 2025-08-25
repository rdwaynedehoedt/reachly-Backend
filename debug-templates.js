const pool = require('./config/database');

async function debugTemplates() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Debugging Campaign Templates...\n');
    
    // 0. First check if there are any campaigns at all
    const allCampaignsResult = await client.query('SELECT COUNT(*) as count FROM campaigns');
    console.log(`📊 Total campaigns in database: ${allCampaignsResult.rows[0].count}`);
    
    const allTemplatesResult = await client.query('SELECT COUNT(*) as count FROM campaign_templates');
    console.log(`📊 Total templates in database: ${allTemplatesResult.rows[0].count}\n`);
    
    // 1. Check all campaigns and their templates
    const campaignsResult = await client.query(`
      SELECT 
        c.id,
        c.name,
        c.status,
        c.from_email,
        COUNT(ct.id) as template_count
      FROM campaigns c
      LEFT JOIN campaign_templates ct ON c.id = ct.campaign_id
      GROUP BY c.id, c.name, c.status, c.from_email
      ORDER BY c.created_at DESC
      LIMIT 5
    `);
    
    console.log('📊 Recent Campaigns:');
    if (campaignsResult.rows.length === 0) {
      console.log('❌ No campaigns found in database\n');
      return;
    }
    
    for (const campaign of campaignsResult.rows) {
      console.log(`- ${campaign.name} (${campaign.status}) - ${campaign.template_count} templates`);
      
      // Get template details for this campaign
      const templatesResult = await client.query(`
        SELECT id, subject, body_html, body_text, is_active, created_at
        FROM campaign_templates
        WHERE campaign_id = $1
        ORDER BY created_at DESC
      `, [campaign.id]);
      
      if (templatesResult.rows.length > 0) {
        templatesResult.rows.forEach((template, index) => {
          console.log(`  Template ${index + 1}:`);
          console.log(`    ID: ${template.id}`);
          console.log(`    Subject: "${template.subject || 'NO SUBJECT'}"`);
          console.log(`    HTML Body: ${template.body_html ? template.body_html.length + ' chars' : 'NONE'}`);
          console.log(`    Text Body: ${template.body_text ? template.body_text.length + ' chars' : 'NONE'}`);
          console.log(`    Active: ${template.is_active}`);
          console.log(`    Created: ${template.created_at}`);
          
          if (template.body_html) {
            console.log(`    HTML Preview: "${template.body_html.substring(0, 100)}..."`);
          }
        });
      } else {
        console.log('    ❌ NO TEMPLATES FOUND');
      }
      console.log('');
    }
    
    // 2. Test the campaign launch query
    if (campaignsResult.rows.length > 0) {
      const testCampaignId = campaignsResult.rows[0].id;
      console.log(`🧪 Testing campaign launch query for: ${campaignsResult.rows[0].name}`);
      
      const launchQueryResult = await client.query(`
        SELECT c.*, ct.subject, ct.body_html, ct.body_text
        FROM campaigns c
        LEFT JOIN campaign_templates ct ON c.id = ct.campaign_id AND ct.is_active = true
        WHERE c.id = $1
      `, [testCampaignId]);
      
      if (launchQueryResult.rows.length > 0) {
        const campaign = launchQueryResult.rows[0];
        console.log('📋 Launch Query Result:');
        console.log(`  Campaign Name: ${campaign.name}`);
        console.log(`  Subject from Template: "${campaign.subject || 'NULL'}"`);
        console.log(`  HTML Body: ${campaign.body_html ? campaign.body_html.length + ' chars' : 'NULL'}`);
        console.log(`  Text Body: ${campaign.body_text ? campaign.body_text.length + ' chars' : 'NULL'}`);
        
        if (campaign.body_html) {
          console.log(`  HTML Preview: "${campaign.body_html.substring(0, 100)}..."`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error);
  } finally {
    client.release();
  }
}

// Run the debug
debugTemplates()
  .then(() => {
    console.log('\n✅ Debug complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Debug failed:', error);
    process.exit(1);
  });
