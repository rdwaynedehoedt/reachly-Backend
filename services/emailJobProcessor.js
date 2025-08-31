/**
 * EmailJobProcessor - Background service for processing email jobs
 * 
 * This service handles:
 * - Background processing of email jobs from the queue
 * - Rate limiting and quota management per organization
 * - Actual email sending via Gmail API
 * - Job status updates and retry logic
 * - Campaign progress tracking and lead status management
 * - Error handling and logging
 * 
 * Designed to run as a cron job or background service
 */

const pool = require('../config/database');
const emailJobService = require('./emailJobService');
const gmailService = require('./gmailService');

class EmailJobProcessor {
    constructor() {
        this.isProcessing = false;
        this.processingNode = `node_${process.pid}_${Date.now()}`;
        this.maxConcurrentJobs = 10; // Process up to 10 jobs concurrently
        this.processingInterval = 30000; // Check for jobs every 30 seconds
        this.processingTimer = null;
        
        // Rate limiting tracking
        this.organizationLastSent = new Map(); // Track last send time per org
        this.organizationSentCount = new Map(); // Track hourly send count per org
        this.globalLastReset = Date.now();
        
        console.log(`📧 EmailJobProcessor initialized with node ID: ${this.processingNode}`);
    }

    // ================================================================
    // 1. MAIN PROCESSING METHODS
    // ================================================================

    /**
     * Start the background job processor
     */
    async start() {
        if (this.isProcessing) {
            console.log('⚠️  EmailJobProcessor is already running');
            return;
        }

        console.log('🚀 Starting EmailJobProcessor...');
        this.isProcessing = true;
        
        // Start processing loop
        this.processingTimer = setInterval(async () => {
            try {
                await this.processJobBatch();
            } catch (error) {
                console.error('❌ Error in processing loop:', error);
            }
        }, this.processingInterval);

        console.log(`✅ EmailJobProcessor started (checking every ${this.processingInterval}ms)`);
        
        // Process initial batch
        await this.processJobBatch();
    }

    /**
     * Stop the background job processor
     */
    async stop() {
        console.log('🛑 Stopping EmailJobProcessor...');
        this.isProcessing = false;
        
        if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = null;
        }
        
        console.log('✅ EmailJobProcessor stopped');
    }

    /**
     * Process a batch of email jobs
     */
    async processJobBatch() {
        if (!this.isProcessing) {
            return;
        }

        try {
            console.log('🔍 Checking for pending email jobs...');
            
            // Get jobs ready to process
            const jobs = await emailJobService.getJobsToProcess({
                limit: this.maxConcurrentJobs,
                processingNode: this.processingNode
            });

            if (jobs.length === 0) {
                console.log('📭 No pending jobs found');
                return;
            }

            console.log(`📨 Found ${jobs.length} jobs to process`);

            // Group jobs by organization for rate limiting
            const jobsByOrg = this.groupJobsByOrganization(jobs);
            
            // Process jobs by organization with rate limiting
            const processingPromises = [];
            for (const [orgId, orgJobs] of jobsByOrg.entries()) {
                processingPromises.push(this.processOrganizationJobs(orgId, orgJobs));
            }

            // Wait for all organizations to complete processing
            await Promise.allSettled(processingPromises);
            
            console.log(`✅ Batch processing completed for ${jobs.length} jobs`);

        } catch (error) {
            console.error('❌ Error processing job batch:', error);
        }
    }

    // ================================================================
    // 2. ORGANIZATION-LEVEL PROCESSING
    // ================================================================

    /**
     * Process jobs for a specific organization with rate limiting
     */
    async processOrganizationJobs(organizationId, jobs) {
        console.log(`🏢 Processing ${jobs.length} jobs for organization ${organizationId}`);
        
        try {
            // Check rate limits for this organization
            const rateLimitInfo = await this.checkOrganizationRateLimit(organizationId);
            if (!rateLimitInfo.canSend) {
                console.log(`⏳ Rate limit reached for org ${organizationId}: ${rateLimitInfo.reason}`);
                // Release jobs back to pending status
                await this.releaseJobsBackToPending(jobs);
                return;
            }

            // Process jobs sequentially to respect rate limits
            let successCount = 0;
            let failureCount = 0;

            for (const job of jobs) {
                try {
                    // Check if we can still send (rate limits may change during processing)
                    const canSend = await this.checkOrganizationRateLimit(organizationId);
                    if (!canSend.canSend) {
                        console.log(`⏳ Rate limit reached during processing for org ${organizationId}`);
                        // Release remaining jobs
                        const remainingJobs = jobs.slice(jobs.indexOf(job));
                        await this.releaseJobsBackToPending(remainingJobs);
                        break;
                    }

                    // Process individual job
                    const result = await this.processIndividualJob(job);
                    if (result.success) {
                        successCount++;
                        this.updateOrganizationRateTracking(organizationId);
                    } else {
                        failureCount++;
                    }

                    // Small delay between emails to avoid overwhelming APIs
                    await this.delay(1000);

                } catch (error) {
                    console.error(`❌ Error processing job ${job.id}:`, error);
                    await this.handleJobFailure(job, error.message);
                    failureCount++;
                }
            }

            console.log(`✅ Organization ${organizationId} completed: ${successCount} sent, ${failureCount} failed`);

        } catch (error) {
            console.error(`❌ Error processing organization ${organizationId}:`, error);
            await this.releaseJobsBackToPending(jobs);
        }
    }

    /**
     * Process an individual email job
     */
    async processIndividualJob(job) {
        const client = await pool.connect();
        
        try {
            console.log(`📧 Processing job ${job.id} to ${job.recipient_email}`);

            // Get email account for sending
            const emailAccount = await this.getEmailAccountForJob(job);
            if (!emailAccount) {
                throw new Error('No active email account found for campaign');
            }

            // Prepare email data
            const emailData = {
                to: job.recipient_email,
                subject: job.subject,
                htmlBody: job.body_html,
                textBody: job.body_text
            };

            // Send email using Gmail service
            console.log(`📤 Sending email from ${emailAccount.email} to ${job.recipient_email}`);
            const sendResult = await gmailService.sendEmail(emailAccount.id, emailData);

            // Mark job as sent
            await client.query(`
                UPDATE email_jobs 
                SET 
                    status = 'sent',
                    sent_at = NOW(),
                    message_id = $1,
                    thread_id = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [sendResult.messageId, sendResult.threadId, job.id]);

            // Update lead status in campaign_leads
            if (job.lead_id) {
                await client.query(`
                    UPDATE campaign_leads 
                    SET 
                        status = 'sent',
                        sent_at = NOW()
                    WHERE campaign_id = $1 AND lead_id = $2
                `, [job.campaign_id, job.lead_id]);
            }

            // Update campaign statistics
            await this.updateCampaignStatistics(job.campaign_id, 'sent');

            // Log email send to email_sends table
            await client.query(`
                INSERT INTO email_sends (
                    id, user_id, email_account_id, recipient_email,
                    subject, message_id, thread_id, status, sent_at,
                    campaign_id, job_id
                ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
            `, [
                job.created_by,
                emailAccount.id,
                job.recipient_email,
                job.subject,
                sendResult.messageId,
                sendResult.threadId,
                'sent',
                job.campaign_id,
                job.id
            ]);

            // Update campaign statistics
            await this.updateCampaignStatistics(job.campaign_id, 'sent');

            console.log(`✅ Job ${job.id} sent successfully (Message ID: ${sendResult.messageId})`);

            return {
                success: true,
                messageId: sendResult.messageId,
                threadId: sendResult.threadId
            };

        } catch (error) {
            console.error(`❌ Failed to send job ${job.id}:`, error);
            await this.handleJobFailure(job, error.message);
            return {
                success: false,
                error: error.message
            };
        } finally {
            client.release();
        }
    }

    // ================================================================
    // 3. RATE LIMITING AND QUOTA MANAGEMENT
    // ================================================================

    /**
     * Check if organization can send emails based on rate limits
     */
    async checkOrganizationRateLimit(organizationId) {
        const client = await pool.connect();
        
        try {
            // Get organization's email quota settings
            const quotaResult = await client.query(`
                SELECT 
                    COALESCE(max_emails_per_hour, 100) as hourly_limit,
                    COALESCE(max_emails_per_day, 1000) as daily_limit
                FROM organizations 
                WHERE id = $1
            `, [organizationId]);

            if (quotaResult.rows.length === 0) {
                return { canSend: false, reason: 'Organization not found' };
            }

            const { hourly_limit, daily_limit } = quotaResult.rows[0];

            // Check hourly limit
            const hourlyCount = await this.getOrganizationHourlyCount(organizationId);
            if (hourlyCount >= hourly_limit) {
                return { 
                    canSend: false, 
                    reason: `Hourly limit reached (${hourlyCount}/${hourly_limit})` 
                };
            }

            // Check daily limit
            const dailyCount = await this.getOrganizationDailyCount(organizationId);
            if (dailyCount >= daily_limit) {
                return { 
                    canSend: false, 
                    reason: `Daily limit reached (${dailyCount}/${daily_limit})` 
                };
            }

            // Check minimum interval between sends (to avoid spam-like behavior)
            const lastSent = this.organizationLastSent.get(organizationId) || 0;
            const timeSinceLastSend = Date.now() - lastSent;
            const minInterval = 2000; // 2 seconds minimum between emails

            if (timeSinceLastSend < minInterval) {
                return { 
                    canSend: false, 
                    reason: `Minimum interval not met (${timeSinceLastSend}ms < ${minInterval}ms)` 
                };
            }

            return { 
                canSend: true, 
                hourlyUsed: hourlyCount, 
                hourlyLimit: hourly_limit,
                dailyUsed: dailyCount,
                dailyLimit: daily_limit
            };

        } catch (error) {
            console.error('Error checking rate limit:', error);
            return { canSend: false, reason: 'Error checking rate limits' };
        } finally {
            client.release();
        }
    }

    /**
     * Get organization's hourly email count
     */
    async getOrganizationHourlyCount(organizationId) {
        const client = await pool.connect();
        
        try {
            const result = await client.query(`
                SELECT COUNT(*) as count
                FROM email_jobs
                WHERE organization_id = $1 
                  AND status = 'sent'
                  AND sent_at >= NOW() - INTERVAL '1 hour'
            `, [organizationId]);

            return parseInt(result.rows[0].count);
        } finally {
            client.release();
        }
    }

    /**
     * Get organization's daily email count
     */
    async getOrganizationDailyCount(organizationId) {
        const client = await pool.connect();
        
        try {
            const result = await client.query(`
                SELECT COUNT(*) as count
                FROM email_jobs
                WHERE organization_id = $1 
                  AND status = 'sent'
                  AND sent_at >= NOW() - INTERVAL '24 hours'
            `, [organizationId]);

            return parseInt(result.rows[0].count);
        } finally {
            client.release();
        }
    }

    /**
     * Update rate tracking for organization
     */
    updateOrganizationRateTracking(organizationId) {
        this.organizationLastSent.set(organizationId, Date.now());
        
        // Clean up old tracking data every hour
        if (Date.now() - this.globalLastReset > 3600000) {
            this.organizationLastSent.clear();
            this.organizationSentCount.clear();
            this.globalLastReset = Date.now();
        }
    }

    // ================================================================
    // 4. ERROR HANDLING AND RETRY LOGIC
    // ================================================================

    /**
     * Handle job failure with retry logic
     */
    async handleJobFailure(job, errorMessage) {
        const client = await pool.connect();
        
        try {
            const retryCount = job.retry_count || 0;
            const maxRetries = 3;

            if (retryCount < maxRetries) {
                // Calculate next retry time (exponential backoff)
                const retryDelays = [5, 15, 60]; // minutes
                const delayMinutes = retryDelays[retryCount] || 60;
                const nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000);

                console.log(`🔄 Scheduling retry ${retryCount + 1}/${maxRetries} for job ${job.id} in ${delayMinutes} minutes`);

                await client.query(`
                    UPDATE email_jobs 
                    SET 
                        status = 'pending',
                        retry_count = $1,
                        error_message = $2,
                        scheduled_for = $3,
                        updated_at = NOW()
                    WHERE id = $4
                `, [retryCount + 1, errorMessage, nextRetry, job.id]);

            } else {
                console.log(`❌ Job ${job.id} permanently failed after ${maxRetries} retries`);

                // Mark job as permanently failed
                await client.query(`
                    UPDATE email_jobs 
                    SET 
                        status = 'failed',
                        error_message = $1,
                        updated_at = NOW()
                    WHERE id = $2
                `, [errorMessage, job.id]);

                // Update lead status to failed
                if (job.lead_id) {
                    await client.query(`
                        UPDATE campaign_leads 
                        SET 
                            status = 'failed',
                            error_message = $1
                        WHERE campaign_id = $2 AND lead_id = $3
                    `, [errorMessage, job.campaign_id, job.lead_id]);
                }

                // Update campaign statistics
                await this.updateCampaignStatistics(job.campaign_id, 'failed');
            }

        } catch (error) {
            console.error(`Error handling job failure for ${job.id}:`, error);
        } finally {
            client.release();
        }
    }

    /**
     * Release jobs back to pending status (when rate limited)
     */
    async releaseJobsBackToPending(jobs) {
        const client = await pool.connect();
        
        try {
            const jobIds = jobs.map(job => job.id);
            if (jobIds.length === 0) return;

            await client.query(`
                UPDATE email_jobs 
                SET 
                    status = 'pending',
                    processing_node = NULL,
                    updated_at = NOW()
                WHERE id = ANY($1)
            `, [jobIds]);

            console.log(`🔄 Released ${jobIds.length} jobs back to pending status`);

        } catch (error) {
            console.error('Error releasing jobs back to pending:', error);
        } finally {
            client.release();
        }
    }

    // ================================================================
    // 5. HELPER METHODS
    // ================================================================

    /**
     * Group jobs by organization for rate limiting
     */
    groupJobsByOrganization(jobs) {
        const grouped = new Map();
        
        for (const job of jobs) {
            const orgId = job.organization_id;
            if (!grouped.has(orgId)) {
                grouped.set(orgId, []);
            }
            grouped.get(orgId).push(job);
        }
        
        return grouped;
    }

    /**
     * Get email account for job
     */
    async getEmailAccountForJob(job) {
        const client = await pool.connect();
        
        try {
            // Get the campaign's from_email and find matching active account
            const result = await client.query(`
                SELECT ea.* 
                FROM campaigns c
                JOIN email_accounts ea ON ea.email = c.from_email
                WHERE c.id = $1 AND ea.status = 'active'
                LIMIT 1
            `, [job.campaign_id]);

            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * Update campaign statistics
     */
    async updateCampaignStatistics(campaignId, outcome) {
        const client = await pool.connect();
        
        try {
            if (outcome === 'sent') {
                await client.query(`
                    UPDATE campaigns 
                    SET 
                        emails_sent = emails_sent + 1,
                        updated_at = NOW()
                    WHERE id = $1
                `, [campaignId]);
            } else if (outcome === 'failed') {
                await client.query(`
                    UPDATE campaigns 
                    SET 
                        emails_failed = COALESCE(emails_failed, 0) + 1,
                        updated_at = NOW()
                    WHERE id = $1
                `, [campaignId]);
            }
        } catch (error) {
            console.error('Error updating campaign statistics:', error);
        } finally {
            client.release();
        }
    }

    /**
     * Simple delay utility
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ================================================================
    // 6. MONITORING AND HEALTH CHECK METHODS
    // ================================================================

    /**
     * Get processor status and statistics
     */
    async getStatus() {
        const client = await pool.connect();
        
        try {
            // Get pending jobs count
            const pendingResult = await client.query(`
                SELECT COUNT(*) as count FROM email_jobs WHERE status = 'pending'
            `);
            
            // Get processing jobs count
            const processingResult = await client.query(`
                SELECT COUNT(*) as count FROM email_jobs WHERE status = 'processing'
            `);
            
            // Get failed jobs count
            const failedResult = await client.query(`
                SELECT COUNT(*) as count FROM email_jobs WHERE status = 'failed'
            `);

            // Get hourly send rate
            const hourlySentResult = await client.query(`
                SELECT COUNT(*) as count 
                FROM email_jobs 
                WHERE status = 'sent' AND sent_at >= NOW() - INTERVAL '1 hour'
            `);

            return {
                isRunning: this.isProcessing,
                processingNode: this.processingNode,
                maxConcurrentJobs: this.maxConcurrentJobs,
                processingInterval: this.processingInterval,
                stats: {
                    pendingJobs: parseInt(pendingResult.rows[0].count),
                    processingJobs: parseInt(processingResult.rows[0].count),
                    failedJobs: parseInt(failedResult.rows[0].count),
                    sentLastHour: parseInt(hourlySentResult.rows[0].count)
                },
                rateTracking: {
                    organizationsTracked: this.organizationLastSent.size,
                    lastReset: new Date(this.globalLastReset).toISOString()
                }
            };

        } finally {
            client.release();
        }
    }

    /**
     * Process jobs immediately (for testing/manual triggers)
     */
    async processNow() {
        console.log('🚀 Manual job processing triggered');
        await this.processJobBatch();
        return await this.getStatus();
    }
}

module.exports = new EmailJobProcessor();
