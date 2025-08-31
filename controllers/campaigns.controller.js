const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const emailJobService = require('../services/emailJobService');

/**
 * Campaigns Controller - Handles campaign management operations
 * Follows the established patterns from leads.controller.js and auth.controller.js
 */
class CampaignsController {

    /**
     * Get all campaigns for the user's organization
     * GET /api/campaigns
     */
    async getCampaigns(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            
            // Get user's organization (following existing pattern)
            const orgResult = await client.query(`
                SELECT om.organization_id 
                FROM organization_members om 
                WHERE om.user_id = $1 AND om.status = 'active'
                LIMIT 1
            `, [userId]);
            
            if (orgResult.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'No active organization membership found'
                });
            }
            
            const organizationId = orgResult.rows[0].organization_id;
            
            // Get campaigns with analytics and creator info
            const campaignsResult = await client.query(`
                SELECT 
                    c.*,
                    u.first_name as created_by_first_name,
                    u.last_name as created_by_last_name,
                    COUNT(DISTINCT cl.id) as total_leads,
                    COUNT(DISTINCT CASE WHEN cl.status = 'sent' THEN cl.id END) as emails_sent,
                    COUNT(DISTINCT CASE WHEN cl.status = 'delivered' THEN cl.id END) as emails_delivered,
                    COUNT(DISTINCT CASE WHEN cl.status = 'opened' THEN cl.id END) as emails_opened,
                    COUNT(DISTINCT CASE WHEN cl.status = 'clicked' THEN cl.id END) as emails_clicked,
                    COUNT(DISTINCT CASE WHEN cl.status = 'replied' THEN cl.id END) as emails_replied
                FROM campaigns c
                LEFT JOIN users u ON c.created_by = u.id
                LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
                WHERE c.organization_id = $1
                GROUP BY c.id, u.first_name, u.last_name
                ORDER BY c.created_at DESC
            `, [organizationId]);
            
            return res.json({
                success: true,
                data: {
                    campaigns: campaignsResult.rows
                }
            });
            
        } catch (error) {
            console.error('Get campaigns error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch campaigns'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Create a new campaign
     * POST /api/campaigns
     */
    async createCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const {
                name,
                description,
                type = 'single',
                from_name: fromName,
                from_email: fromEmail,
                reply_to_email: replyToEmail,
                scheduled_at: scheduledAt,
                send_immediately: sendImmediately = false,
                timezone = 'UTC',
                daily_send_limit: dailySendLimit = 50,
                is_mass_email: isMassEmail = false,
                mass_email_concurrency: massEmailConcurrency = 50
            } = req.body;

            // Input validation
            if (!name || !name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Campaign name is required'
                });
            }

            if (!fromEmail || !fromEmail.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'From email is required'
                });
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(fromEmail)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid from email format'
                });
            }

            // Validate campaign type
            const validTypes = ['single', 'sequence'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign type. Must be single or sequence'
                });
            }

            // Get user's organization
            const orgResult = await client.query(`
                SELECT om.organization_id 
                FROM organization_members om 
                WHERE om.user_id = $1 AND om.status = 'active'
                LIMIT 1
            `, [userId]);
            
            if (orgResult.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'No active organization membership found'
                });
            }
            
            const organizationId = orgResult.rows[0].organization_id;

            // Verify the from email belongs to the user (check email_accounts)
            const emailAccountResult = await client.query(`
                SELECT id FROM email_accounts 
                WHERE user_id = $1 AND email = $2 AND status = 'active'
            `, [userId, fromEmail]);

            if (emailAccountResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'From email must be connected to your account'
                });
            }

            await client.query('BEGIN');

            // Create campaign
            const campaignId = uuidv4();
            const campaignResult = await client.query(`
                INSERT INTO campaigns (
                    id, organization_id, name, description, type, status,
                    from_name, from_email, reply_to_email,
                    scheduled_at, send_immediately, timezone, daily_send_limit,
                    is_mass_email, mass_email_concurrency,
                    created_by, updated_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING *
            `, [
                campaignId, organizationId, name.trim(), description?.trim(), type, 'draft',
                fromName?.trim(), fromEmail.trim(), replyToEmail?.trim(),
                scheduledAt, sendImmediately, timezone, dailySendLimit,
                isMassEmail, massEmailConcurrency,
                userId, userId
            ]);

            await client.query('COMMIT');

            return res.status(201).json({
                success: true,
                message: 'Campaign created successfully',
                data: {
                    campaign: campaignResult.rows[0]
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Create campaign error:', error);
            
            // Handle unique constraint violations
            if (error.code === '23505') {
                return res.status(400).json({
                    success: false,
                    message: 'A campaign with this name already exists'
                });
            }
            
            return res.status(500).json({
                success: false,
                message: 'Failed to create campaign',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get campaign details with templates and leads
     * GET /api/campaigns/:id
     */
    async getCampaignDetails(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;

            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }
            
            // Get user's organization
            const orgResult = await client.query(`
                SELECT om.organization_id 
                FROM organization_members om 
                WHERE om.user_id = $1 AND om.status = 'active'
                LIMIT 1
            `, [userId]);
            
            if (orgResult.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'No active organization membership found'
                });
            }
            
            const organizationId = orgResult.rows[0].organization_id;
            
            // Get campaign details with creator info
            const campaignResult = await client.query(`
                SELECT 
                    c.*,
                    u.first_name as created_by_first_name,
                    u.last_name as created_by_last_name,
                    u2.first_name as updated_by_first_name,
                    u2.last_name as updated_by_last_name
                FROM campaigns c
                LEFT JOIN users u ON c.created_by = u.id
                LEFT JOIN users u2 ON c.updated_by = u2.id
                WHERE c.id = $1 AND c.organization_id = $2
            `, [campaignId, organizationId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }
            
            // Get active campaign template
            const templateResult = await client.query(`
                SELECT * FROM campaign_templates
                WHERE campaign_id = $1 AND is_active = true
                ORDER BY created_at DESC
                LIMIT 1
            `, [campaignId]);
            
            // Get campaign leads with lead details
            const leadsResult = await client.query(`
                SELECT 
                    cl.*,
                    l.email, l.first_name, l.last_name, l.company_name, 
                    l.job_title, l.phone, l.website, l.linkedin_url,
                    l.status as lead_status, l.source, l.tags
                FROM campaign_leads cl
                JOIN leads l ON cl.lead_id = l.id
                WHERE cl.campaign_id = $1
                ORDER BY cl.created_at DESC
            `, [campaignId]);

            // Get campaign analytics summary
            const analyticsResult = await client.query(`
                SELECT 
                    COUNT(*) as total_leads,
                    COUNT(CASE WHEN status = 'sent' THEN 1 END) as emails_sent,
                    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as emails_delivered,
                    COUNT(CASE WHEN status = 'opened' THEN 1 END) as emails_opened,
                    COUNT(CASE WHEN status = 'clicked' THEN 1 END) as emails_clicked,
                    COUNT(CASE WHEN status = 'replied' THEN 1 END) as emails_replied,
                    COUNT(CASE WHEN status = 'bounced' THEN 1 END) as emails_bounced,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as emails_failed
                FROM campaign_leads
                WHERE campaign_id = $1
            `, [campaignId]);
            
            return res.json({
                success: true,
                data: {
                    campaign: campaignResult.rows[0],
                    template: templateResult.rows[0] || null,
                    leads: leadsResult.rows,
                    analytics: analyticsResult.rows[0] || {
                        total_leads: 0,
                        emails_sent: 0,
                        emails_delivered: 0,
                        emails_opened: 0,
                        emails_clicked: 0,
                        emails_replied: 0,
                        emails_bounced: 0,
                        emails_failed: 0
                    }
                }
            });
            
        } catch (error) {
            console.error('Get campaign details error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch campaign details'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Update campaign information
     * PUT /api/campaigns/:id
     */
    async updateCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const {
                name,
                description,
                from_name: fromName,
                from_email: fromEmail,
                reply_to_email: replyToEmail,
                scheduled_at: scheduledAt,
                send_immediately: sendImmediately,
                timezone,
                daily_send_limit: dailySendLimit
            } = req.body;

            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }

            // Get user's organization and verify campaign access
            const campaignResult = await client.query(`
                SELECT c.*, om.organization_id as user_org
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            const campaign = campaignResult.rows[0];

            // Prevent editing of active campaigns with sent emails
            if (campaign.status === 'active' && campaign.emails_sent > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot edit campaign that has already sent emails'
                });
            }

            // Build update query dynamically based on provided fields
            const updateFields = [];
            const updateValues = [];
            let paramCounter = 1;

            if (name !== undefined) {
                if (!name.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: 'Campaign name cannot be empty'
                    });
                }
                updateFields.push(`name = $${paramCounter++}`);
                updateValues.push(name.trim());
            }

            if (description !== undefined) {
                updateFields.push(`description = $${paramCounter++}`);
                updateValues.push(description?.trim() || null);
            }

            if (fromName !== undefined) {
                updateFields.push(`from_name = $${paramCounter++}`);
                updateValues.push(fromName?.trim() || null);
            }

            if (fromEmail !== undefined) {
                if (fromEmail && !fromEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid from email format'
                    });
                }
                updateFields.push(`from_email = $${paramCounter++}`);
                updateValues.push(fromEmail?.trim() || null);
            }

            if (replyToEmail !== undefined) {
                if (replyToEmail && !replyToEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid reply-to email format'
                    });
                }
                updateFields.push(`reply_to_email = $${paramCounter++}`);
                updateValues.push(replyToEmail?.trim() || null);
            }

            if (scheduledAt !== undefined) {
                updateFields.push(`scheduled_at = $${paramCounter++}`);
                updateValues.push(scheduledAt);
            }

            if (sendImmediately !== undefined) {
                updateFields.push(`send_immediately = $${paramCounter++}`);
                updateValues.push(sendImmediately);
            }

            if (timezone !== undefined) {
                updateFields.push(`timezone = $${paramCounter++}`);
                updateValues.push(timezone);
            }

            if (dailySendLimit !== undefined) {
                if (dailySendLimit < 1 || dailySendLimit > 1000) {
                    return res.status(400).json({
                        success: false,
                        message: 'Daily send limit must be between 1 and 1000'
                    });
                }
                updateFields.push(`daily_send_limit = $${paramCounter++}`);
                updateValues.push(dailySendLimit);
            }

            if (updateFields.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No fields to update'
                });
            }

            // Add updated_by and updated_at
            updateFields.push(`updated_by = $${paramCounter++}`);
            updateValues.push(userId);
            updateFields.push(`updated_at = NOW()`);

            // Add campaign ID for WHERE clause
            updateValues.push(campaignId);

            const updateQuery = `
                UPDATE campaigns 
                SET ${updateFields.join(', ')}
                WHERE id = $${paramCounter}
                RETURNING *
            `;

            const result = await client.query(updateQuery, updateValues);

            return res.json({
                success: true,
                message: 'Campaign updated successfully',
                data: {
                    campaign: result.rows[0]
                }
            });

        } catch (error) {
            console.error('Update campaign error:', error);
            
            // Handle unique constraint violations
            if (error.code === '23505') {
                return res.status(400).json({
                    success: false,
                    message: 'A campaign with this name already exists'
                });
            }
            
            return res.status(500).json({
                success: false,
                message: 'Failed to update campaign'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Update campaign status
     * PUT /api/campaigns/:id/status
     */
    async updateCampaignStatus(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const { status } = req.body;

            // Validate inputs
            const validStatuses = ['draft', 'active', 'paused', 'completed', 'archived'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }

            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }

            // Verify campaign access and get current status
            const campaignResult = await client.query(`
                SELECT c.*, om.organization_id as user_org
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            const campaign = campaignResult.rows[0];

            // Validate status transitions
            const currentStatus = campaign.status;
            const validTransitions = {
                'draft': ['active', 'archived'],
                'active': ['paused', 'completed', 'archived'],
                'paused': ['active', 'completed', 'archived'],
                'completed': ['archived'],
                'archived': [] // Cannot transition from archived
            };

            if (!validTransitions[currentStatus]?.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot change status from ${currentStatus} to ${status}`
                });
            }

            // Additional validation for activating campaigns
            if (status === 'active') {
                // Check if campaign has a template
                const templateResult = await client.query(`
                    SELECT id FROM campaign_templates
                    WHERE campaign_id = $1 AND is_active = true
                    LIMIT 1
                `, [campaignId]);

                if (templateResult.rows.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Campaign must have an email template before activation'
                    });
                }

                // Check if campaign has leads
                const leadsResult = await client.query(`
                    SELECT COUNT(*) as lead_count
                    FROM campaign_leads
                    WHERE campaign_id = $1
                `, [campaignId]);

                if (parseInt(leadsResult.rows[0].lead_count) === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Campaign must have leads before activation'
                    });
                }
            }

            // Update campaign status
            const result = await client.query(`
                UPDATE campaigns 
                SET status = $1, updated_at = NOW(), updated_by = $2
                WHERE id = $3
                RETURNING *
            `, [status, userId, campaignId]);

            return res.json({
                success: true,
                message: `Campaign ${status} successfully`,
                data: {
                    campaign: result.rows[0]
                }
            });

        } catch (error) {
            console.error('Update campaign status error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update campaign status'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Add leads to campaign
     * POST /api/campaigns/:id/leads
     */
    async addLeadsToCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const { leadIds } = req.body;

            // Input validation
            if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Lead IDs array is required and cannot be empty'
                });
            }

            if (leadIds.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot add more than 1000 leads at once'
                });
            }

            // Validate UUID format for campaign
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }

            // Validate all lead IDs
            for (const leadId of leadIds) {
                if (!uuidRegex.test(leadId)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid lead ID format: ${leadId}`
                    });
                }
            }

            // Verify campaign access
            const campaignResult = await client.query(`
                SELECT c.*, om.organization_id as user_org
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            const campaign = campaignResult.rows[0];

            await client.query('BEGIN');

            let addedCount = 0;
            let skippedCount = 0;
            const errors = [];

            for (const leadId of leadIds) {
                try {
                    // Check if lead exists and belongs to organization
                    const leadResult = await client.query(`
                        SELECT id, email, first_name, last_name, company_name
                        FROM leads 
                        WHERE id = $1 AND organization_id = $2
                    `, [leadId, campaign.organization_id]);

                    if (leadResult.rows.length === 0) {
                        errors.push(`Lead ${leadId} not found in organization`);
                        skippedCount++;
                        continue;
                    }

                    const lead = leadResult.rows[0];

                    // Check if lead is already in campaign
                    const existingResult = await client.query(`
                        SELECT id FROM campaign_leads 
                        WHERE campaign_id = $1 AND lead_id = $2
                    `, [campaignId, leadId]);

                    if (existingResult.rows.length > 0) {
                        errors.push(`Lead ${lead.email} already in campaign`);
                        skippedCount++;
                        continue;
                    }

                    // Add lead to campaign
                    await client.query(`
                        INSERT INTO campaign_leads (
                            id, campaign_id, lead_id, status, custom_variables
                        ) VALUES ($1, $2, $3, $4, $5)
                    `, [uuidv4(), campaignId, leadId, 'pending', '{}']);

                    addedCount++;

                } catch (error) {
                    console.error(`Error adding lead ${leadId}:`, error);
                    errors.push(`Error adding lead ${leadId}: ${error.message}`);
                    skippedCount++;
                }
            }

            // Update campaign total leads count
            await client.query(`
                UPDATE campaigns 
                SET total_leads = (
                    SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1
                ),
                updated_at = NOW(),
                updated_by = $2
                WHERE id = $1
            `, [campaignId, userId]);

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: `Successfully added ${addedCount} leads. ${skippedCount} leads were skipped.`,
                data: {
                    added: addedCount,
                    skipped: skippedCount,
                    errors: errors.slice(0, 10) // Limit error messages to prevent large responses
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Add leads to campaign error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to add leads to campaign'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Launch campaign - create email jobs for all pending leads
     * POST /api/campaigns/:id/launch
     * Body: { sendType: 'immediate' | 'scheduled', scheduledFor?: date, rateLimit?: number }
     */
    async launchCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const { 
                sendType = 'immediate', 
                scheduledFor, 
                rateLimit = 100 
            } = req.body;

            // Validate campaign access and get campaign details
            const campaignResult = await client.query(`
                SELECT c.*, ct.subject, ct.body_html, ct.body_text,
                       om.organization_id as user_org
                FROM campaigns c
                LEFT JOIN campaign_templates ct ON c.id = ct.campaign_id AND ct.is_active = true
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }
            
            const campaign = campaignResult.rows[0];
            
            // Handle mass email rate limiting
            let finalRateLimit = rateLimit;
            if (campaign.is_mass_email) {
                finalRateLimit = campaign.mass_email_concurrency || 100;
                console.log(`🚀 Mass email mode activated! Concurrency: ${finalRateLimit} emails`);
            } else {
                console.log(`📈 Distributed sending mode. Rate limit: ${finalRateLimit} emails/hour`);
            }
            
            // Debug: Log campaign template data
            console.log('📧 Campaign template data:', {
                subject: campaign.subject,
                hasHtmlBody: !!campaign.body_html,
                hasTextBody: !!campaign.body_text,
                htmlBodyLength: campaign.body_html ? campaign.body_html.length : 0,
                isMassEmail: campaign.is_mass_email,
                massEmailConcurrency: campaign.mass_email_concurrency
            });
            
            // Check if campaign has a template
            if (!campaign.subject || (!campaign.body_html && !campaign.body_text)) {
                return res.status(400).json({
                    success: false,
                    message: 'Campaign template is missing. Please add an email template before launching.'
                });
            }
            
            // Check if campaign can be launched
            if (campaign.status !== 'active') {
                return res.status(400).json({
                    success: false,
                    message: 'Only active campaigns can be launched'
                });
            }
            
            // Get pending leads for this campaign (including custom fields)
            const leadsResult = await client.query(`
                SELECT cl.*, l.email, l.first_name, l.last_name, l.company_name, l.job_title,
                       l.phone, l.website, l.custom_fields, l.original_row_data
                FROM campaign_leads cl
                JOIN leads l ON cl.lead_id = l.id
                WHERE cl.campaign_id = $1 AND cl.status = 'pending'
            `, [campaignId]);
            
            if (leadsResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No pending leads found for this campaign'
                });
            }
            
            // Get email account for sending
            const emailAccountResult = await client.query(`
                SELECT * FROM email_accounts 
                WHERE email = $1 AND status = 'active'
                LIMIT 1
            `, [campaign.from_email]);
            
            if (emailAccountResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No active email account found for the from address'
                });
            }
            
            const emailAccount = emailAccountResult.rows[0];
            
            // Prepare recipients for EmailJobService
            const recipients = [];
            
            // Process each pending lead and prepare personalized emails
            for (const lead of leadsResult.rows) {
                try {
                    // Personalize the email content
                    let subject = campaign.subject || 'Message from Campaign';
                    let bodyHtml = campaign.body_html || '<p>Hello {{first_name}},</p><p>This is a message from our campaign.</p>';
                    let bodyText = campaign.body_text || 'Hello {{first_name}}, This is a message from our campaign.';
                    
                    // Replace placeholders with comprehensive mappings
                    const replacements = {
                        // First Name variations
                        '{{first_name}}': lead.first_name || '',
                        '{{firstName}}': lead.first_name || '',
                        
                        // Last Name variations
                        '{{last_name}}': lead.last_name || '',
                        '{{lastName}}': lead.last_name || '',
                        
                        // Email
                        '{{email}}': lead.email || '',
                        
                        // Company variations
                        '{{company}}': lead.company_name || '',
                        '{{company_name}}': lead.company_name || '',
                        '{{companyName}}': lead.company_name || '',
                        
                        // Job Title variations
                        '{{job_title}}': lead.job_title || '',
                        '{{jobTitle}}': lead.job_title || '',
                        
                        // Phone
                        '{{phone}}': lead.phone || '',
                        
                        // Website
                        '{{website}}': lead.website || '',
                        
                        // From Name variations
                        '{{from_name}}': campaign.from_name || '',
                        '{{fromName}}': campaign.from_name || ''
                    };

                    // Add custom fields from lead's custom_fields JSONB column
                    if (lead.custom_fields && typeof lead.custom_fields === 'object') {
                        Object.entries(lead.custom_fields).forEach(([fieldName, fieldValue]) => {
                            const placeholder = `{{${fieldName}}}`;
                            replacements[placeholder] = fieldValue || '';
                        });
                    }

                    // BACKWARD COMPATIBILITY: Also check original_row_data for custom fields
                    // (for leads imported before the custom_fields fix)
                    if (lead.original_row_data && typeof lead.original_row_data === 'object') {
                        const standardFields = new Set([
                            'email', 'first_name', 'last_name', 'phone', 'company_name', 
                            'job_title', 'website', 'linkedin_url', 'status', 'tags', 'full_name'
                        ]);
                        
                        Object.entries(lead.original_row_data).forEach(([fieldName, fieldValue]) => {
                            // Only use custom fields that aren't already in custom_fields column
                            const placeholder = `{{${fieldName}}}`;
                            if (!standardFields.has(fieldName) && !replacements[placeholder] && fieldValue) {
                                replacements[placeholder] = fieldValue;
                            }
                        });
                    }
                    
                    // Apply all replacements
                    Object.entries(replacements).forEach(([placeholder, value]) => {
                        const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
                        subject = subject.replace(regex, value);
                        bodyHtml = bodyHtml.replace(regex, value);
                        bodyText = bodyText.replace(regex, value);
                    });
                    
                    // Add to recipients list with personalized content
                    recipients.push({
                        leadId: lead.id,
                        email: lead.email,
                        personalizedSubject: subject,
                        personalizedBodyHtml: bodyHtml,
                        personalizedBodyText: bodyText,
                        firstName: lead.first_name,
                        lastName: lead.last_name,
                        company: lead.company_name
                    });
                    
                } catch (error) {
                    console.error(`Failed to personalize email for ${lead.email}:`, error);
                    // Skip this lead but continue with others
                    continue;
                }
            }
            
            if (recipients.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No valid recipients found after processing leads'
                });
            }
            
            // Create email jobs using EmailJobService
            const jobParams = {
                campaignId,
                organizationId: campaign.user_org,
                recipients,
                rateLimit: finalRateLimit,
                createdBy: userId,
                // Use the campaign template as base (will be overridden by personalized content)
                subject: campaign.subject,
                bodyHtml: campaign.body_html,
                bodyText: campaign.body_text,
                // Mass email configuration
                isMassEmail: campaign.is_mass_email,
                massEmailConcurrency: campaign.mass_email_concurrency
            };
            
            let jobResult;
            if (sendType === 'scheduled' && scheduledFor) {
                // Create scheduled jobs
                jobResult = await emailJobService.createScheduledJobs({
                    ...jobParams,
                    scheduledFor: new Date(scheduledFor)
                });
            } else {
                // Create immediate jobs (default)
                jobResult = await emailJobService.createImmediateJobs(jobParams);
            }
            
            // Update campaign status to active (since we're launching it)
            await client.query(`
                UPDATE campaigns 
                SET status = 'active',
                    updated_at = NOW()
                WHERE id = $1
            `, [campaignId]);
            
            return res.status(200).json({
                success: true,
                message: `Campaign launched successfully! ${jobResult.jobsCreated} email jobs created.${campaign.is_mass_email ? ' 🚀 Mass email mode enabled!' : ' 📈 Distributed sending mode.'}`,
                data: {
                    campaignId,
                    sendType,
                    scheduledFor: sendType === 'scheduled' ? scheduledFor : null,
                    jobsCreated: jobResult.jobsCreated,
                    totalRecipients: recipients.length,
                    rateLimit: finalRateLimit,
                    isMassEmail: campaign.is_mass_email,
                    massEmailConcurrency: campaign.mass_email_concurrency,
                    estimatedCompletionTime: jobResult.estimatedCompletion,
                    scheduleInfo: jobResult.scheduleInfo
                }
            });
            
        } catch (error) {
            console.error('Launch campaign error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to launch campaign'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Remove leads from campaign
     * DELETE /api/campaigns/:id/leads
     */
    async removeLeadsFromCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const { leadIds } = req.body;

            // Input validation
            if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Lead IDs array is required and cannot be empty'
                });
            }

            // Validate UUID formats
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }

            for (const leadId of leadIds) {
                if (!uuidRegex.test(leadId)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid lead ID format: ${leadId}`
                    });
                }
            }

            // Verify campaign access
            const campaignResult = await client.query(`
                SELECT c.*, om.organization_id as user_org
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            const campaign = campaignResult.rows[0];

            // Prevent removing leads from active campaigns with sent emails
            if (campaign.status === 'active' && campaign.emails_sent > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot remove leads from campaign that has already sent emails'
                });
            }

            await client.query('BEGIN');

            // Remove leads from campaign
            const placeholders = leadIds.map((_, index) => `$${index + 2}`).join(',');
            const result = await client.query(`
                DELETE FROM campaign_leads 
                WHERE campaign_id = $1 AND lead_id IN (${placeholders})
            `, [campaignId, ...leadIds]);

            // Update campaign total leads count
            await client.query(`
                UPDATE campaigns 
                SET total_leads = (
                    SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1
                ),
                updated_at = NOW(),
                updated_by = $2
                WHERE id = $1
            `, [campaignId, userId]);

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: `Successfully removed ${result.rowCount} leads from campaign`,
                data: {
                    removedCount: result.rowCount
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Remove leads from campaign error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to remove leads from campaign'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get dashboard analytics (organization-wide)
     * GET /api/campaigns/dashboard/analytics
     */
    async getDashboardAnalytics(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;

            // Get user's organization
            const orgResult = await client.query(`
                SELECT organization_id 
                FROM organization_members 
                WHERE user_id = $1 AND status = 'active'
            `, [userId]);

            if (orgResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Organization not found'
                });
            }

            const organizationId = orgResult.rows[0].organization_id;

            // Get campaign statistics
            const campaignStatsResult = await client.query(`
                SELECT 
                    COUNT(*) as total_campaigns,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_campaigns,
                    COUNT(CASE WHEN status = 'paused' THEN 1 END) as paused_campaigns,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_campaigns,
                    COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_campaigns
                FROM campaigns 
                WHERE organization_id = $1
            `, [organizationId]);

            // Get lead statistics across all campaigns
            const leadStatsResult = await client.query(`
                SELECT 
                    COUNT(DISTINCT cl.lead_id) as total_leads,
                    COUNT(CASE WHEN cl.status = 'sent' THEN 1 END) as emails_sent,
                    COUNT(CASE WHEN cl.status = 'delivered' THEN 1 END) as emails_delivered,
                    COUNT(CASE WHEN cl.status = 'opened' THEN 1 END) as emails_opened,
                    COUNT(CASE WHEN cl.status = 'clicked' THEN 1 END) as emails_clicked,
                    COUNT(CASE WHEN cl.status = 'replied' THEN 1 END) as emails_replied,
                    COUNT(CASE WHEN cl.status = 'bounced' THEN 1 END) as emails_bounced
                FROM campaign_leads cl
                JOIN campaigns c ON cl.campaign_id = c.id
                WHERE c.organization_id = $1
            `, [organizationId]);

            // Get recent activity (last 30 days)
            const recentActivityResult = await client.query(`
                SELECT 
                    DATE(cl.sent_at) as date,
                    COUNT(*) as emails_sent,
                    COUNT(CASE WHEN cl.opened_at IS NOT NULL THEN 1 END) as emails_opened,
                    COUNT(CASE WHEN cl.clicked_at IS NOT NULL THEN 1 END) as emails_clicked,
                    COUNT(CASE WHEN cl.replied_at IS NOT NULL THEN 1 END) as emails_replied
                FROM campaign_leads cl
                JOIN campaigns c ON cl.campaign_id = c.id
                WHERE c.organization_id = $1 
                    AND cl.sent_at >= NOW() - INTERVAL '30 days'
                    AND cl.sent_at IS NOT NULL
                GROUP BY DATE(cl.sent_at)
                ORDER BY DATE(cl.sent_at) DESC
                LIMIT 30
            `, [organizationId]);

            // Get top performing campaigns
            const topCampaignsResult = await client.query(`
                SELECT 
                    c.id,
                    c.name,
                    c.status,
                    COUNT(cl.lead_id) as total_leads,
                    COUNT(CASE WHEN cl.status = 'sent' THEN 1 END) as emails_sent,
                    COUNT(CASE WHEN cl.status = 'opened' THEN 1 END) as emails_opened,
                    COUNT(CASE WHEN cl.status = 'replied' THEN 1 END) as emails_replied,
                    CASE 
                        WHEN COUNT(CASE WHEN cl.status = 'sent' THEN 1 END) > 0 
                        THEN ROUND(COUNT(CASE WHEN cl.status = 'opened' THEN 1 END) * 100.0 / COUNT(CASE WHEN cl.status = 'sent' THEN 1 END), 2)
                        ELSE 0 
                    END as open_rate
                FROM campaigns c
                LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
                WHERE c.organization_id = $1
                GROUP BY c.id, c.name, c.status
                ORDER BY emails_sent DESC
                LIMIT 5
            `, [organizationId]);

            const campaignStats = campaignStatsResult.rows[0];
            const leadStats = leadStatsResult.rows[0];

            // Calculate rates
            const emailsSent = parseInt(leadStats.emails_sent) || 0;
            const openRate = emailsSent > 0 ? (parseInt(leadStats.emails_opened) / emailsSent * 100) : 0;
            const clickRate = emailsSent > 0 ? (parseInt(leadStats.emails_clicked) / emailsSent * 100) : 0;
            const replyRate = emailsSent > 0 ? (parseInt(leadStats.emails_replied) / emailsSent * 100) : 0;

            // Calculate opportunities (simplified - replied emails * average deal size)
            const avgDealSize = 2500; // This could be configurable per organization
            const opportunities = parseInt(leadStats.emails_replied) * avgDealSize;

            return res.json({
                success: true,
                data: {
                    overview: {
                        total_campaigns: parseInt(campaignStats.total_campaigns),
                        active_campaigns: parseInt(campaignStats.active_campaigns),
                        total_leads: parseInt(leadStats.total_leads),
                        emails_sent: parseInt(leadStats.emails_sent),
                        open_rate: Math.round(openRate * 100) / 100,
                        click_rate: Math.round(clickRate * 100) / 100,
                        reply_rate: Math.round(replyRate * 100) / 100,
                        opportunities: opportunities
                    },
                    campaign_breakdown: {
                        active: parseInt(campaignStats.active_campaigns),
                        paused: parseInt(campaignStats.paused_campaigns),
                        completed: parseInt(campaignStats.completed_campaigns),
                        draft: parseInt(campaignStats.draft_campaigns)
                    },
                    recent_activity: recentActivityResult.rows,
                    top_campaigns: topCampaignsResult.rows
                }
            });

        } catch (error) {
            console.error('Get dashboard analytics error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch dashboard analytics'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get campaign analytics
     * GET /api/campaigns/:id/analytics
     */
    async getCampaignAnalytics(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;

            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }

            // Verify campaign access
            const campaignResult = await client.query(`
                SELECT c.id, c.name, c.created_at
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            // Get detailed analytics
            const analyticsResult = await client.query(`
                SELECT 
                    COUNT(*) as total_leads,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_leads,
                    COUNT(CASE WHEN status = 'sent' THEN 1 END) as emails_sent,
                    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as emails_delivered,
                    COUNT(CASE WHEN status = 'opened' THEN 1 END) as emails_opened,
                    COUNT(CASE WHEN status = 'clicked' THEN 1 END) as emails_clicked,
                    COUNT(CASE WHEN status = 'replied' THEN 1 END) as emails_replied,
                    COUNT(CASE WHEN status = 'bounced' THEN 1 END) as emails_bounced,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as emails_failed,
                    MIN(sent_at) as first_sent_at,
                    MAX(sent_at) as last_sent_at
                FROM campaign_leads
                WHERE campaign_id = $1
            `, [campaignId]);

            // Get status distribution over time (daily breakdown)
            const timelineResult = await client.query(`
                SELECT 
                    DATE(sent_at) as date,
                    COUNT(*) as emails_sent,
                    COUNT(CASE WHEN delivered_at IS NOT NULL THEN 1 END) as emails_delivered,
                    COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as emails_opened,
                    COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as emails_clicked
                FROM campaign_leads
                WHERE campaign_id = $1 AND sent_at IS NOT NULL
                GROUP BY DATE(sent_at)
                ORDER BY DATE(sent_at)
            `, [campaignId]);

            const analytics = analyticsResult.rows[0];
            
            // Calculate rates
            const emailsSent = parseInt(analytics.emails_sent) || 0;
            const deliveryRate = emailsSent > 0 ? (parseInt(analytics.emails_delivered) / emailsSent * 100) : 0;
            const openRate = emailsSent > 0 ? (parseInt(analytics.emails_opened) / emailsSent * 100) : 0;
            const clickRate = emailsSent > 0 ? (parseInt(analytics.emails_clicked) / emailsSent * 100) : 0;
            const replyRate = emailsSent > 0 ? (parseInt(analytics.emails_replied) / emailsSent * 100) : 0;
            const bounceRate = emailsSent > 0 ? (parseInt(analytics.emails_bounced) / emailsSent * 100) : 0;

            return res.json({
                success: true,
                data: {
                    campaign: campaignResult.rows[0],
                    analytics: {
                        ...analytics,
                        delivery_rate: Math.round(deliveryRate * 100) / 100,
                        open_rate: Math.round(openRate * 100) / 100,
                        click_rate: Math.round(clickRate * 100) / 100,
                        reply_rate: Math.round(replyRate * 100) / 100,
                        bounce_rate: Math.round(bounceRate * 100) / 100
                    },
                    timeline: timelineResult.rows
                }
            });

        } catch (error) {
            console.error('Get campaign analytics error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch campaign analytics'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Delete campaign
     * DELETE /api/campaigns/:id
     */
    async deleteCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;

            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(campaignId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid campaign ID format'
                });
            }

            // Verify campaign access
            const campaignResult = await client.query(`
                SELECT c.*, om.organization_id as user_org
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            const campaign = campaignResult.rows[0];

            // Prevent deletion of active campaigns with sent emails
            if (campaign.status === 'active' && campaign.emails_sent > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete campaign that has sent emails. Archive it instead.'
                });
            }

            await client.query('BEGIN');

            // Delete campaign (CASCADE will handle related records)
            await client.query('DELETE FROM campaigns WHERE id = $1', [campaignId]);

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: 'Campaign deleted successfully'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Delete campaign error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to delete campaign'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Track email opens (pixel tracking)
     * GET /api/campaigns/track/open/:trackingId
     */
    async trackEmailOpen(req, res) {
        const client = await pool.connect();
        
        try {
            const { trackingId } = req.params;
            
            if (!trackingId) {
                return res.status(400).json({
                    success: false,
                    message: 'Tracking ID is required'
                });
            }

            // Find the campaign lead by tracking ID
            const leadResult = await client.query(`
                SELECT cl.id, cl.campaign_id, cl.lead_id, cl.status
                FROM campaign_leads cl
                WHERE cl.id = $1
            `, [trackingId]);

            if (leadResult.rows.length === 0) {
                // Return 1x1 transparent pixel even if tracking fails
                const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
                res.set('Content-Type', 'image/gif');
                res.set('Content-Length', pixel.length);
                res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
                return res.send(pixel);
            }

            const campaignLead = leadResult.rows[0];

            // Update the lead status to 'opened' if not already opened
            if (campaignLead.status === 'sent' || campaignLead.status === 'delivered') {
                await client.query(`
                    UPDATE campaign_leads 
                    SET 
                        status = 'opened',
                        opened_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1
                `, [trackingId]);

                // Update campaign counters
                await client.query(`
                    UPDATE campaigns 
                    SET emails_opened = emails_opened + 1
                    WHERE id = $1
                `, [campaignLead.campaign_id]);

                console.log(`📧 Email opened: Campaign ${campaignLead.campaign_id}, Lead ${campaignLead.lead_id}`);
            }

            // Return 1x1 transparent pixel
            const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
            res.set('Content-Type', 'image/gif');
            res.set('Content-Length', pixel.length);
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.send(pixel);

        } catch (error) {
            console.error('Track email open error:', error);
            
            // Still return pixel even on error
            const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
            res.set('Content-Type', 'image/gif');
            res.set('Content-Length', pixel.length);
            res.send(pixel);
        } finally {
            client.release();
        }
    }

    /**
     * Track email clicks (redirect tracking)
     * GET /api/campaigns/track/click/:trackingId/:linkId
     */
    async trackEmailClick(req, res) {
        const client = await pool.connect();
        
        try {
            const { trackingId, linkId } = req.params;
            const { url } = req.query;
            
            if (!trackingId || !url) {
                return res.status(400).json({
                    success: false,
                    message: 'Tracking ID and URL are required'
                });
            }

            // Find the campaign lead by tracking ID
            const leadResult = await client.query(`
                SELECT cl.id, cl.campaign_id, cl.lead_id, cl.status
                FROM campaign_leads cl
                WHERE cl.id = $1
            `, [trackingId]);

            if (leadResult.rows.length > 0) {
                const campaignLead = leadResult.rows[0];

                // Update the lead status to 'clicked' if not already
                if (['sent', 'delivered', 'opened'].includes(campaignLead.status)) {
                    await client.query(`
                        UPDATE campaign_leads 
                        SET 
                            status = 'clicked',
                            clicked_at = NOW(),
                            updated_at = NOW()
                        WHERE id = $1
                    `, [trackingId]);

                    // Update campaign counters
                    await client.query(`
                        UPDATE campaigns 
                        SET emails_clicked = emails_clicked + 1
                        WHERE id = $1
                    `, [campaignLead.campaign_id]);

                    console.log(`🔗 Email clicked: Campaign ${campaignLead.campaign_id}, Lead ${campaignLead.lead_id}, URL: ${url}`);
                }
            }

            // Redirect to the actual URL
            res.redirect(decodeURIComponent(url));

        } catch (error) {
            console.error('Track email click error:', error);
            
            // Redirect to URL even on error
            const redirectUrl = req.query.url ? decodeURIComponent(req.query.url) : 'https://google.com';
            res.redirect(redirectUrl);
        } finally {
            client.release();
        }
    }
}

module.exports = new CampaignsController();
