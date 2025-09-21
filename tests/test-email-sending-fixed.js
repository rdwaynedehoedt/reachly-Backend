const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const GmailService = require('./services/gmailService');
require('dotenv').config();

const pool = new Pool({
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function testEmailSendingFixed() {
  const client = await pool.connect();
  
  try {
    console.log('📧 Testing Email Sending System (Fixed)\n');
    console.log('======================================\n');
    
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
    
    // Step 4: Initialize Gmail service
    console.log('\n📧 Step 4: Initializing Gmail service...');
    const gmailService = require('./services/gmailService');
    
    // Step 5: Send emails using proper Gmail service
    console.log('\n📧 Step 5: Sending personalized emails...');
    
    let sentCount = 0;
    let failedCount = 0;
    
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
        console.log(`  📄 Preview: ${personalizedBodyText.substring(0, 80)}...`);
        
        // Send email using the existing Gmail service method
        const emailData = {
          to: lead.email,
          subject: personalizedSubject,
          htmlBody: personalizedBodyHtml,
          textBody: personalizedBodyText
        };
        
        const sendResult = await gmailService.sendEmail(emailAccount.id, emailData);
        
        if (sendResult.success) {
          console.log(`  ✅ Email sent successfully!`);
          console.log(`  📧 Message ID: ${sendResult.messageId}`);
          
          // Update campaign lead status
          await client.query(`
            UPDATE campaign_leads 
            SET status = 'sent', sent_at = NOW()
            WHERE id = $1
          `, [lead.id]);
          
          sentCount++;
          
        } else {
          console.log(`  ❌ Email failed to send: ${sendResult.error}`);
          
          // Update status to failed
          await client.query(`
            UPDATE campaign_leads 
            SET status = 'failed', error_message = $1
            WHERE id = $2
          `, [sendResult.error, lead.id]);
          
          failedCount++;
        }
        
        // Small delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.log(`  ❌ Error sending to ${lead.email}: ${error.message}`);
        
        // Update status to failed
        await client.query(`
          UPDATE campaign_leads 
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `, [error.message, lead.id]);
        
        failedCount++;
      }
    }
    
    // Step 6: Update campaign statistics
    console.log('\n📊 Step 6: Updating campaign statistics...');
    
    await client.query(`
      UPDATE campaigns 
      SET 
        emails_sent = emails_sent + $1,
        status = CASE 
          WHEN $1 > 0 THEN 'active'
          ELSE status 
        END,
        updated_at = NOW()
      WHERE id = $2
    `, [sentCount, campaign.id]);
    
    console.log(`✅ Campaign statistics updated:`);
    console.log(`  📊 Total leads: ${leadsResult.rows.length}`);
    console.log(`  📧 Emails sent: ${sentCount}`);
    console.log(`  ❌ Failed: ${failedCount}`);
    
    // Step 7: Final summary
    console.log('\n🎉 Email Sending Test Complete!');
    console.log('================================');
    console.log(`📬 Campaign: ${campaign.name}`);
    console.log(`📧 From: ${campaign.from_name} <${campaign.from_email}>`);
    console.log(`✅ Success rate: ${sentCount}/${leadsResult.rows.length} (${Math.round(sentCount/leadsResult.rows.length*100)}%)`);
    
    if (sentCount > 0) {
      console.log('\n✉️  EMAIL CHECK INSTRUCTIONS:');
      console.log('==============================');
      console.log('Please check the following email addresses:');
      console.log('  📧 dwaynedehoedt@gmail.com');
      console.log('  📧 dwaynedehoedt.rosch@gmail.com');
      console.log('\n🔍 Look for emails with subject: "Test"');
      console.log('📱 Check both inbox and spam folders');
      console.log('⏰ Emails should arrive within 1-2 minutes');
      
      console.log('\n📋 Email Content Preview:');
      console.log('========================');
      console.log('Subject: Test');
      console.log('Body:');
      console.log(personalizeContent(campaign.body_text, {
        firstName: 'Test',
        fromName: campaign.from_name
      }));
    } else {
      console.log('\n❌ No emails were sent successfully');
      console.log('Please check the error messages above');
    }
    
    return {
      campaignId: campaign.id,
      sentCount,
      failedCount,
      totalLeads: leadsResult.rows.length
    };
    
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
  testEmailSendingFixed()
    .then((result) => {
      console.log('\n🎊 Test completed successfully!');
      if (result && result.sentCount > 0) {
        console.log(`📧 ${result.sentCount} emails sent - please check your inboxes!`);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testEmailSendingFixed };
