const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Leads Controller - Handles lead management operations
 */
class LeadsController {

    /**
     * Get all leads for the user's organization
     * GET /api/leads
     */
    async getLeads(req, res) {
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
            
            // Get leads for the organization
            const leadsResult = await client.query(`
                SELECT 
                    l.*,
                    u1.first_name as created_by_first_name,
                    u1.last_name as created_by_last_name
                FROM leads l
                LEFT JOIN users u1 ON l.created_by = u1.id
                WHERE l.organization_id = $1
                ORDER BY l.created_at DESC
                LIMIT 1000
            `, [organizationId]);
            
            return res.json({
                success: true,
                data: {
                    leads: leadsResult.rows,
                    total: leadsResult.rows.length
                }
            });
            
        } catch (error) {
            console.error('Get leads error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch leads'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Add a single lead
     * POST /api/leads
     */
    async addLead(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { 
                email, 
                firstName, 
                lastName, 
                companyName, 
                jobTitle, 
                phone, 
                website, 
                linkedinUrl, 
                location,
                customFields = {}
            } = req.body;

            // Validation
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is required'
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

            // Check if lead already exists
            const existingLead = await client.query(`
                SELECT id FROM leads 
                WHERE organization_id = $1 AND email = $2
            `, [organizationId, email.toLowerCase()]);

            if (existingLead.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Lead with this email already exists'
                });
            }

            // Create new lead
            const leadId = uuidv4();
            const leadResult = await client.query(`
                INSERT INTO leads (
                    id, organization_id, email, first_name, last_name, 
                    company_name, job_title, phone, website, linkedin_url, 
                    location, custom_fields, source, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING *
            `, [
                leadId, organizationId, email.toLowerCase(), firstName, lastName,
                companyName, jobTitle, phone, website, linkedinUrl,
                location, JSON.stringify(customFields), 'manual', userId
            ]);

            return res.status(201).json({
                success: true,
                message: 'Lead created successfully',
                data: {
                    lead: leadResult.rows[0]
                }
            });

        } catch (error) {
            console.error('Add lead error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to add lead'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Import leads from CSV (placeholder)
     * POST /api/leads/import
     */
    async importLeads(req, res) {
        return res.status(501).json({
            success: false,
            message: 'CSV import functionality coming soon'
        });
    }

    /**
     * Get lead statistics
     * GET /api/leads/stats
     */
    async getLeadStats(req, res) {
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
            
            // Get lead statistics
            const statsResult = await client.query(`
                SELECT 
                    COUNT(*) as total_leads,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_leads,
                    COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted_leads,
                    COUNT(CASE WHEN status = 'replied' THEN 1 END) as replied_leads,
                    COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as leads_this_month
                FROM leads
                WHERE organization_id = $1
            `, [organizationId]);
            
            return res.json({
                success: true,
                data: statsResult.rows[0]
            });
            
        } catch (error) {
            console.error('Get lead stats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch lead statistics'
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new LeadsController();
