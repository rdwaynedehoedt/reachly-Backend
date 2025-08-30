const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Contact Lists Controller - Manages contact lists (similar to Mailchimp Audiences)
 * Industry standard approach for organizing contacts
 */
class ContactListsController {

    /**
     * Get all contact lists for the user's organization
     * GET /api/contact-lists
     */
    async getContactLists(req, res) {
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
            
            // Get contact lists with statistics
            const listsResult = await client.query(`
                SELECT 
                    cl.*,
                    u1.first_name as created_by_first_name,
                    u1.last_name as created_by_last_name,
                    COALESCE(cl.total_contacts, 0) as total_contacts,
                    COALESCE(cl.active_contacts, 0) as active_contacts,
                    COALESCE(cl.unsubscribed_contacts, 0) as unsubscribed_contacts
                FROM contact_lists cl
                LEFT JOIN users u1 ON cl.created_by = u1.id
                WHERE cl.organization_id = $1 AND cl.is_active = true
                ORDER BY cl.created_at DESC
            `, [organizationId]);
            
            return res.json({
                success: true,
                data: {
                    contactLists: listsResult.rows,
                    total: listsResult.rows.length
                }
            });
            
        } catch (error) {
            console.error('Get contact lists error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch contact lists'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Create a new contact list
     * POST /api/contact-lists
     */
    async createContactList(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { name, description, type = 'custom', allowDuplicateEmails = false } = req.body;
            
            if (!name?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Contact list name is required'
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
            
            // Check if list name already exists
            const existingList = await client.query(`
                SELECT id FROM contact_lists 
                WHERE organization_id = $1 AND name = $2 AND is_active = true
            `, [organizationId, name.trim()]);
            
            if (existingList.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'A contact list with this name already exists'
                });
            }
            
            // Create the contact list
            const listId = uuidv4();
            const insertResult = await client.query(`
                INSERT INTO contact_lists (
                    id, organization_id, name, description, type, 
                    allow_duplicate_emails, created_by, updated_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [
                listId, organizationId, name.trim(), description?.trim() || null, 
                type, allowDuplicateEmails, userId, userId
            ]);
            
            return res.status(201).json({
                success: true,
                message: 'Contact list created successfully',
                data: {
                    contactList: insertResult.rows[0]
                }
            });
            
        } catch (error) {
            console.error('Create contact list error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to create contact list'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Add contacts to a contact list
     * POST /api/contact-lists/:id/contacts
     */
    async addContactsToList(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: listId } = req.params;
            const { leadIds, source = 'manual' } = req.body;
            
            if (!Array.isArray(leadIds) || leadIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Lead IDs array is required'
                });
            }
            
            await client.query('BEGIN');
            
            // Verify the contact list exists and user has access
            const listResult = await client.query(`
                SELECT cl.id, cl.name, cl.organization_id
                FROM contact_lists cl
                JOIN organization_members om ON cl.organization_id = om.organization_id
                WHERE cl.id = $1 AND om.user_id = $2 AND om.status = 'active' AND cl.is_active = true
            `, [listId, userId]);
            
            if (listResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Contact list not found or access denied'
                });
            }
            
            const contactList = listResult.rows[0];
            
            let addedCount = 0;
            let skippedCount = 0;
            const errors = [];
            
            // Add each lead to the list
            for (const leadId of leadIds) {
                try {
                    // Check if lead exists and belongs to the organization
                    const leadResult = await client.query(`
                        SELECT id FROM leads 
                        WHERE id = $1 AND organization_id = $2
                    `, [leadId, contactList.organization_id]);
                    
                    if (leadResult.rows.length === 0) {
                        errors.push(`Lead ${leadId} not found`);
                        skippedCount++;
                        continue;
                    }
                    
                    // Check if lead is already in the list
                    const existingMember = await client.query(`
                        SELECT id FROM contact_list_members 
                        WHERE contact_list_id = $1 AND lead_id = $2
                    `, [listId, leadId]);
                    
                    if (existingMember.rows.length > 0) {
                        // Update existing member to active if it was inactive
                        await client.query(`
                            UPDATE contact_list_members 
                            SET status = 'active', subscribed_at = NOW(), updated_at = NOW()
                            WHERE contact_list_id = $1 AND lead_id = $2
                        `, [listId, leadId]);
                        addedCount++;
                    } else {
                        // Add new member to the list
                        await client.query(`
                            INSERT INTO contact_list_members (
                                id, contact_list_id, lead_id, status, source, added_by
                            ) VALUES ($1, $2, $3, 'active', $4, $5)
                        `, [uuidv4(), listId, leadId, source, userId]);
                        addedCount++;
                    }
                    
                } catch (error) {
                    console.error(`Error adding lead ${leadId}:`, error);
                    errors.push(`Error adding lead ${leadId}: ${error.message}`);
                    skippedCount++;
                }
            }
            
            await client.query('COMMIT');
            
            return res.json({
                success: true,
                message: `Successfully added ${addedCount} contacts to "${contactList.name}". ${skippedCount} contacts were skipped.`,
                data: {
                    added: addedCount,
                    skipped: skippedCount,
                    errors: errors.slice(0, 10) // Limit error messages
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Add contacts to list error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to add contacts to list'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get contacts in a specific list
     * GET /api/contact-lists/:id/contacts
     */
    async getListContacts(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: listId } = req.params;
            const { page = 1, limit = 50, status = 'active' } = req.query;
            
            // Verify access to the contact list
            const listResult = await client.query(`
                SELECT cl.id, cl.name, cl.organization_id
                FROM contact_lists cl
                JOIN organization_members om ON cl.organization_id = om.organization_id
                WHERE cl.id = $1 AND om.user_id = $2 AND om.status = 'active' AND cl.is_active = true
            `, [listId, userId]);
            
            if (listResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Contact list not found or access denied'
                });
            }
            
            const offset = (page - 1) * limit;
            
            // Get contacts in the list
            const contactsResult = await client.query(`
                SELECT 
                    l.*,
                    clm.status as list_status,
                    clm.subscribed_at,
                    clm.unsubscribed_at,
                    clm.source as added_source,
                    u1.first_name as added_by_first_name,
                    u1.last_name as added_by_last_name
                FROM contact_list_members clm
                JOIN leads l ON clm.lead_id = l.id
                LEFT JOIN users u1 ON clm.added_by = u1.id
                WHERE clm.contact_list_id = $1 
                AND ($2 = 'all' OR clm.status = $2)
                ORDER BY clm.subscribed_at DESC
                LIMIT $3 OFFSET $4
            `, [listId, status, limit, offset]);
            
            // Get total count
            const countResult = await client.query(`
                SELECT COUNT(*) as total
                FROM contact_list_members clm
                WHERE clm.contact_list_id = $1 
                AND ($2 = 'all' OR clm.status = $2)
            `, [listId, status]);
            
            const total = parseInt(countResult.rows[0].total);
            const totalPages = Math.ceil(total / limit);
            
            return res.json({
                success: true,
                data: {
                    contacts: contactsResult.rows,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        totalPages,
                        hasNext: page < totalPages,
                        hasPrev: page > 1
                    }
                }
            });
            
        } catch (error) {
            console.error('Get list contacts error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch list contacts'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get available leads for campaign (with smart filtering)
     * GET /api/contact-lists/available-leads
     */
    async getAvailableLeads(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { 
                filter = 'all', // 'all', 'unused', 'list', 'never_contacted'
                listId = null,
                excludeCampaignIds = [],
                page = 1, 
                limit = 100,
                search = ''
            } = req.query;
            
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
            const offset = (page - 1) * limit;
            
            let query = '';
            let queryParams = [organizationId];
            let paramCount = 1;
            
            // Base query
            const baseSelect = `
                SELECT DISTINCT
                    l.*,
                    CASE 
                        WHEN sl.email IS NOT NULL THEN true 
                        ELSE false 
                    END as is_suppressed,
                    sl.reason as suppression_reason,
                    (
                        SELECT COUNT(*) FROM lead_campaign_history lch 
                        WHERE lch.lead_id = l.id AND lch.status IN ('sent', 'delivered')
                    ) as campaigns_count,
                    (
                        SELECT MAX(lch.sent_at) FROM lead_campaign_history lch 
                        WHERE lch.lead_id = l.id AND lch.status IN ('sent', 'delivered')
                    ) as last_contacted
                FROM leads l
                LEFT JOIN suppression_lists sl ON l.email = sl.email AND sl.organization_id = l.organization_id
            `;
            
            // Apply filters
            switch (filter) {
                case 'unused':
                    query = baseSelect + `
                        WHERE l.organization_id = $1 
                        AND sl.email IS NULL
                        AND l.id NOT IN (
                            SELECT DISTINCT lch.lead_id 
                            FROM lead_campaign_history lch
                            JOIN campaigns c ON lch.campaign_id = c.id
                            WHERE c.organization_id = $1 AND lch.status IN ('sent', 'delivered')
                        )
                    `;
                    break;
                    
                case 'never_contacted':
                    query = baseSelect + `
                        WHERE l.organization_id = $1 
                        AND sl.email IS NULL
                        AND l.id NOT IN (
                            SELECT DISTINCT lch.lead_id 
                            FROM lead_campaign_history lch
                            WHERE lch.status IN ('sent', 'delivered')
                        )
                    `;
                    break;
                    
                case 'list':
                    if (!listId) {
                        return res.status(400).json({
                            success: false,
                            message: 'List ID is required when filter is "list"'
                        });
                    }
                    queryParams.push(listId);
                    paramCount++;
                    query = baseSelect + `
                        JOIN contact_list_members clm ON l.id = clm.lead_id
                        WHERE l.organization_id = $1 
                        AND clm.contact_list_id = $${paramCount}
                        AND clm.status = 'active'
                        AND sl.email IS NULL
                    `;
                    break;
                    
                default: // 'all'
                    query = baseSelect + `
                        WHERE l.organization_id = $1 
                        AND sl.email IS NULL
                    `;
            }
            
            // Exclude specific campaigns if provided
            if (excludeCampaignIds.length > 0) {
                const campaignPlaceholders = excludeCampaignIds.map((_, index) => `$${paramCount + index + 1}`).join(',');
                query += ` AND l.id NOT IN (
                    SELECT DISTINCT lch.lead_id 
                    FROM lead_campaign_history lch
                    WHERE lch.campaign_id IN (${campaignPlaceholders})
                    AND lch.status IN ('sent', 'delivered')
                )`;
                queryParams.push(...excludeCampaignIds);
                paramCount += excludeCampaignIds.length;
            }
            
            // Add search filter
            if (search.trim()) {
                queryParams.push(`%${search.trim().toLowerCase()}%`);
                paramCount++;
                query += ` AND (
                    LOWER(l.email) LIKE $${paramCount} OR
                    LOWER(l.first_name) LIKE $${paramCount} OR
                    LOWER(l.last_name) LIKE $${paramCount} OR
                    LOWER(l.company_name) LIKE $${paramCount}
                )`;
            }
            
            // Add ordering and pagination
            query += ` ORDER BY l.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            queryParams.push(limit, offset);
            
            // Execute query
            const leadsResult = await client.query(query, queryParams);
            
            // Get total count (remove LIMIT and OFFSET for count)
            const countQuery = query.replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '');
            const countResult = await client.query(
                `SELECT COUNT(*) as total FROM (${countQuery}) as count_query`,
                queryParams.slice(0, -2) // Remove LIMIT and OFFSET params
            );
            
            const total = parseInt(countResult.rows[0].total);
            const totalPages = Math.ceil(total / limit);
            
            return res.json({
                success: true,
                data: {
                    leads: leadsResult.rows,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        totalPages,
                        hasNext: page < totalPages,
                        hasPrev: page > 1
                    },
                    filter: {
                        applied: filter,
                        listId: listId,
                        excludedCampaigns: excludeCampaignIds.length,
                        search: search
                    }
                }
            });
            
        } catch (error) {
            console.error('Get available leads error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch available leads'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Import leads directly to a contact list
     * POST /api/contact-lists/:id/import
     */
    async importLeadsToList(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { id: listId } = req.params;
            const { leads, fileName } = req.body;
            
            if (!Array.isArray(leads) || leads.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Leads array is required'
                });
            }
            
            await client.query('BEGIN');
            
            // Verify the contact list exists and user has access
            const listResult = await client.query(`
                SELECT cl.id, cl.name, cl.organization_id
                FROM contact_lists cl
                JOIN organization_members om ON cl.organization_id = om.organization_id
                WHERE cl.id = $1 AND om.user_id = $2 AND om.status = 'active' AND cl.is_active = true
            `, [listId, userId]);
            
            if (listResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Contact list not found or access denied'
                });
            }
            
            const contactList = listResult.rows[0];
            let imported = 0;
            let skipped = 0;
            const errors = [];
            
            // Process each lead
            for (const leadData of leads) {
                try {
                    const email = leadData.email?.trim().toLowerCase();
                    
                    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                        errors.push(`Invalid email: ${email || 'empty'}`);
                        skipped++;
                        continue;
                    }
                    
                    // Check if lead already exists
                    let leadId;
                    const existingLead = await client.query(`
                        SELECT id FROM leads WHERE email = $1 AND organization_id = $2
                    `, [email, contactList.organization_id]);
                    
                    if (existingLead.rows.length > 0) {
                        leadId = existingLead.rows[0].id;
                    } else {
                        // Create new lead
                        leadId = uuidv4();
                        await client.query(`
                            INSERT INTO leads (
                                id, organization_id, email, first_name, last_name,
                                phone, company_name, job_title, website, linkedin_url,
                                status, source, tags, original_row_data, created_by, updated_by
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                        `, [
                            leadId, contactList.organization_id, email, 
                            leadData.first_name?.trim() || null,
                            leadData.last_name?.trim() || null,
                            leadData.phone?.trim() || null,
                            leadData.company_name?.trim() || null,
                            leadData.job_title?.trim() || null,
                            leadData.website?.trim() || null,
                            leadData.linkedin_url?.trim() || null,
                            leadData.status?.trim() || 'new',
                            `List Import: ${contactList.name}`,
                            leadData.tags || [],
                            JSON.stringify(leadData),
                            userId, userId
                        ]);
                    }
                    
                    // Add to contact list (if not already in it)
                    const existingMember = await client.query(`
                        SELECT id FROM contact_list_members 
                        WHERE contact_list_id = $1 AND lead_id = $2
                    `, [listId, leadId]);
                    
                    if (existingMember.rows.length === 0) {
                        await client.query(`
                            INSERT INTO contact_list_members (
                                id, contact_list_id, lead_id, status, source, added_by
                            ) VALUES ($1, $2, $3, 'active', $4, $5)
                        `, [uuidv4(), listId, leadId, `CSV Import: ${fileName || 'unknown.csv'}`, userId]);
                    }
                    
                    imported++;
                    
                } catch (leadError) {
                    console.error('Error importing lead:', leadError);
                    errors.push(`Error importing ${leadData.email}: ${leadError.message}`);
                    skipped++;
                }
            }
            
            // Update list import info
            await client.query(`
                UPDATE contact_lists 
                SET import_source = $1, import_date = NOW(), updated_at = NOW()
                WHERE id = $2
            `, [`CSV Import: ${fileName || 'unknown.csv'}`, listId]);
            
            await client.query('COMMIT');
            
            return res.status(201).json({
                success: true,
                message: `Successfully imported ${imported} leads to "${contactList.name}". ${skipped} leads were skipped.`,
                data: {
                    imported,
                    skipped,
                    errors: errors.slice(0, 10),
                    listId: listId,
                    listName: contactList.name
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Import leads to list error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to import leads to list'
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new ContactListsController();
