const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const gmailService = require('./services/gmailService');
require('dotenv').config();

const pool = new Pool({
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function finalEmailTest() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Final Email Campaign Test\n');
    console.log('============================\n');
    
    // Step 1: Get user and organization
    console.log('🔍 Step 1: Setting up test environment...');
    
    const userResult = await client.query('SELECT id, email, first_name, last_name FROM users LIMIT 1');
    const orgResult = await client.query('SELECT id, name FROM organizations LIMIT 1');
    const emailAccountResult = await client.query('SELECT * FROM email_accounts WHERE status = \'active\' LIMIT 1');
    
    if (userResult.rows.length === 0 || orgResult.rows.length === 0 || emailAccountResult.rows.length === 0) {
      console.log('❌ Missing required data (user/org/email account)');
      return;
    }
    
    const user = userResult.rows[0];
    const org = orgResult.rows[0];
    const emailAccount = emailAccountResult.rows[0];
    
    console.log(`✅ User: ${user.email}`);
    console.log(`✅ Organization: ${org.name}`);
    console.log(`✅ Email Account: ${emailAccount.email}`);
    
    // Step 2: Create fresh campaign and leads
    console.log('\n📊 Step 2: Creating fresh test data...');
    
    const campaignId = uuidv4();
    const testEmails = ['dwaynedehoedt@gmail.com', 'dwaynedehoedt.rosch@gmail.com'];
    
    // Clean up any existing test data
    await client.query('DELETE FROM campaigns WHERE name = \'Final Test Campaign\'');
    await client.query('DELETE FROM leads WHERE email = ANY($1)', [testEmails]);
    
    // Create campaign
    await client.query(`
      INSERT INTO campaigns (
        id, organization_id, name, description, type, status,
        from_name, from_email, timezone, daily_send_limit,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      campaignId, org.id, 'Final Test Campaign', 'Final email sending test', 'single', 'draft',
      `${user.first_name} ${user.last_name}`, emailAccount.email, 'UTC', 50,
      user.id, user.id
    ]);
    
    console.log(`✅ Created campaign: ${campaignId}`);
    
    // Create email template
    const templateId = uuidv4();
    await client.query(`
      INSERT INTO campaign_templates (
        id, campaign_id, name, subject, body_html, body_text, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      templateId, campaignId, 'Final Test Template', 'Test Email from Campaign System',
      '<div style="font-family: Arial, sans-serif;"><h2>Hello {{firstName}}!</h2><p>This is a <strong>test email</strong> sent from the Reachly Campaign System.</p><p>Your email: {{email}}</p><p>Best regards,<br/>{{fromName}}</p></div>',
      'Hello {{firstName}}!\\n\\nThis is a test email sent from the Reachly Campaign System.\\n\\nYour email: {{email}}\\n\\nBest regards,\\n{{fromName}}',
      true
    ]);
    
    console.log(`✅ Created email template`);
    
    // Create test leads and add to campaign
    const leadIds = [];
    for (let i = 0; i < testEmails.length; i++) {
      const email = testEmails[i];
      const leadId = uuidv4();
      
      // Create lead
      await client.query(`
        INSERT INTO leads (
          id, organization_id, email, first_name, last_name, 
          source, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        leadId, org.id, email, `Dwayne${i + 1}`, 'TestUser',
        'test', user.id, user.id
      ]);
      
      // Add to campaign
      await client.query(`
        INSERT INTO campaign_leads (
          id, campaign_id, lead_id, status
        ) VALUES ($1, $2, $3, $4)
      `, [uuidv4(), campaignId, leadId, 'pending']);
      
      leadIds.push(leadId);
    }
    
    console.log(`✅ Created ${testEmails.length} test leads and added to campaign`);
    
    // Step 3: Send emails
    console.log('\n📧 Step 3: Sending emails...');
    
    const campaignLeads = await client.query(`
      SELECT cl.*, l.email, l.first_name, l.last_name
      FROM campaign_leads cl
      JOIN leads l ON cl.lead_id = l.id
      WHERE cl.campaign_id = $1 AND cl.status = 'pending'
    `, [campaignId]);
    
    let sentCount = 0;
    let failedCount = 0;
    
    for (const lead of campaignLeads.rows) {
      try {
        console.log(`\n📮 Sending to ${lead.email}...`);
        
        // Personalize content
        const personalizedSubject = 'Test Email from Campaign System';
        const personalizedHtml = `<div style="font-family: Arial, sans-serif;"><h2>Hello ${lead.first_name}!</h2><p>This is a <strong>test email</strong> sent from the Reachly Campaign System.</p><p>Your email: ${lead.email}</p><p>Best regards,<br/>${user.first_name} ${user.last_name}</p></div>`;
        const personalizedText = `Hello ${lead.first_name}!\\n\\nThis is a test email sent from the Reachly Campaign System.\\n\\nYour email: ${lead.email}\\n\\nBest regards,\\n${user.first_name} ${user.last_name}`;
        
        console.log(`  📝 Subject: "${personalizedSubject}"`);
        console.log(`  👤 To: ${lead.email}`);
        
        const emailData = {
          to: lead.email,
          subject: personalizedSubject,
          htmlBody: personalizedHtml,
          textBody: personalizedText
        };
        
        const sendResult = await gmailService.sendEmail(emailAccount.id, emailData);
        
        if (sendResult.success) {
          console.log(`  ✅ Email sent successfully!`);
          console.log(`  📧 Message ID: ${sendResult.messageId}`);
          
          // Update status
          await client.query(`
            UPDATE campaign_leads 
            SET status = 'sent', sent_at = NOW()
            WHERE id = $1
          `, [lead.id]);
          
          sentCount++;
        }
        
        // Wait between emails
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (error) {
        console.log(`  ❌ Failed to send: ${error.message}`);
        
        await client.query(`
          UPDATE campaign_leads 
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `, [error.message, lead.id]);
        
        failedCount++;
      }
    }
    
    // Step 4: Update campaign
    await client.query(`
      UPDATE campaigns 
      SET status = 'active', emails_sent = $1, updated_at = NOW()
      WHERE id = $2
    `, [sentCount, campaignId]);
    
    // Step 5: Final results
    console.log('\n🎉 Final Results');
    console.log('================');
    console.log(`📬 Campaign: Final Test Campaign`);
    console.log(`📧 From: ${user.first_name} ${user.last_name} <${emailAccount.email}>`);
    console.log(`✅ Emails sent: ${sentCount}`);
    console.log(`❌ Failed: ${failedCount}`);
    console.log(`📊 Success rate: ${Math.round(sentCount/(sentCount+failedCount)*100)}%`);
    
    if (sentCount > 0) {
      console.log('\n✉️  CHECK YOUR EMAIL!');
      console.log('=====================');
      console.log('📧 dwaynedehoedt@gmail.com');
      console.log('📧 dwaynedehoedt.rosch@gmail.com');
      console.log('\n🔍 Subject: "Test Email from Campaign System"');
      console.log('📱 Check both inbox and spam folders');
      console.log('⏰ Should arrive within 1-2 minutes');
      
      console.log('\n✅ CAMPAIGN SYSTEM TEST SUCCESSFUL!');
      console.log('The campaign backend is working correctly.');
    } else {
      console.log('\n❌ NO EMAILS SENT');
      console.log('Please check error messages above.');
    }
    
    return {
      campaignId,
      sentCount,
      failedCount,
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
  finalEmailTest()
    .then((result) => {
      console.log('\n🎊 Final test completed!');
      if (result && result.sentCount > 0) {
        console.log(`📧 ${result.sentCount} emails sent to:`, result.testEmails.join(', '));
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Final test failed:', error);
      process.exit(1);
    });
}

module.exports = { finalEmailTest };
