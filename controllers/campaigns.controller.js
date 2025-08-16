const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Campaigns Controller - Handles campaign management operations
 * Based on email marketing best practices and multi-step sequences
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
            
            // Get campaigns with analytics
            const campaignsResult = await client.query(`
                SELECT 
                    c.*,
                    u1.first_name as created_by_first_name,
                    u1.last_name as created_by_last_name,
                    COUNT(DISTINCT cl.id) as total_leads,
                    COUNT(DISTINCT cs.id) as sequence_steps
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
                maxEmailsPerLead = 5
            } = req.body;

            // Validation
            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Campaign name is required'
                });
            }

            if (!fromEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'From email is required'
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

            // Create campaign
            const campaignId = uuidv4();
            const campaignResult = await client.query(`
                INSERT INTO campaigns (
                    id, organization_id, name, description, type,
                    from_name, from_email, reply_to_email,
                    start_date, end_date, timezone,
                    schedule_days, schedule_start_time, schedule_end_time,
                    daily_send_limit, max_emails_per_lead, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING *
            `, [
                campaignId, organizationId, name, description, type,
                fromName, fromEmail, replyToEmail,
                startDate, endDate, timezone,
                JSON.stringify(scheduleDays), scheduleStartTime, scheduleEndTime,
                dailySendLimit, maxEmailsPerLead, userId
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
                message: 'Failed to create campaign'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get campaign details with sequences
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
            
            // Get campaign leads with status
            const leadsResult = await client.query(`
                SELECT 
                    cl.*,
                    l.email, l.first_name, l.last_name, l.company_name
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
     * Add sequence step to campaign
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
                delayMinutes = 0,
                sendConditions = {},
                personalizationFields = {}
            } = req.body;

            // Validation
            if (!subject) {
                return res.status(400).json({
                    success: false,
                    message: 'Email subject is required'
                });
            }

            // Get user's organization and verify campaign access
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

            // Verify campaign belongs to organization
            const campaignResult = await client.query(`
                SELECT id FROM campaigns 
                WHERE id = $1 AND organization_id = $2
            `, [campaignId, organizationId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
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
                    html_content, text_content, delay_days, delay_hours, delay_minutes,
                    send_conditions, personalization_fields
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *
            `, [
                sequenceId, campaignId, stepNumber, name, subject,
                htmlContent, textContent, delayDays, delayHours, delayMinutes,
                JSON.stringify(sendConditions), JSON.stringify(personalizationFields)
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
     * Add leads to campaign
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

            // Verify campaign belongs to organization
            const campaignResult = await client.query(`
                SELECT id, schedule_start_time, schedule_end_time, timezone
                FROM campaigns 
                WHERE id = $1 AND organization_id = $2
            `, [campaignId, organizationId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            await client.query('BEGIN');

            let enrolledCount = 0;
            let skippedCount = 0;

            for (const leadId of leadIds) {
                // Check if lead exists and belongs to organization
                const leadResult = await client.query(`
                    SELECT id FROM leads 
                    WHERE id = $1 AND organization_id = $2
                `, [leadId, organizationId]);

                if (leadResult.rows.length === 0) {
                    skippedCount++;
                    continue;
                }

                // Check if lead is already in campaign
                const existingResult = await client.query(`
                    SELECT id FROM campaign_leads 
                    WHERE campaign_id = $1 AND lead_id = $2
                `, [campaignId, leadId]);

                if (existingResult.rows.length > 0) {
                    skippedCount++;
                    continue;
                }

                // Calculate next send time (for first step, send immediately during business hours)
                const nextSendAt = new Date();
                nextSendAt.setHours(9, 0, 0, 0); // Start at 9 AM

                // Add lead to campaign
                await client.query(`
                    INSERT INTO campaign_leads (
                        id, campaign_id, lead_id, current_step, next_send_at
                    ) VALUES ($1, $2, $3, $4, $5)
                `, [uuidv4(), campaignId, leadId, 1, nextSendAt]);

                enrolledCount++;
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
                    skipped: skippedCount
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
     * Update campaign status
     * PUT /api/campaigns/:id/status
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

            // Update campaign status
            const result = await client.query(`
                UPDATE campaigns 
                SET status = $1, updated_by = $2
                WHERE id = $3 AND organization_id = $4
                RETURNING *
            `, [status, userId, campaignId, organizationId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
                });
            }

            return res.json({
                success: true,
                message: 'Campaign status updated successfully',
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
     * Get campaign analytics
     * GET /api/campaigns/:id/analytics
     */
    async getCampaignAnalytics(req, res) {
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

            // Verify campaign access
            const campaignResult = await client.query(`
                SELECT id FROM campaigns 
                WHERE id = $1 AND organization_id = $2
            `, [campaignId, organizationId]);
            
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Campaign not found'
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
                LEFT JOIN email_sends es ON es.campaign_id = $1 AND es.recipient_email = (
                    SELECT email FROM leads WHERE id = cl.lead_id
                )
                WHERE cl.campaign_id = $1
            `, [campaignId]);

            // Get sequence performance
            const sequenceStatsResult = await client.query(`
                SELECT 
                    cs.step_number,
                    cs.name as step_name,
                    cs.subject,
                    COUNT(DISTINCT es.id) as emails_sent,
                    COUNT(DISTINCT CASE WHEN es.status IN ('opened', 'clicked', 'replied') THEN es.id END) as emails_opened,
                    COUNT(DISTINCT CASE WHEN es.status IN ('clicked', 'replied') THEN es.id END) as emails_clicked,
                    COUNT(DISTINCT CASE WHEN es.status = 'replied' THEN es.id END) as emails_replied
                FROM campaign_sequences cs
                LEFT JOIN email_sends es ON es.campaign_id = $1 AND es.sequence_step = cs.step_number
                WHERE cs.campaign_id = $1
                GROUP BY cs.step_number, cs.name, cs.subject
                ORDER BY cs.step_number
            `, [campaignId]);

            const stats = statsResult.rows[0];
            const sequenceStats = sequenceStatsResult.rows;

            // Calculate rates
            const openRate = stats.emails_sent > 0 ? (stats.emails_opened / stats.emails_sent * 100).toFixed(2) : 0;
            const clickRate = stats.emails_sent > 0 ? (stats.emails_clicked / stats.emails_sent * 100).toFixed(2) : 0;
            const replyRate = stats.emails_sent > 0 ? (stats.emails_replied / stats.emails_sent * 100).toFixed(2) : 0;

            return res.json({
                success: true,
                data: {
                    overview: {
                        ...stats,
                        open_rate: parseFloat(openRate),
                        click_rate: parseFloat(clickRate),
                        reply_rate: parseFloat(replyRate)
                    },
                    sequences: sequenceStats.map(seq => ({
                        ...seq,
                        open_rate: seq.emails_sent > 0 ? parseFloat((seq.emails_opened / seq.emails_sent * 100).toFixed(2)) : 0,
                        click_rate: seq.emails_sent > 0 ? parseFloat((seq.emails_clicked / seq.emails_sent * 100).toFixed(2)) : 0,
                        reply_rate: seq.emails_sent > 0 ? parseFloat((seq.emails_replied / seq.emails_sent * 100).toFixed(2)) : 0
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
}

module.exports = new CampaignsController();
