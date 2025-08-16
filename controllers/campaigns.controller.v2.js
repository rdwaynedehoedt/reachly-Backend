const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Enhanced Campaigns Controller - Instantly.ai style
 * Based on https://developer.instantly.ai/api/v2/campaign/createcampaign
 */
class CampaignsControllerV2 {

    /**
     * Get all campaigns for the user's organization
     * GET /api/campaigns
     */
    async getCampaigns(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            
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
            
            // Get campaigns with analytics (enhanced query)
            const campaignsResult = await client.query(`
                SELECT 
                    c.*,
                    u1.first_name as created_by_first_name,
                    u1.last_name as created_by_last_name,
                    COUNT(DISTINCT cl.id) as total_leads,
                    COUNT(DISTINCT cs.id) as sequence_steps,
                    COUNT(DISTINCT CASE WHEN cl.status = 'active' THEN cl.id END) as active_leads,
                    COUNT(DISTINCT CASE WHEN cl.status = 'completed' THEN cl.id END) as completed_leads
                FROM campaigns c
                LEFT JOIN users u1 ON c.created_by = u1.id
                LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
                LEFT JOIN campaign_sequences cs ON c.id = cs.campaign_id
                WHERE c.organization_id = $1
                GROUP BY c.id, u1.first_name, u1.last_name
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
     * Create a new campaign (Instantly.ai style)
     * POST /api/campaigns
     */
    async createCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { 
                name,
                description,
                type = 'sequence',
                fromName,
                fromEmail,
                replyToEmail,
                startDate,
                endDate,
                timezone = 'UTC',
                scheduleDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                scheduleStartTime = '09:00:00',
                scheduleEndTime = '18:00:00',
                dailySendLimit = 50,
                maxEmailsPerLead = 5,
                stopOnReply = false,
                linkTracking = true,
                openTracking = true,
                textOnly = false,
                settings = {}
            } = req.body;

            // Validation
            if (!name || !fromEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Campaign name and from email are required'
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

            await client.query('BEGIN');

            // Create campaign with all new fields
            const campaignId = uuidv4();
            const campaignResult = await client.query(`
                INSERT INTO campaigns (
                    id, organization_id, name, description, type, status,
                    from_name, from_email, reply_to_email,
                    start_date, end_date, timezone,
                    schedule_days, schedule_start_time, schedule_end_time,
                    daily_send_limit, max_emails_per_lead,
                    stop_on_reply, link_tracking, open_tracking, text_only,
                    settings, created_by, user_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
                RETURNING *
            `, [
                campaignId, organizationId, name, description, type, 'draft',
                fromName, fromEmail, replyToEmail,
                startDate, endDate, timezone,
                JSON.stringify(scheduleDays), scheduleStartTime, scheduleEndTime,
                dailySendLimit, maxEmailsPerLead,
                stopOnReply, linkTracking, openTracking, textOnly,
                JSON.stringify(settings), userId, userId
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
            return res.status(500).json({
                success: false,
                message: 'Failed to create campaign',
                error: error.message
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get campaign details with sequences and leads
     * GET /api/campaigns/:id
     */
    async getCampaignDetails(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            
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
            
            // Get campaign details
            const campaignResult = await client.query(`
                SELECT c.*, u.first_name, u.last_name
                FROM campaigns c
                LEFT JOIN users u ON c.created_by = u.id
                WHERE c.id = $1 AND c.organization_id = $2
            `, [campaignId, organizationId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }
            
            // Get campaign sequences
            const sequencesResult = await client.query(`
                SELECT * FROM campaign_sequences
                WHERE campaign_id = $1
                ORDER BY step_number ASC
            `, [campaignId]);
            
            // Get campaign leads with details
            const leadsResult = await client.query(`
                SELECT 
                    cl.*,
                    l.email, l.first_name, l.last_name, l.company_name, l.status as lead_status
                FROM campaign_leads cl
                JOIN leads l ON cl.lead_id = l.id
                WHERE cl.campaign_id = $1
                ORDER BY cl.enrolled_at DESC
            `, [campaignId]);
            
            return res.json({
                success: true,
                data: {
                    campaign: campaignResult.rows[0],
                    sequences: sequencesResult.rows,
                    leads: leadsResult.rows
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
     * Add sequence step to campaign (Instantly.ai style)
     * POST /api/campaigns/:id/sequences
     */
    async addSequenceStep(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const {
                name,
                subject,
                htmlContent,
                textContent,
                delayDays = 0,
                delayHours = 0,
                delayMinutes = 0
            } = req.body;

            // Validation
            if (!subject) {
                return res.status(400).json({
                    success: false,
                    message: 'Email subject is required'
                });
            }

            // Verify campaign access
            const orgResult = await client.query(`
                SELECT c.organization_id, om.organization_id as user_org
                FROM campaigns c
                JOIN organization_members om ON c.organization_id = om.organization_id
                WHERE c.id = $1 AND om.user_id = $2 AND om.status = 'active'
            `, [campaignId, userId]);
            
            if (orgResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found or access denied'
                });
            }

            // Get next step number
            const stepResult = await client.query(`
                SELECT COALESCE(MAX(step_number), 0) + 1 as next_step
                FROM campaign_sequences
                WHERE campaign_id = $1
            `, [campaignId]);
            
            const stepNumber = stepResult.rows[0].next_step;

            // Create sequence step
            const sequenceId = uuidv4();
            const sequenceResult = await client.query(`
                INSERT INTO campaign_sequences (
                    id, campaign_id, step_number, name, subject,
                    html_content, text_content, delay_days, delay_hours, delay_minutes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `, [
                sequenceId, campaignId, stepNumber, name, subject,
                htmlContent, textContent, delayDays, delayHours, delayMinutes
            ]);

            return res.status(201).json({
                success: true,
                message: 'Sequence step added successfully',
                data: {
                    sequence: sequenceResult.rows[0]
                }
            });

        } catch (error) {
            console.error('Add sequence step error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to add sequence step'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Add leads to campaign (Instantly.ai style)
     * POST /api/campaigns/:id/leads
     */
    async addLeadsToCampaign(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const { leadIds } = req.body;

            if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Lead IDs array is required'
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

            await client.query('BEGIN');

            let enrolledCount = 0;
            let skippedCount = 0;
            const errors = [];

            for (const leadId of leadIds) {
                try {
                    // Check if lead exists and belongs to organization
                    const leadResult = await client.query(`
                        SELECT id, email FROM leads 
                        WHERE id = $1 AND organization_id = $2
                    `, [leadId, campaign.organization_id]);

                    if (leadResult.rows.length === 0) {
                        errors.push(`Lead ${leadId} not found in organization`);
                        skippedCount++;
                        continue;
                    }

                    // Check if lead is already in campaign
                    const existingResult = await client.query(`
                        SELECT id FROM campaign_leads 
                        WHERE campaign_id = $1 AND lead_id = $2
                    `, [campaignId, leadId]);

                    if (existingResult.rows.length > 0) {
                        errors.push(`Lead ${leadResult.rows[0].email} already in campaign`);
                        skippedCount++;
                        continue;
                    }

                    // Calculate next send time based on campaign schedule
                    const nextSendAt = this.calculateNextSendTime(campaign);

                    // Add lead to campaign
                    await client.query(`
                        INSERT INTO campaign_leads (
                            id, campaign_id, lead_id, current_step, next_send_at
                        ) VALUES ($1, $2, $3, $4, $5)
                    `, [uuidv4(), campaignId, leadId, 1, nextSendAt]);

                    enrolledCount++;

                } catch (error) {
                    errors.push(`Error enrolling lead ${leadId}: ${error.message}`);
                    skippedCount++;
                }
            }

            // Update campaign total leads count
            await client.query(`
                UPDATE campaigns 
                SET total_leads = (
                    SELECT COUNT(*) FROM campaign_leads WHERE campaign_id = $1
                )
                WHERE id = $1
            `, [campaignId]);

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: `Successfully enrolled ${enrolledCount} leads. ${skippedCount} leads were skipped.`,
                data: {
                    enrolled: enrolledCount,
                    skipped: skippedCount,
                    errors: errors.slice(0, 10) // Limit error messages
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
     * Update campaign status (Instantly.ai style: activate, pause, etc.)
     * POST /api/campaigns/:id/activate or /api/campaigns/:id/pause
     */
    async updateCampaignStatus(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            const { status } = req.body;

            const validStatuses = ['draft', 'active', 'paused', 'completed', 'archived'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
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

            // Update campaign status
            const result = await client.query(`
                UPDATE campaigns 
                SET status = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING *
            `, [status, campaignId]);

            // If activating, we might want to queue emails
            if (status === 'active') {
                // This would trigger the email queue processing
                console.log(`Campaign ${campaignId} activated - emails will be processed by scheduler`);
            }

            return res.json({
                success: true,
                message: `Campaign ${status === 'active' ? 'activated' : status} successfully`,
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
     * Get campaign analytics (Instantly.ai style)
     * GET /api/campaigns/:id/analytics
     */
    async getCampaignAnalytics(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: campaignId } = req.params;
            
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

            // Get overall campaign stats
            const statsResult = await client.query(`
                SELECT 
                    COUNT(DISTINCT cl.id) as total_leads,
                    COUNT(DISTINCT CASE WHEN cl.status = 'active' THEN cl.id END) as active_leads,
                    COUNT(DISTINCT CASE WHEN cl.status = 'completed' THEN cl.id END) as completed_leads,
                    COUNT(DISTINCT es.id) as emails_sent,
                    COUNT(DISTINCT CASE WHEN es.status IN ('opened', 'clicked', 'replied') THEN es.id END) as emails_opened,
                    COUNT(DISTINCT CASE WHEN es.status IN ('clicked', 'replied') THEN es.id END) as emails_clicked,
                    COUNT(DISTINCT CASE WHEN es.status = 'replied' THEN es.id END) as emails_replied
                FROM campaign_leads cl
                LEFT JOIN email_sends es ON es.campaign_id = $1
                WHERE cl.campaign_id = $1
            `, [campaignId]);

            // Get sequence performance (Instantly.ai style)
            const sequenceStatsResult = await client.query(`
                SELECT 
                    cs.step_number,
                    cs.name as step_name,
                    cs.subject,
                    cs.emails_sent,
                    cs.emails_opened,
                    cs.emails_clicked,
                    cs.emails_replied
                FROM campaign_sequences cs
                WHERE cs.campaign_id = $1
                ORDER BY cs.step_number
            `, [campaignId]);

            const stats = statsResult.rows[0];
            const sequenceStats = sequenceStatsResult.rows;

            // Calculate rates like Instantly.ai
            const openRate = stats.emails_sent > 0 ? (stats.emails_opened / stats.emails_sent * 100) : 0;
            const clickRate = stats.emails_sent > 0 ? (stats.emails_clicked / stats.emails_sent * 100) : 0;
            const replyRate = stats.emails_sent > 0 ? (stats.emails_replied / stats.emails_sent * 100) : 0;

            return res.json({
                success: true,
                data: {
                    overview: {
                        ...stats,
                        open_rate: Math.round(openRate * 100) / 100,
                        click_rate: Math.round(clickRate * 100) / 100,
                        reply_rate: Math.round(replyRate * 100) / 100
                    },
                    sequences: sequenceStats.map(seq => ({
                        step: seq.step_number.toString(),
                        name: seq.step_name,
                        subject: seq.subject,
                        sent: parseInt(seq.emails_sent),
                        opened: parseInt(seq.emails_opened),
                        clicked: parseInt(seq.emails_clicked),
                        replied: parseInt(seq.emails_replied),
                        open_rate: seq.emails_sent > 0 ? Math.round((seq.emails_opened / seq.emails_sent * 100) * 100) / 100 : 0,
                        click_rate: seq.emails_sent > 0 ? Math.round((seq.emails_clicked / seq.emails_sent * 100) * 100) / 100 : 0,
                        reply_rate: seq.emails_sent > 0 ? Math.round((seq.emails_replied / seq.emails_sent * 100) * 100) / 100 : 0
                    }))
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
     * Helper method to calculate next send time based on campaign schedule
     */
    calculateNextSendTime(campaign) {
        const now = new Date();
        const scheduleDays = JSON.parse(campaign.schedule_days || '["monday","tuesday","wednesday","thursday","friday"]');
        const startTime = campaign.schedule_start_time || '09:00:00';
        
        // Simple logic: if today is a schedule day and within hours, send now, otherwise tomorrow at start time
        const today = now.toLocaleDateString('en-US', { weekday: 'lowercase' });
        const currentTime = now.toTimeString().slice(0, 8);
        
        if (scheduleDays.includes(today) && currentTime >= startTime && currentTime <= (campaign.schedule_end_time || '18:00:00')) {
            return now;
        } else {
            // Schedule for next available day
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0); // 9 AM next day
            return tomorrow;
        }
    }
}

module.exports = new CampaignsControllerV2();
