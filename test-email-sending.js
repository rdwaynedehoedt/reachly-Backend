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

async function testEmailSending() {
  const client = await pool.connect();
  
  try {
    console.log('📧 Testing Email Sending System\n');
    console.log('===============================\n');
    
    // Step 1: Find the test campaign
    console.log('🔍 Step 1: Finding test campaign...');
    const campaignResult = await client.query(`
      SELECT c.*, t.subject, t.body_html, t.body_text
      FROM campaigns c
      LEFT JOIN campaign_templates t ON c.id = t.campaign_id AND t.is_active = true
      WHERE c.name = 'Test Campaign' AND c.status = 'draft'
      ORDER BY c.created_at DESC
      LIMIT 1
    `);
    
    if (campaignResult.rows.length === 0) {
      console.log('❌ No test campaign found. Run test-campaign-system.js first.');
      return;
    }
    
    const campaign = campaignResult.rows[0];
    console.log(`✅ Found campaign: ${campaign.name} (${campaign.id})`);
    
    // Step 2: Get campaign leads
    console.log('\n🔍 Step 2: Getting campaign leads...');
    const leadsResult = await client.query(`
      SELECT cl.*, l.email, l.first_name, l.last_name, l.company_name
      FROM campaign_leads cl
      JOIN leads l ON cl.lead_id = l.id
      WHERE cl.campaign_id = $1 AND cl.status = 'pending'
    `, [campaign.id]);
    
    console.log(`✅ Found ${leadsResult.rows.length} pending leads`);
    leadsResult.rows.forEach((lead, index) => {
      console.log(`  ${index + 1}. ${lead.email} (${lead.first_name} ${lead.last_name})`);
    });
    
    // Step 3: Get email account for sending
    console.log('\n🔍 Step 3: Getting email account...');
    const emailAccountResult = await client.query(`
      SELECT * FROM email_accounts 
      WHERE email = $1 AND status = 'active'
      LIMIT 1
    `, [campaign.from_email]);
    
    if (emailAccountResult.rows.length === 0) {
      console.log(`❌ No active email account found for ${campaign.from_email}`);
      return;
    }
    
    const emailAccount = emailAccountResult.rows[0];
    console.log(`✅ Found email account: ${emailAccount.email}`);
    
    // Step 4: Personalize and send emails
    console.log('\n📧 Step 4: Sending personalized emails...');
    
    for (const lead of leadsResult.rows) {
      try {
        console.log(`\n📮 Sending email to ${lead.email}...`);
        
        // Personalize email content
        const personalizedSubject = personalizeContent(campaign.subject, {
          firstName: lead.first_name,
          lastName: lead.last_name,
          company: lead.company_name || '',
          email: lead.email,
          fromName: campaign.from_name
        });
        
        const personalizedBodyHtml = personalizeContent(campaign.body_html, {
          firstName: lead.first_name,
          lastName: lead.last_name,
          company: lead.company_name || '',
          email: lead.email,
          fromName: campaign.from_name
        });
        
        const personalizedBodyText = personalizeContent(campaign.body_text, {
          firstName: lead.first_name,
          lastName: lead.last_name,
          company: lead.company_name || '',
          email: lead.email,
          fromName: campaign.from_name
        });
        
        console.log(`  📝 Subject: "${personalizedSubject}"`);
        console.log(`  👤 To: ${lead.email}`);
        console.log(`  📄 Body: ${personalizedBodyText.substring(0, 100)}...`);
        
        // Decrypt tokens (simplified - in production this should use proper decryption)
        let tokens;
        try {
          // For testing, we'll assume tokens are in a readable format
          // In production, you'd decrypt using the encryption service
          tokens = JSON.parse(emailAccount.encrypted_tokens);
        } catch (e) {
          console.log('  ⚠️ Note: Tokens are encrypted, using mock tokens for testing');
          tokens = { access_token: 'encrypted_access_token' };
        }
        
        // Send email using Gmail service
        const sendResult = await gmailService.sendEmail({
          accessToken: tokens.access_token,
          to: lead.email,
          subject: personalizedSubject,
          htmlContent: personalizedBodyHtml,
          textContent: personalizedBodyText,
          fromName: campaign.from_name,
          fromEmail: campaign.from_email,
          replyTo: campaign.reply_to_email
        });
        
        if (sendResult.success) {
          console.log(`  ✅ Email sent successfully!`);
          console.log(`  📧 Message ID: ${sendResult.messageId}`);
          
          // Update campaign lead status
          await client.query(`
            UPDATE campaign_leads 
            SET status = 'sent', sent_at = NOW()
            WHERE id = $1
          `, [lead.id]);
          
          // Record in email_sends table
          await client.query(`
            INSERT INTO email_sends (
              id, user_id, email_account_id, recipient_email, subject,
              message_id, thread_id, status, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          `, [
            uuidv4(),
            emailAccount.user_id,
            emailAccount.id,
            lead.email,
            personalizedSubject,
            sendResult.messageId || 'test_message_id',
            sendResult.threadId || 'test_thread_id',
            'sent'
          ]);
          
        } else {
          console.log(`  ❌ Email failed to send: ${sendResult.error}`);
          
          // Update status to failed
          await client.query(`
            UPDATE campaign_leads 
            SET status = 'failed', error_message = $1
            WHERE id = $2
          `, [sendResult.error, lead.id]);
        }
        
        // Small delay between emails
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`  ❌ Error sending to ${lead.email}: ${error.message}`);
        
        // Update status to failed
        await client.query(`
          UPDATE campaign_leads 
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `, [error.message, lead.id]);
      }
    }
    
    // Step 5: Update campaign statistics
    console.log('\n📊 Step 5: Updating campaign statistics...');
    
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_leads,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as emails_sent,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as emails_failed
      FROM campaign_leads
      WHERE campaign_id = $1
    `, [campaign.id]);
    
    const stats = statsResult.rows[0];
    
    await client.query(`
      UPDATE campaigns 
      SET 
        total_leads = $1,
        emails_sent = $2,
        status = CASE 
          WHEN $2 > 0 THEN 'active'
          ELSE status 
        END,
        updated_at = NOW()
      WHERE id = $3
    `, [stats.total_leads, stats.emails_sent, campaign.id]);
    
    console.log(`✅ Campaign statistics updated:`);
    console.log(`  📊 Total leads: ${stats.total_leads}`);
    console.log(`  📧 Emails sent: ${stats.emails_sent}`);
    console.log(`  ❌ Failed: ${stats.emails_failed}`);
    
    // Step 6: Final summary
    console.log('\n🎉 Email Sending Test Complete!');
    console.log('================================');
    console.log(`📬 Campaign: ${campaign.name}`);
    console.log(`📧 From: ${campaign.from_name} <${campaign.from_email}>`);
    console.log(`✅ Emails sent: ${stats.emails_sent}/${stats.total_leads}`);
    
    if (parseInt(stats.emails_sent) > 0) {
      console.log('\n✉️ Please check the following email addresses:');
      console.log('  📧 dwaynedehoedt@gmail.com');
      console.log('  📧 dwaynedehoedt.rosch@gmail.com');
      console.log('\n🔍 Look for emails with subject: "Test"');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Helper function to personalize email content
 */
function personalizeContent(content, data) {
  if (!content) return content;

  let personalizedContent = content;

  const replacements = {
    '{{firstName}}': data.firstName || '',
    '{{lastName}}': data.lastName || '',
    '{{fullName}}': `${data.firstName || ''} ${data.lastName || ''}`.trim(),
    '{{email}}': data.email || '',
    '{{company}}': data.company || '',
    '{{companyName}}': data.company || '',
    '{{fromName}}': data.fromName || ''
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
    personalizedContent = personalizedContent.replace(regex, value);
  }

  return personalizedContent;
}

// Run the test
if (require.main === module) {
  testEmailSending()
    .then(() => {
      console.log('\n🎊 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testEmailSending };
