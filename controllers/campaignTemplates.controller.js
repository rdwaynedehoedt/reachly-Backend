const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Campaign Templates Controller - Handles email template management for campaigns
 * Follows the established patterns and organization-level access control
 */
class CampaignTemplatesController {

    /**
     * Get template for a campaign
     * GET /api/campaigns/:campaignId/template
     */
    async getCampaignTemplate(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { campaignId } = req.params;

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
                SELECT c.id, c.organization_id
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

            // Get active template
            const templateResult = await client.query(`
                SELECT * FROM campaign_templates
                WHERE campaign_id = $1 AND is_active = true
                ORDER BY created_at DESC
                LIMIT 1
            `, [campaignId]);

            return res.json({
                success: true,
                data: {
                    template: templateResult.rows[0] || null
                }
            });

        } catch (error) {
            console.error('Get campaign template error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch campaign template'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Save/update template for a campaign
     * POST /api/campaigns/:campaignId/template
     */
    async saveCampaignTemplate(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { campaignId } = req.params;
            const { 
                name = 'Email Template',
                subject,
                bodyHtml,
                bodyText
            } = req.body;

            // Input validation
            if (!subject || !subject.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Email subject is required'
                });
            }

            if (!bodyHtml && !bodyText) {
                return res.status(400).json({
                    success: false,
                    message: 'Email content (HTML or text) is required'
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

            // Verify campaign access and check if it can be edited
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

            // Prevent editing template of active campaigns with sent emails
            if (campaign.status === 'active' && campaign.emails_sent > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot edit template of campaign that has already sent emails'
                });
            }

            await client.query('BEGIN');

            // Deactivate existing templates
            await client.query(`
                UPDATE campaign_templates 
                SET is_active = false 
                WHERE campaign_id = $1
            `, [campaignId]);

            // Create new active template
            const templateId = uuidv4();
            const templateResult = await client.query(`
                INSERT INTO campaign_templates (
                    id, campaign_id, name, subject, body_html, body_text, is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                templateId, 
                campaignId, 
                name.trim(), 
                subject.trim(), 
                bodyHtml?.trim() || null, 
                bodyText?.trim() || null, 
                true
            ]);

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: 'Template saved successfully',
                data: {
                    template: templateResult.rows[0]
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Save campaign template error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to save campaign template'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Preview template with sample personalization
     * POST /api/campaigns/:campaignId/template/preview
     */
    async previewTemplate(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { campaignId } = req.params;
            const { 
                subject,
                bodyHtml,
                bodyText,
                sampleData = {}
            } = req.body;

            // Input validation
            if (!subject) {
                return res.status(400).json({
                    success: false,
                    message: 'Subject is required for preview'
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

            // Verify campaign access
            const campaignResult = await client.query(`
                SELECT c.id
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

            // Default sample data
            const defaultSampleData = {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@example.com',
                company: 'Example Corp',
                jobTitle: 'Marketing Manager',
                ...sampleData
            };

            // Personalize content
            const personalizedSubject = this.personalizeContent(subject, defaultSampleData);
            const personalizedBodyHtml = bodyHtml ? this.personalizeContent(bodyHtml, defaultSampleData) : null;
            const personalizedBodyText = bodyText ? this.personalizeContent(bodyText, defaultSampleData) : null;

            return res.json({
                success: true,
                data: {
                    preview: {
                        subject: personalizedSubject,
                        bodyHtml: personalizedBodyHtml,
                        bodyText: personalizedBodyText,
                        sampleData: defaultSampleData
                    }
                }
            });

        } catch (error) {
            console.error('Preview template error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate template preview'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Delete campaign template
     * DELETE /api/campaigns/:campaignId/template
     */
    async deleteCampaignTemplate(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { campaignId } = req.params;

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

            // Prevent deleting template of active campaigns
            if (campaign.status === 'active') {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete template of active campaign'
                });
            }

            // Delete all templates for this campaign
            const result = await client.query(`
                DELETE FROM campaign_templates 
                WHERE campaign_id = $1
            `, [campaignId]);

            return res.json({
                success: true,
                message: 'Template deleted successfully',
                data: {
                    deletedCount: result.rowCount
                }
            });

        } catch (error) {
            console.error('Delete template error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to delete template'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Helper method to personalize email content
     * Replaces placeholders like {{firstName}} with actual values
     */
    personalizeContent(content, data) {
        if (!content) return content;

        let personalizedContent = content;

        // Standard personalization variables
        const replacements = {
            '{{firstName}}': data.firstName || '',
            '{{lastName}}': data.lastName || '',
            '{{fullName}}': `${data.firstName || ''} ${data.lastName || ''}`.trim(),
            '{{email}}': data.email || '',
            '{{company}}': data.company || '',
            '{{companyName}}': data.company || '',
            '{{jobTitle}}': data.jobTitle || '',
            '{{title}}': data.jobTitle || ''
        };

        // Apply standard replacements
        for (const [placeholder, value] of Object.entries(replacements)) {
            const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
            personalizedContent = personalizedContent.replace(regex, value);
        }

        // Apply custom field replacements
        for (const [key, value] of Object.entries(data)) {
            if (!key.startsWith('_') && typeof value === 'string') {
                const placeholder = `{{${key}}}`;
                const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
                personalizedContent = personalizedContent.replace(regex, value);
            }
        }

        return personalizedContent;
    }

    /**
     * Get available personalization variables
     * GET /api/campaigns/:campaignId/template/variables
     */
    async getPersonalizationVariables(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { campaignId } = req.params;

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
                SELECT c.id, c.organization_id
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

            // Get organization's lead fields to determine available variables
            const fieldsResult = await client.query(`
                SELECT DISTINCT jsonb_object_keys(custom_fields) as field_name
                FROM leads 
                WHERE organization_id = $1 
                AND custom_fields IS NOT NULL 
                AND custom_fields != '{}'
            `, [campaignResult.rows[0].organization_id]);

            const customFields = fieldsResult.rows.map(row => row.field_name);

            // Standard variables
            const standardVariables = [
                { name: 'firstName', placeholder: '{{firstName}}', description: 'Lead\'s first name' },
                { name: 'lastName', placeholder: '{{lastName}}', description: 'Lead\'s last name' },
                { name: 'fullName', placeholder: '{{fullName}}', description: 'Lead\'s full name' },
                { name: 'email', placeholder: '{{email}}', description: 'Lead\'s email address' },
                { name: 'company', placeholder: '{{company}}', description: 'Lead\'s company name' },
                { name: 'jobTitle', placeholder: '{{jobTitle}}', description: 'Lead\'s job title' }
            ];

            // Custom field variables
            const customVariables = customFields.map(field => ({
                name: field,
                placeholder: `{{${field}}}`,
                description: `Custom field: ${field}`,
                isCustom: true
            }));

            return res.json({
                success: true,
                data: {
                    variables: {
                        standard: standardVariables,
                        custom: customVariables
                    }
                }
            });

        } catch (error) {
            console.error('Get personalization variables error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch personalization variables'
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new CampaignTemplatesController();
