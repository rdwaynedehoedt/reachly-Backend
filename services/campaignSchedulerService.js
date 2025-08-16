const pool = require('../config/database');
const gmailService = require('./gmailService');
const { v4: uuidv4 } = require('uuid');

/**
 * Campaign Scheduler Service
 * Handles email scheduling, queue management, and campaign automation
 */
class CampaignSchedulerService {

    constructor() {
        this.isRunning = false;
        this.intervalId = null;
        this.processingInterval = 60000; // Check every minute
    }

    /**
     * Start the campaign scheduler
     */
    start() {
        if (this.isRunning) {
            console.log('Campaign scheduler is already running');
            return;
        }

        console.log('Starting campaign scheduler...');
        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.processEmailQueue();
        }, this.processingInterval);
        
        // Process immediately on start
        this.processEmailQueue();
    }

    /**
     * Stop the campaign scheduler
     */
    stop() {
        if (!this.isRunning) {
            console.log('Campaign scheduler is not running');
            return;
        }

        console.log('Stopping campaign scheduler...');
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Process emails in the queue that are ready to be sent
     */
    async processEmailQueue() {
        const client = await pool.connect();
        
        try {
            // Get emails that are ready to be sent
            const queueResult = await client.query(`
                SELECT 
                    eq.*,
                    c.organization_id,
                    c.from_name,
                    c.from_email,
                    c.reply_to_email,
                    c.timezone,
                    ea.encrypted_tokens,
                    ea.provider,
                    l.email as lead_email,
                    l.first_name,
                    l.last_name,
                    l.company_name,
                    l.custom_fields as lead_custom_fields,
                    cl.custom_variables as campaign_variables
                FROM email_send_queue eq
                JOIN campaigns c ON eq.campaign_id = c.id
                JOIN leads l ON eq.lead_id = l.id
                JOIN campaign_leads cl ON eq.campaign_lead_id = cl.id
                JOIN email_accounts ea ON eq.email_account_id = ea.id
                WHERE eq.status = 'pending' 
                    AND eq.scheduled_at <= NOW()
                    AND c.status = 'active'
                    AND cl.status = 'active'
                ORDER BY eq.scheduled_at ASC
                LIMIT 50
            `);

            console.log(`Found ${queueResult.rows.length} emails ready to send`);

            for (const emailData of queueResult.rows) {
                await this.sendQueuedEmail(client, emailData);
            }

            // Process campaign sequences to generate new queue items
            await this.processActiveSequences(client);

        } catch (error) {
            console.error('Error processing email queue:', error);
        } finally {
            client.release();
        }
    }

    /**
     * Send a single queued email
     */
    async sendQueuedEmail(client, emailData) {
        try {
            // Update queue status to sending
            await client.query(`
                UPDATE email_send_queue 
                SET status = 'sending', last_attempt_at = NOW(), attempts = attempts + 1
                WHERE id = $1
            `, [emailData.id]);

            // Personalize the email content
            const personalizedSubject = this.personalizeContent(emailData.subject, emailData);
            const personalizedHtmlContent = this.personalizeContent(emailData.html_content, emailData);
            const personalizedTextContent = this.personalizeContent(emailData.text_content, emailData);

            // Send the email using Gmail service
            const sendResult = await gmailService.sendEmail({
                accessToken: JSON.parse(emailData.encrypted_tokens).access_token, // Note: This should be decrypted
                to: emailData.recipient_email,
                subject: personalizedSubject,
                htmlContent: personalizedHtmlContent,
                textContent: personalizedTextContent,
                fromName: emailData.from_name,
                fromEmail: emailData.from_email,
                replyTo: emailData.reply_to_email
            });

            if (sendResult.success) {
                // Create email_sends record
                const emailSendId = uuidv4();
                await client.query(`
                    INSERT INTO email_sends (
                        id, user_id, email_account_id, recipient_email, subject,
                        message_id, thread_id, status, sent_at, campaign_id, sequence_step
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
                `, [
                    emailSendId,
                    sendResult.userId || null, // We might need to get this from the email account
                    emailData.email_account_id,
                    emailData.recipient_email,
                    personalizedSubject,
                    sendResult.messageId,
                    sendResult.threadId,
                    'sent',
                    emailData.campaign_id,
                    emailData.sequence_step || 1
                ]);

                // Update queue status to sent
                await client.query(`
                    UPDATE email_send_queue 
                    SET status = 'sent', sent_at = NOW(), email_send_id = $1
                    WHERE id = $2
                `, [emailSendId, emailData.id]);

                // Update campaign statistics
                await client.query(`
                    UPDATE campaigns 
                    SET emails_sent = emails_sent + 1
                    WHERE id = $1
                `, [emailData.campaign_id]);

                // Update sequence statistics
                await client.query(`
                    UPDATE campaign_sequences 
                    SET emails_sent = emails_sent + 1
                    WHERE campaign_id = $1 AND step_number = $2
                `, [emailData.campaign_id, emailData.sequence_step || 1]);

                // Update campaign lead's last email sent time
                await client.query(`
                    UPDATE campaign_leads 
                    SET last_email_sent_at = NOW()
                    WHERE id = $1
                `, [emailData.campaign_lead_id]);

                console.log(`Email sent successfully to ${emailData.recipient_email}`);

            } else {
                // Handle send failure
                await this.handleSendFailure(client, emailData, sendResult.error);
            }

        } catch (error) {
            console.error(`Error sending email to ${emailData.recipient_email}:`, error);
            await this.handleSendFailure(client, emailData, error.message);
        }
    }

    /**
     * Handle email send failure
     */
    async handleSendFailure(client, emailData, errorMessage) {
        const maxAttempts = emailData.max_attempts || 3;
        const currentAttempts = emailData.attempts + 1;

        if (currentAttempts >= maxAttempts) {
            // Mark as failed
            await client.query(`
                UPDATE email_send_queue 
                SET status = 'failed', error_message = $1
                WHERE id = $2
            `, [errorMessage, emailData.id]);

            console.log(`Email to ${emailData.recipient_email} failed after ${maxAttempts} attempts`);
        } else {
            // Retry later (exponential backoff)
            const retryDelay = Math.pow(2, currentAttempts) * 60 * 1000; // 2^attempts minutes
            const retryAt = new Date(Date.now() + retryDelay);

            await client.query(`
                UPDATE email_send_queue 
                SET status = 'pending', error_message = $1, scheduled_at = $2
                WHERE id = $3
            `, [errorMessage, retryAt, emailData.id]);

            console.log(`Email to ${emailData.recipient_email} will retry at ${retryAt}`);
        }
    }

    /**
     * Process active campaign sequences to generate next emails
     */
    async processActiveSequences(client) {
        try {
            // Find campaign leads that need their next sequence email
            const sequenceResult = await client.query(`
                SELECT 
                    cl.*,
                    c.id as campaign_id,
                    c.organization_id,
                    c.max_emails_per_lead,
                    cs.id as sequence_id,
                    cs.step_number,
                    cs.subject,
                    cs.html_content,
                    cs.text_content,
                    cs.delay_days,
                    cs.delay_hours,
                    cs.delay_minutes,
                    l.email as lead_email,
                    ea.id as email_account_id
                FROM campaign_leads cl
                JOIN campaigns c ON cl.campaign_id = c.id
                JOIN campaign_sequences cs ON c.id = cs.campaign_id AND cs.step_number = cl.current_step
                JOIN leads l ON cl.lead_id = l.id
                LEFT JOIN email_accounts ea ON ea.user_id = c.created_by AND ea.status = 'active'
                WHERE cl.status = 'active'
                    AND c.status = 'active'
                    AND cs.is_active = true
                    AND cl.next_send_at <= NOW()
                    AND ea.id IS NOT NULL
                ORDER BY cl.next_send_at ASC
                LIMIT 100
            `);

            console.log(`Processing ${sequenceResult.rows.length} sequence emails`);

            for (const sequence of sequenceResult.rows) {
                await this.queueSequenceEmail(client, sequence);
            }

        } catch (error) {
            console.error('Error processing active sequences:', error);
        }
    }

    /**
     * Queue an email for a sequence step
     */
    async queueSequenceEmail(client, sequence) {
        try {
            // Check if email is already queued for this step
            const existingQueue = await client.query(`
                SELECT id FROM email_send_queue
                WHERE campaign_lead_id = $1 AND sequence_id = $2 AND status IN ('pending', 'sending')
            `, [sequence.id, sequence.sequence_id]);

            if (existingQueue.rows.length > 0) {
                console.log(`Email already queued for lead ${sequence.lead_id} step ${sequence.step_number}`);
                return;
            }

            // Queue the email
            await client.query(`
                INSERT INTO email_send_queue (
                    id, campaign_id, campaign_lead_id, sequence_id, lead_id, email_account_id,
                    recipient_email, subject, html_content, text_content, scheduled_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            `, [
                uuidv4(),
                sequence.campaign_id,
                sequence.id,
                sequence.sequence_id,
                sequence.lead_id,
                sequence.email_account_id,
                sequence.lead_email,
                sequence.subject,
                sequence.html_content,
                sequence.text_content
            ]);

            // Calculate next step timing
            const nextStepResult = await client.query(`
                SELECT step_number, delay_days, delay_hours, delay_minutes
                FROM campaign_sequences
                WHERE campaign_id = $1 AND step_number = $2
            `, [sequence.campaign_id, sequence.step_number + 1]);

            if (nextStepResult.rows.length > 0) {
                const nextStep = nextStepResult.rows[0];
                const nextSendAt = new Date();
                nextSendAt.setDate(nextSendAt.getDate() + nextStep.delay_days);
                nextSendAt.setHours(nextSendAt.getHours() + nextStep.delay_hours);
                nextSendAt.setMinutes(nextSendAt.getMinutes() + nextStep.delay_minutes);

                // Update campaign lead for next step
                await client.query(`
                    UPDATE campaign_leads 
                    SET current_step = $1, next_send_at = $2
                    WHERE id = $3
                `, [sequence.step_number + 1, nextSendAt, sequence.id]);
            } else {
                // No more steps, mark as completed
                await client.query(`
                    UPDATE campaign_leads 
                    SET status = 'completed', completed_at = NOW()
                    WHERE id = $1
                `, [sequence.id]);
            }

            console.log(`Queued email for lead ${sequence.lead_id} step ${sequence.step_number}`);

        } catch (error) {
            console.error(`Error queueing sequence email for lead ${sequence.lead_id}:`, error);
        }
    }

    /**
     * Personalize email content with lead data
     */
    personalizeContent(content, emailData) {
        if (!content) return content;

        let personalizedContent = content;

        // Basic personalization fields
        const replacements = {
            '{{firstName}}': emailData.first_name || '',
            '{{lastName}}': emailData.last_name || '',
            '{{fullName}}': `${emailData.first_name || ''} ${emailData.last_name || ''}`.trim(),
            '{{email}}': emailData.lead_email || '',
            '{{company}}': emailData.company_name || '',
            '{{companyName}}': emailData.company_name || ''
        };

        // Add custom fields from lead
        if (emailData.lead_custom_fields) {
            try {
                const customFields = typeof emailData.lead_custom_fields === 'string' 
                    ? JSON.parse(emailData.lead_custom_fields) 
                    : emailData.lead_custom_fields;
                
                for (const [key, value] of Object.entries(customFields)) {
                    replacements[`{{${key}}}`] = value || '';
                }
            } catch (error) {
                console.error('Error parsing lead custom fields:', error);
            }
        }

        // Add campaign variables
        if (emailData.campaign_variables) {
            try {
                const campaignVars = typeof emailData.campaign_variables === 'string' 
                    ? JSON.parse(emailData.campaign_variables) 
                    : emailData.campaign_variables;
                
                for (const [key, value] of Object.entries(campaignVars)) {
                    replacements[`{{${key}}}`] = value || '';
                }
            } catch (error) {
                console.error('Error parsing campaign variables:', error);
            }
        }

        // Apply replacements
        for (const [placeholder, value] of Object.entries(replacements)) {
            personalizedContent = personalizedContent.replace(new RegExp(placeholder, 'g'), value);
        }

        return personalizedContent;
    }

    /**
     * Check if current time is within campaign schedule
     */
    isWithinSchedule(campaign, timezone = 'UTC') {
        const now = new Date();
        const currentDay = now.toLocaleDateString('en-US', { weekday: 'lowercase', timeZone: timezone });
        const currentTime = now.toLocaleTimeString('en-US', { 
            hour12: false, 
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit'
        });

        const scheduleDays = JSON.parse(campaign.schedule_days || '[]');
        if (!scheduleDays.includes(currentDay)) {
            return false;
        }

        const startTime = campaign.schedule_start_time || '09:00:00';
        const endTime = campaign.schedule_end_time || '18:00:00';

        return currentTime >= startTime && currentTime <= endTime;
    }

    /**
     * Get campaign statistics
     */
    async getCampaignStats(campaignId) {
        const client = await pool.connect();
        
        try {
            const statsResult = await client.query(`
                SELECT 
                    COUNT(DISTINCT cl.id) as total_leads,
                    COUNT(DISTINCT CASE WHEN cl.status = 'active' THEN cl.id END) as active_leads,
                    COUNT(DISTINCT CASE WHEN cl.status = 'completed' THEN cl.id END) as completed_leads,
                    COUNT(DISTINCT esq.id) as queued_emails,
                    COUNT(DISTINCT CASE WHEN esq.status = 'sent' THEN esq.id END) as sent_emails,
                    COUNT(DISTINCT CASE WHEN esq.status = 'failed' THEN esq.id END) as failed_emails
                FROM campaign_leads cl
                LEFT JOIN email_send_queue esq ON cl.id = esq.campaign_lead_id
                WHERE cl.campaign_id = $1
            `, [campaignId]);

            return statsResult.rows[0];
        } finally {
            client.release();
        }
    }
}

module.exports = new CampaignSchedulerService();
