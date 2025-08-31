/**
 * EmailJobService - Core service for managing email jobs in PostgreSQL
 * 
 * This service handles:
 * - Creating immediate and scheduled email jobs
 * - Rate limiting and quota management
 * - Job status tracking and retries
 * - Timezone-aware scheduling
 * - Performance optimization for high-volume sending
 */

const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class EmailJobService {
    constructor() {
        this.defaultRetryDelays = [5, 15, 60, 300]; // minutes: 5min, 15min, 1hr, 5hr
        this.maxRetries = 3;
    }

    /**
     * Add tracking pixels and link tracking to email HTML
     * @param {string} htmlBody - Original HTML body
     * @param {string} campaignLeadId - Campaign lead ID for tracking
     * @param {string} baseUrl - Base URL for tracking endpoints
     * @returns {string} HTML with tracking
     */
    addEmailTracking(htmlBody, campaignLeadId, baseUrl = process.env.BACKEND_URL || 'http://localhost:5000') {
        if (!htmlBody) return htmlBody;

        let trackedHtml = htmlBody;

        // Add tracking pixel at the end of the email
        const trackingPixel = `<img src="${baseUrl}/api/campaigns/track/open/${campaignLeadId}" width="1" height="1" style="display:none;" alt="" />`;
        
        // Insert tracking pixel before closing body tag, or at the end
        if (trackedHtml.includes('</body>')) {
            trackedHtml = trackedHtml.replace('</body>', `${trackingPixel}</body>`);
        } else {
            trackedHtml += trackingPixel;
        }

        // Track all links in the email
        let linkId = 1;
        trackedHtml = trackedHtml.replace(/<a\s+([^>]*href\s*=\s*["']([^"']+)["'][^>]*)>/gi, (match, attributes, originalUrl) => {
            // Skip if it's already a tracking URL or a mailto link
            if (originalUrl.includes('/track/click/') || originalUrl.startsWith('mailto:')) {
                return match;
            }

            const encodedUrl = encodeURIComponent(originalUrl);
            const trackingUrl = `${baseUrl}/api/campaigns/track/click/${campaignLeadId}/${linkId}?url=${encodedUrl}`;
            linkId++;

            return match.replace(originalUrl, trackingUrl);
        });

        return trackedHtml;
    }

    // ================================================================
    // 1. JOB CREATION METHODS
    // ================================================================

    /**
     * Create email jobs for immediate sending ("Push Now" functionality)
     * @param {Object} params - Job creation parameters
     * @param {string} params.campaignId - Campaign UUID
     * @param {string} params.organizationId - Organization UUID  
     * @param {Array} params.recipients - Array of recipient objects
     * @param {string} params.subject - Email subject
     * @param {string} params.bodyText - Plain text body
     * @param {string} params.bodyHtml - HTML body
     * @param {number} params.rateLimit - Emails per hour (default: 100)
     * @param {string} params.createdBy - User UUID who created the job
     * @returns {Object} Result with job IDs and statistics
     */
    async createImmediateJobs(params) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            const {
                campaignId,
                organizationId,
                recipients,
                subject,
                bodyText,
                bodyHtml,
                rateLimit = 100,
                createdBy,
                isMassEmail = false,
                massEmailConcurrency = 50
            } = params;

            // Validate required parameters
            this._validateJobParams(params);

            // Calculate staggered send times for rate limiting (or immediate for mass emails)
            const jobsWithTiming = this._calculateImmediateSendTimes(recipients, rateLimit, isMassEmail);

            // Create jobs in batches for performance
            const jobIds = [];
            const batchSize = 1000;
            
            for (let i = 0; i < jobsWithTiming.length; i += batchSize) {
                const batch = jobsWithTiming.slice(i, i + batchSize);
                const batchJobIds = await this._createJobBatch(client, {
                    campaignId,
                    organizationId,
                    jobs: batch,
                    subject,
                    bodyText,
                    bodyHtml,
                    createdBy,
                    scheduleType: 'immediate'
                });
                jobIds.push(...batchJobIds);
            }

            // Update campaign schedule configuration
            await this._upsertCampaignSchedule(client, {
                campaignId,
                scheduleType: 'immediate',
                maxEmailsPerHour: rateLimit
            });

            await client.query('COMMIT');

            return {
                success: true,
                jobsCreated: jobIds.length,
                jobIds: jobIds,
                estimatedCompletionTime: this._calculateEstimatedCompletion(jobsWithTiming.length, rateLimit),
                rateLimit: rateLimit
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creating immediate jobs:', error);
            throw new Error(`Failed to create immediate jobs: ${error.message}`);
        } finally {
            client.release();
        }
    }

    /**
     * Create email jobs for scheduled sending
     * @param {Object} params - Scheduling parameters
     * @param {string} params.campaignId - Campaign UUID
     * @param {string} params.organizationId - Organization UUID
     * @param {Array} params.recipients - Array of recipient objects
     * @param {string} params.subject - Email subject
     * @param {string} params.bodyText - Plain text body
     * @param {string} params.bodyHtml - HTML body
     * @param {Date} params.startDate - When to start sending
     * @param {Date} params.endDate - When to stop sending (optional)
     * @param {string} params.startTime - Daily start time (HH:MM format)
     * @param {string} params.endTime - Daily end time (HH:MM format)
     * @param {string} params.timezone - Timezone for scheduling
     * @param {number} params.dailyLimit - Max emails per day
     * @param {number} params.hourlyRate - Emails per hour
     * @param {string} params.createdBy - User UUID
     * @returns {Object} Result with job IDs and schedule info
     */
    async createScheduledJobs(params) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            const {
                campaignId,
                organizationId,
                recipients,
                subject,
                bodyText,
                bodyHtml,
                startDate,
                endDate,
                startTime,
                endTime,
                timezone = 'UTC',
                dailyLimit,
                hourlyRate,
                createdBy
            } = params;

            // Validate scheduling parameters
            this._validateScheduleParams(params);

            // Calculate scheduled send times for all recipients
            const jobsWithScheduling = await this._calculateScheduledSendTimes({
                recipients,
                startDate,
                endDate,
                startTime,
                endTime,
                timezone,
                dailyLimit,
                hourlyRate
            });

            // Create jobs in batches
            const jobIds = [];
            const batchSize = 1000;
            
            for (let i = 0; i < jobsWithScheduling.length; i += batchSize) {
                const batch = jobsWithScheduling.slice(i, i + batchSize);
                const batchJobIds = await this._createJobBatch(client, {
                    campaignId,
                    organizationId,
                    jobs: batch,
                    subject,
                    bodyText,
                    bodyHtml,
                    createdBy,
                    scheduleType: 'scheduled'
                });
                jobIds.push(...batchJobIds);
            }

            // Create campaign schedule configuration
            await this._upsertCampaignSchedule(client, {
                campaignId,
                scheduleType: 'scheduled',
                startDate,
                endDate,
                sendTimeStart: startTime,
                sendTimeEnd: endTime,
                sendTimezone: timezone,
                dailyLimit,
                maxEmailsPerHour: hourlyRate
            });

            await client.query('COMMIT');

            const scheduleInfo = this._getScheduleInfo(jobsWithScheduling);

            return {
                success: true,
                jobsCreated: jobIds.length,
                jobIds: jobIds,
                schedule: {
                    startDate,
                    endDate,
                    dailyLimit,
                    hourlyRate,
                    timezone,
                    ...scheduleInfo
                }
            };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creating scheduled jobs:', error);
            throw new Error(`Failed to create scheduled jobs: ${error.message}`);
        } finally {
            client.release();
        }
    }

    // ================================================================
    // 2. JOB PROCESSING METHODS
    // ================================================================

    /**
     * Get email jobs ready to be processed
     * @param {Object} options - Processing options
     * @param {number} options.limit - Max jobs to return (default: 100)
     * @param {string} options.organizationId - Filter by organization (optional)
     * @param {string} options.processingNode - Node identifier for distributed processing
     * @returns {Array} Array of jobs ready to process
     */
    async getJobsToProcess(options = {}) {
        const client = await pool.connect();
        
        try {
            const {
                limit = 100,
                organizationId,
                processingNode = 'default'
            } = options;

            // First, mark jobs as processing to prevent race conditions
            const markQuery = `
                UPDATE email_jobs 
                SET 
                    status = 'processing',
                    processing_node = $1,
                    updated_at = NOW()
                WHERE id IN (
                    SELECT id FROM email_jobs
                    WHERE status = 'pending'
                    AND scheduled_for <= NOW()
                    ${organizationId ? 'AND organization_id = $3' : ''}
                    ORDER BY priority DESC, scheduled_for ASC
                    LIMIT $2
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id;
            `;

            const markParams = organizationId 
                ? [processingNode, limit, organizationId]
                : [processingNode, limit];

            const markedResult = await client.query(markQuery, markParams);
            const markedJobIds = markedResult.rows.map(row => row.id);

            if (markedJobIds.length === 0) {
                return [];
            }

            // Get full job details for processing
            const jobsQuery = `
                SELECT 
                    ej.*,
                    c.name as campaign_name,
                    c.from_email,
                    c.from_name,
                    c.is_mass_email,
                    c.mass_email_concurrency,
                    o.name as organization_name
                FROM email_jobs ej
                JOIN campaigns c ON ej.campaign_id = c.id
                JOIN organizations o ON ej.organization_id = o.id
                WHERE ej.id = ANY($1)
                ORDER BY ej.priority DESC, ej.scheduled_for ASC;
            `;

            const jobsResult = await client.query(jobsQuery, [markedJobIds]);

            return jobsResult.rows.map(job => ({
                ...job,
                personalization_data: typeof job.personalization_data === 'string' 
                    ? JSON.parse(job.personalization_data) 
                    : job.personalization_data
            }));

        } catch (error) {
            console.error('Error getting jobs to process:', error);
            throw new Error(`Failed to get jobs to process: ${error.message}`);
        } finally {
            client.release();
        }
    }

    /**
     * Update job status after processing
     * @param {string} jobId - Job UUID
     * @param {string} status - New status (sent, failed, cancelled)
     * @param {Object} details - Additional details
     * @param {string} details.errorMessage - Error message if failed
     * @param {Object} details.metadata - Additional metadata
     * @returns {boolean} Success status
     */
    async updateJobStatus(jobId, status, details = {}) {
        const client = await pool.connect();
        
        try {
            const { errorMessage, metadata = {} } = details;
            
            // Validate status
            const validStatuses = ['pending', 'processing', 'sent', 'failed', 'cancelled'];
            if (!validStatuses.includes(status)) {
                throw new Error(`Invalid status: ${status}`);
            }

            const updateQuery = `
                UPDATE email_jobs 
                SET 
                    status = $1,
                    ${status === 'sent' ? 'sent_at = NOW(),' : ''}
                    ${status === 'failed' ? 'last_error_message = $3, last_attempted_at = NOW(),' : ''}
                    updated_at = NOW()
                WHERE id = $2
                RETURNING campaign_id, organization_id, status;
            `;

            const params = status === 'failed' 
                ? [status, jobId, errorMessage]
                : [status, jobId];

            const result = await client.query(updateQuery, params);

            if (result.rows.length === 0) {
                throw new Error(`Job ${jobId} not found`);
            }

            // Log the status change
            await this._logJobEvent(client, jobId, 'INFO', `Status changed to ${status}`, {
                ...metadata,
                errorMessage: errorMessage || null
            });

            // If failed, check if we should retry
            if (status === 'failed') {
                await this._handleFailedJob(client, jobId);
            }

            return true;

        } catch (error) {
            console.error('Error updating job status:', error);
            throw new Error(`Failed to update job status: ${error.message}`);
        } finally {
            client.release();
        }
    }

    // ================================================================
    // 3. RATE LIMITING METHODS
    // ================================================================

    /**
     * Check if organization can send more emails within rate limits
     * @param {string} organizationId - Organization UUID
     * @param {number} requestedCount - Number of emails to send
     * @returns {Object} Rate limit check result
     */
    async checkRateLimit(organizationId, requestedCount = 1) {
        const client = await pool.connect();
        
        try {
            const now = new Date();
            const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
            const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            // Get current rate limit usage
            const rateQuery = `
                SELECT 
                    window_type,
                    emails_sent_count
                FROM email_rate_limits
                WHERE rate_limit_key = $1
                AND time_window IN ($2, $3);
            `;

            const rateResult = await client.query(rateQuery, [
                `org_${organizationId}`,
                hourStart.toISOString(),
                dayStart.toISOString()
            ]);

            const hourlyUsage = rateResult.rows.find(r => r.window_type === 'hour')?.emails_sent_count || 0;
            const dailyUsage = rateResult.rows.find(r => r.window_type === 'day')?.emails_sent_count || 0;

            // Get organization limits (default fallbacks)
            const limits = await this._getOrganizationLimits(client, organizationId);

            const canSend = {
                hourly: (hourlyUsage + requestedCount) <= limits.hourlyLimit,
                daily: (dailyUsage + requestedCount) <= limits.dailyLimit
            };

            return {
                allowed: canSend.hourly && canSend.daily,
                limits: limits,
                usage: {
                    hourly: hourlyUsage,
                    daily: dailyUsage
                },
                remaining: {
                    hourly: Math.max(0, limits.hourlyLimit - hourlyUsage),
                    daily: Math.max(0, limits.dailyLimit - dailyUsage)
                },
                resetTimes: {
                    hourly: new Date(hourStart.getTime() + 60 * 60 * 1000),
                    daily: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
                }
            };

        } catch (error) {
            console.error('Error checking rate limit:', error);
            throw new Error(`Failed to check rate limit: ${error.message}`);
        } finally {
            client.release();
        }
    }

    /**
     * Update rate limit counters after sending emails
     * @param {string} organizationId - Organization UUID
     * @param {number} emailsSent - Number of emails successfully sent
     * @param {number} emailsFailed - Number of emails that failed
     * @returns {boolean} Success status
     */
    async updateRateLimit(organizationId, emailsSent = 0, emailsFailed = 0) {
        const client = await pool.connect();
        
        try {
            const now = new Date();
            const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
            const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            const rateLimitKey = `org_${organizationId}`;

            // Update hourly counter
            await client.query(`
                INSERT INTO email_rate_limits (rate_limit_key, time_window, window_type, emails_sent_count, emails_failed_count)
                VALUES ($1, $2, 'hour', $3, $4)
                ON CONFLICT (rate_limit_key, time_window, window_type)
                DO UPDATE SET 
                    emails_sent_count = email_rate_limits.emails_sent_count + $3,
                    emails_failed_count = email_rate_limits.emails_failed_count + $4,
                    updated_at = NOW();
            `, [rateLimitKey, hourStart.toISOString(), emailsSent, emailsFailed]);

            // Update daily counter
            await client.query(`
                INSERT INTO email_rate_limits (rate_limit_key, time_window, window_type, emails_sent_count, emails_failed_count)
                VALUES ($1, $2, 'day', $3, $4)
                ON CONFLICT (rate_limit_key, time_window, window_type)
                DO UPDATE SET 
                    emails_sent_count = email_rate_limits.emails_sent_count + $3,
                    emails_failed_count = email_rate_limits.emails_failed_count + $4,
                    updated_at = NOW();
            `, [rateLimitKey, dayStart.toISOString(), emailsSent, emailsFailed]);

            return true;

        } catch (error) {
            console.error('Error updating rate limit:', error);
            throw new Error(`Failed to update rate limit: ${error.message}`);
        } finally {
            client.release();
        }
    }

    // ================================================================
    // 4. MONITORING AND STATISTICS METHODS
    // ================================================================

    /**
     * Get job statistics for a campaign
     * @param {string} campaignId - Campaign UUID
     * @returns {Object} Campaign job statistics
     */
    async getCampaignStats(campaignId) {
        const client = await pool.connect();
        
        try {
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_jobs,
                    COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_jobs,
                    COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_jobs,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_jobs,
                    MIN(scheduled_for) as first_scheduled,
                    MAX(scheduled_for) as last_scheduled,
                    MIN(sent_at) as first_sent,
                    MAX(sent_at) as last_sent,
                    AVG(retry_count) as avg_retries
                FROM email_jobs
                WHERE campaign_id = $1;
            `;

            const result = await client.query(statsQuery, [campaignId]);
            const stats = result.rows[0];

            // Calculate completion percentage
            const completionPercentage = stats.total_jobs > 0 
                ? Math.round((stats.sent_jobs / stats.total_jobs) * 100)
                : 0;

            return {
                ...stats,
                completion_percentage: completionPercentage,
                is_complete: stats.pending_jobs === 0 && stats.processing_jobs === 0,
                success_rate: stats.total_jobs > 0 
                    ? Math.round(((stats.sent_jobs / (stats.sent_jobs + stats.failed_jobs)) || 0) * 100)
                    : 0
            };

        } catch (error) {
            console.error('Error getting campaign stats:', error);
            throw new Error(`Failed to get campaign stats: ${error.message}`);
        } finally {
            client.release();
        }
    }

    /**
     * Get failed jobs that need attention
     * @param {Object} options - Query options
     * @param {string} options.organizationId - Filter by organization
     * @param {number} options.limit - Max results to return
     * @returns {Array} Array of failed jobs
     */
    async getFailedJobs(options = {}) {
        const client = await pool.connect();
        
        try {
            const { organizationId, limit = 100 } = options;

            const query = `
                SELECT 
                    ej.*,
                    c.name as campaign_name
                FROM email_jobs ej
                JOIN campaigns c ON ej.campaign_id = c.id
                WHERE ej.status = 'failed'
                AND ej.retry_count >= ej.max_retries
                ${organizationId ? 'AND ej.organization_id = $2' : ''}
                ORDER BY ej.updated_at DESC
                LIMIT $1;
            `;

            const params = organizationId ? [limit, organizationId] : [limit];
            const result = await client.query(query, params);

            return result.rows;

        } catch (error) {
            console.error('Error getting failed jobs:', error);
            throw new Error(`Failed to get failed jobs: ${error.message}`);
        } finally {
            client.release();
        }
    }

    // ================================================================
    // 5. PRIVATE HELPER METHODS
    // ================================================================

    /**
     * Validate job creation parameters
     * @private
     */
    _validateJobParams(params) {
        const required = ['campaignId', 'organizationId', 'recipients', 'subject', 'createdBy'];
        
        for (const field of required) {
            if (!params[field]) {
                throw new Error(`Missing required parameter: ${field}`);
            }
        }

        if (!Array.isArray(params.recipients) || params.recipients.length === 0) {
            throw new Error('Recipients must be a non-empty array');
        }

        // Validate recipients have required fields
        for (const recipient of params.recipients) {
            if (!recipient.email) {
                throw new Error('All recipients must have an email address');
            }
        }
    }

    /**
     * Validate scheduling parameters
     * @private
     */
    _validateScheduleParams(params) {
        this._validateJobParams(params);

        const required = ['startDate', 'startTime', 'endTime', 'dailyLimit', 'hourlyRate'];
        
        for (const field of required) {
            if (!params[field]) {
                throw new Error(`Missing required scheduling parameter: ${field}`);
            }
        }

        // Validate time format (HH:MM)
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(params.startTime) || !timeRegex.test(params.endTime)) {
            throw new Error('Time must be in HH:MM format');
        }
    }

    /**
     * Calculate immediate send times with rate limiting
     * @private
     */
    _calculateImmediateSendTimes(recipients, rateLimit, isMassEmail = false) {
        const now = new Date();
        
        if (isMassEmail) {
            // For mass emails, all emails should be sent immediately (same time)
            return recipients.map((recipient) => ({
                ...recipient,
                scheduledFor: now, // All emails get the same immediate time
                priority: 1 // Higher priority for mass emails
            }));
        } else {
            // For distributed emails, calculate staggered send times
            const intervalMs = (60 * 60 * 1000) / rateLimit; // milliseconds between emails
            
            return recipients.map((recipient, index) => ({
                ...recipient,
                scheduledFor: new Date(now.getTime() + (index * intervalMs)),
                priority: 5 // Default priority for distributed sending
            }));
        }
    }

    /**
     * Calculate scheduled send times based on schedule configuration
     * @private
     */
    async _calculateScheduledSendTimes(params) {
        const {
            recipients,
            startDate,
            endDate,
            startTime,
            endTime,
            timezone,
            dailyLimit,
            hourlyRate
        } = params;

        // Convert time strings to minutes since midnight
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        const dailyWindowMinutes = endMinutes - startMinutes;

        if (dailyWindowMinutes <= 0) {
            throw new Error('End time must be after start time');
        }

        const emailsPerDay = Math.min(dailyLimit, recipients.length);
        const intervalMinutes = dailyWindowMinutes / emailsPerDay;

        const jobs = [];
        let currentDate = new Date(startDate);
        let recipientIndex = 0;

        while (recipientIndex < recipients.length && (!endDate || currentDate <= new Date(endDate))) {
            const emailsToday = Math.min(emailsPerDay, recipients.length - recipientIndex);
            
            for (let i = 0; i < emailsToday; i++) {
                const recipient = recipients[recipientIndex];
                const minutesFromStart = i * intervalMinutes;
                const scheduledTime = new Date(currentDate);
                
                scheduledTime.setHours(startHour);
                scheduledTime.setMinutes(startMin + minutesFromStart);

                jobs.push({
                    ...recipient,
                    scheduledFor: scheduledTime,
                    priority: 3 // Lower priority for scheduled emails
                });

                recipientIndex++;
            }

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return jobs;
    }

    /**
     * Create a batch of email jobs
     * @private
     */
    async _createJobBatch(client, params) {
        const {
            campaignId,
            organizationId,
            jobs,
            subject,
            bodyText,
            bodyHtml,
            createdBy,
            scheduleType
        } = params;

        const values = [];
        const placeholders = [];
        let paramIndex = 1;

        for (const job of jobs) {
            // Use personalized content if available, otherwise fall back to template content
            const jobSubject = job.personalizedSubject || subject;
            const jobBodyHtml = job.personalizedBodyHtml || bodyHtml;
            const jobBodyText = job.personalizedBodyText || bodyText;
            
            const personalizationData = {
                firstName: job.firstName || job.first_name || '',
                lastName: job.lastName || job.last_name || '',
                companyName: job.companyName || job.company_name || '',
                jobTitle: job.jobTitle || job.job_title || '',
                phone: job.phone || '',
                website: job.website || '',
                ...job.customFields || {}
            };

            placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13})`);
            
            values.push(
                campaignId,
                organizationId,
                job.email,
                job.firstName || job.first_name || null,
                jobSubject,
                jobBodyText,
                jobBodyHtml,
                JSON.stringify(personalizationData),
                job.scheduledFor,
                job.priority || 5,
                `org_${organizationId}`,
                createdBy,
                new Date(), // created_at should be NOW
                'UTC'
            );
            
            paramIndex += 14;
        }

        const insertQuery = `
            INSERT INTO email_jobs (
                campaign_id, organization_id, recipient_email, recipient_name,
                subject, body_text, body_html, personalization_data,
                scheduled_for, priority, rate_limit_key, created_by,
                created_at, timezone
            ) VALUES ${placeholders.join(', ')}
            RETURNING id;
        `;

        const result = await client.query(insertQuery, values);
        return result.rows.map(row => row.id);
    }

    /**
     * Upsert campaign schedule configuration
     * @private
     */
    async _upsertCampaignSchedule(client, config) {
        const {
            campaignId,
            scheduleType,
            maxEmailsPerHour,
            startDate,
            endDate,
            sendTimeStart,
            sendTimeEnd,
            sendTimezone,
            dailyLimit
        } = config;

        const upsertQuery = `
            INSERT INTO campaign_schedules (
                campaign_id, schedule_type, max_emails_per_hour,
                start_date, end_date, send_time_start, send_time_end,
                send_timezone, daily_limit
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (campaign_id)
            DO UPDATE SET
                schedule_type = $2,
                max_emails_per_hour = $3,
                start_date = $4,
                end_date = $5,
                send_time_start = $6,
                send_time_end = $7,
                send_timezone = $8,
                daily_limit = $9,
                updated_at = NOW();
        `;

        await client.query(upsertQuery, [
            campaignId, scheduleType, maxEmailsPerHour,
            startDate, endDate, sendTimeStart, sendTimeEnd,
            sendTimezone, dailyLimit
        ]);
    }

    /**
     * Get organization rate limits
     * @private
     */
    async _getOrganizationLimits(client, organizationId) {
        // For now, return default limits. Later this could come from organization settings
        return {
            hourlyLimit: 100,
            dailyLimit: 1000
        };
    }

    /**
     * Log job event for debugging and audit
     * @private
     */
    async _logJobEvent(client, jobId, level, message, details = {}) {
        try {
            await client.query(`
                INSERT INTO email_job_logs (email_job_id, log_level, message, details)
                VALUES ($1, $2, $3, $4);
            `, [jobId, level, message, JSON.stringify(details)]);
        } catch (error) {
            console.error('Failed to log job event:', error);
            // Don't throw - logging failures shouldn't break job processing
        }
    }

    /**
     * Handle failed job retry logic
     * @private
     */
    async _handleFailedJob(client, jobId) {
        try {
            // Get current job state
            const jobResult = await client.query(`
                SELECT retry_count, max_retries FROM email_jobs WHERE id = $1;
            `, [jobId]);

            if (jobResult.rows.length === 0) return;

            const job = jobResult.rows[0];
            
            if (job.retry_count < job.max_retries) {
                // Calculate next retry time with exponential backoff
                const retryDelayMinutes = this.defaultRetryDelays[job.retry_count] || 300;
                const nextRetryTime = new Date(Date.now() + retryDelayMinutes * 60 * 1000);

                // Schedule retry
                await client.query(`
                    UPDATE email_jobs 
                    SET 
                        status = 'pending',
                        scheduled_for = $1,
                        retry_count = retry_count + 1,
                        updated_at = NOW()
                    WHERE id = $2;
                `, [nextRetryTime, jobId]);

                await this._logJobEvent(client, jobId, 'INFO', `Scheduled retry ${job.retry_count + 1}/${job.max_retries}`, {
                    nextRetryTime: nextRetryTime.toISOString(),
                    retryDelayMinutes
                });
            } else {
                await this._logJobEvent(client, jobId, 'ERROR', 'Max retries exceeded - giving up', {
                    maxRetries: job.max_retries
                });
            }
        } catch (error) {
            console.error('Error handling failed job:', error);
        }
    }

    /**
     * Calculate estimated completion time
     * @private
     */
    _calculateEstimatedCompletion(jobCount, rateLimit) {
        const hoursToComplete = jobCount / rateLimit;
        const completionTime = new Date(Date.now() + hoursToComplete * 60 * 60 * 1000);
        return completionTime;
    }

    /**
     * Get schedule information summary
     * @private
     */
    _getScheduleInfo(jobs) {
        if (jobs.length === 0) return {};

        const firstSend = jobs[0].scheduledFor;
        const lastSend = jobs[jobs.length - 1].scheduledFor;
        
        return {
            firstEmailTime: firstSend,
            lastEmailTime: lastSend,
            totalDuration: Math.ceil((lastSend - firstSend) / (1000 * 60 * 60 * 24)) // days
        };
    }
}

module.exports = new EmailJobService();
