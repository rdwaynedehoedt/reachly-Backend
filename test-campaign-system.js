const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = new Pool({
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function runCampaignTest() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Starting Campaign System Test\n');
    console.log('================================\n');
    
    // Step 1: Check existing data
    console.log('📊 Step 1: Checking existing data...');
    
    const users = await client.query('SELECT id, email, first_name, last_name FROM users LIMIT 5');
    console.log(`👤 Users found: ${users.rows.length}`);
    users.rows.forEach(user => console.log(`  - ${user.email} (${user.first_name} ${user.last_name})`));
    
    const orgs = await client.query('SELECT id, name FROM organizations LIMIT 5');
    console.log(`\n🏢 Organizations found: ${orgs.rows.length}`);
    orgs.rows.forEach(org => console.log(`  - ${org.name}`));
    
    const emailAccounts = await client.query('SELECT id, email, user_id, status FROM email_accounts WHERE status = \'active\' LIMIT 5');
    console.log(`\n📧 Active Email Accounts found: ${emailAccounts.rows.length}`);
    emailAccounts.rows.forEach(email => console.log(`  - ${email.email} (${email.status})`));
    
    const leads = await client.query('SELECT id, email, first_name, last_name, organization_id FROM leads LIMIT 10');
    console.log(`\n👥 Leads found: ${leads.rows.length}`);
    leads.rows.forEach(lead => console.log(`  - ${lead.email} (${lead.first_name || 'No'} ${lead.last_name || 'Name'})`));
    
    if (users.rows.length === 0 || orgs.rows.length === 0) {
      console.log('❌ No users or organizations found. Cannot proceed with test.');
      return;
    }
    
    // Step 2: Create test leads if they don't exist
    console.log('\n📊 Step 2: Creating/checking test leads...');
    
    const testEmails = ['dwaynedehoedt@gmail.com', 'dwaynedehoedt.rosch@gmail.com'];
    const user = users.rows[0];
    const org = orgs.rows[0];
    
    let testLeadIds = [];
    
    for (const email of testEmails) {
      // Check if lead exists
      const existingLead = await client.query(
        'SELECT id FROM leads WHERE email = $1 AND organization_id = $2',
        [email, org.id]
      );
      
      if (existingLead.rows.length > 0) {
        console.log(`✅ Lead already exists: ${email}`);
        testLeadIds.push(existingLead.rows[0].id);
      } else {
        // Create test lead
        const leadId = uuidv4();
        await client.query(`
          INSERT INTO leads (
            id, organization_id, email, first_name, last_name, 
            source, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          leadId, org.id, email, 'Test', 'Lead',
          'test', user.id, user.id
        ]);
        console.log(`✅ Created test lead: ${email}`);
        testLeadIds.push(leadId);
      }
    }
    
    // Step 3: Create test campaign
    console.log('\n📊 Step 3: Creating test campaign...');
    
    const campaignId = uuidv4();
    const fromEmail = emailAccounts.rows.length > 0 ? emailAccounts.rows[0].email : user.email;
    
    await client.query(`
      INSERT INTO campaigns (
        id, organization_id, name, description, type, status,
        from_name, from_email, timezone, daily_send_limit,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      campaignId, org.id, 'Test Campaign', 'Testing campaign system', 'single', 'draft',
      `${user.first_name} ${user.last_name}`, fromEmail, 'UTC', 50,
      user.id, user.id
    ]);
    
    console.log(`✅ Created test campaign: ${campaignId}`);
    
    // Step 4: Create email template
    console.log('\n📊 Step 4: Creating email template...');
    
    const templateId = uuidv4();
    await client.query(`
      INSERT INTO campaign_templates (
        id, campaign_id, name, subject, body_html, body_text, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      templateId, campaignId, 'Test Template', 'Test', 
      '<p>Hello {{firstName}},</p><p>This is a test email from the campaign system.</p><p>Best regards,<br/>{{fromName}}</p>',
      'Hello {{firstName}},\\n\\nThis is a test email from the campaign system.\\n\\nBest regards,\\n{{fromName}}',
      true
    ]);
    
    console.log(`✅ Created email template with subject: "Test"`);
    
    // Step 5: Add leads to campaign
    console.log('\n📊 Step 5: Adding leads to campaign...');
    
    for (const leadId of testLeadIds) {
      await client.query(`
        INSERT INTO campaign_leads (
          id, campaign_id, lead_id, status, custom_variables
        ) VALUES ($1, $2, $3, $4, $5)
      `, [uuidv4(), campaignId, leadId, 'pending', '{}']);
    }
    
    console.log(`✅ Added ${testLeadIds.length} leads to campaign`);
    
    // Step 6: Update campaign counts
    await client.query(`
      UPDATE campaigns 
      SET total_leads = (SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1)
      WHERE id = $1
    `, [campaignId]);
    
    // Step 7: Show test summary
    console.log('\n📊 Step 6: Test Campaign Summary');
    console.log('================================');
    
    const campaignDetails = await client.query(`
      SELECT c.*, COUNT(cl.id) as lead_count
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
      WHERE c.id = $1
      GROUP BY c.id
    `, [campaignId]);
    
    const campaign = campaignDetails.rows[0];
    console.log(`📬 Campaign: ${campaign.name}`);
    console.log(`📧 From: ${campaign.from_name} <${campaign.from_email}>`);
    console.log(`👥 Leads: ${campaign.lead_count}`);
    console.log(`📊 Status: ${campaign.status}`);
    console.log(`🆔 Campaign ID: ${campaignId}`);
    
    const campaignLeads = await client.query(`
      SELECT cl.*, l.email, l.first_name, l.last_name
      FROM campaign_leads cl
      JOIN leads l ON cl.lead_id = l.id
      WHERE cl.campaign_id = $1
    `, [campaignId]);
    
    console.log('\n👥 Campaign Leads:');
    campaignLeads.rows.forEach((lead, index) => {
      console.log(`  ${index + 1}. ${lead.email} (${lead.first_name} ${lead.last_name}) - Status: ${lead.status}`);
    });
    
    const template = await client.query(`
      SELECT * FROM campaign_templates WHERE campaign_id = $1 AND is_active = true
    `, [campaignId]);
    
    if (template.rows.length > 0) {
      console.log('\n📝 Email Template:');
      console.log(`  Subject: ${template.rows[0].subject}`);
      console.log(`  Body: ${template.rows[0].body_text.substring(0, 100)}...`);
    }
    
    console.log('\n🎯 Next Steps:');
    console.log('==============');
    console.log('1. Test the Campaign API endpoints');
    console.log('2. Activate the campaign');
    console.log('3. Send test emails');
    console.log('4. Check email delivery');
    
    console.log('\n✅ Test setup complete!');
    console.log('\n🧪 You can now test the API with:');
    console.log(`   Campaign ID: ${campaignId}`);
    console.log(`   Test emails: ${testEmails.join(', ')}`);
    
    return {
      campaignId,
      testLeadIds,
      fromEmail,
      testEmails
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the test
if (require.main === module) {
  runCampaignTest()
    .then((result) => {
      console.log('\n🎉 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { runCampaignTest };
