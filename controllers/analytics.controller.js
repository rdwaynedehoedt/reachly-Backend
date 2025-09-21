const { pool } = require('../config/database');

class AnalyticsController {

    /**
     * Get global contacts database analytics
     * GET /api/analytics/global-contacts
     */
    async getGlobalContactsAnalytics(req, res) {
        const client = await pool.connect();
        
        try {
            console.log('📊 Fetching global contacts analytics...');

            // Get analytics from the view
            const analyticsResult = await client.query(`
                SELECT * FROM global_contacts_analytics
            `);

            const analytics = analyticsResult.rows[0] || {};

            // Get top domains
            const topDomainsResult = await client.query(`
                SELECT 
                    SPLIT_PART(email, '@', 2) as domain,
                    COUNT(*) as count,
                    SUM(times_found - 1) as credits_saved
                FROM global_contacts 
                WHERE email IS NOT NULL
                GROUP BY SPLIT_PART(email, '@', 2)
                ORDER BY count DESC
                LIMIT 10
            `);

            // Get verification status breakdown
            const verificationBreakdownResult = await client.query(`
                SELECT 
                    verification_status,
                    COUNT(*) as count,
                    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
                FROM global_contacts
                GROUP BY verification_status
                ORDER BY count DESC
            `);

            // Get recent activity (last 30 days)
            const recentActivityResult = await client.query(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as new_contacts,
                    SUM(times_found - 1) as credits_saved_today
                FROM global_contacts
                WHERE created_at >= NOW() - INTERVAL '30 days'
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `);

            // Calculate total credits saved across all organizations
            const creditsSavedResult = await client.query(`
                SELECT SUM(times_found - 1) as total_credits_saved
                FROM global_contacts
                WHERE times_found > 1
            `);

            return res.status(200).json({
                success: true,
                data: {
                    overview: {
                        totalContacts: parseInt(analytics.total_contacts) || 0,
                        verifiedContacts: parseInt(analytics.verified_contacts) || 0,
                        gmailContacts: parseInt(analytics.gmail_contacts) || 0,
                        outlookContacts: parseInt(analytics.outlook_contacts) || 0,
                        totalCreditsSaved: parseInt(creditsSavedResult.rows[0]?.total_credits_saved) || 0,
                        avgConfidenceScore: parseFloat(analytics.avg_confidence_score) || 0,
                        lastContactAdded: analytics.last_contact_added,
                        contactsAdded24h: parseInt(analytics.contacts_added_24h) || 0,
                        contactsAdded7d: parseInt(analytics.contacts_added_7d) || 0,
                        contactsAdded30d: parseInt(analytics.contacts_added_30d) || 0
                    },
                    topDomains: topDomainsResult.rows.map(row => ({
                        domain: row.domain,
                        count: parseInt(row.count),
                        creditsSaved: parseInt(row.credits_saved) || 0
                    })),
                    verificationBreakdown: verificationBreakdownResult.rows.map(row => ({
                        status: row.verification_status,
                        count: parseInt(row.count),
                        percentage: parseFloat(row.percentage)
                    })),
                    recentActivity: recentActivityResult.rows.map(row => ({
                        date: row.date,
                        newContacts: parseInt(row.new_contacts),
                        creditsSavedToday: parseInt(row.credits_saved_today) || 0
                    }))
                },
                message: 'Global contacts analytics retrieved successfully'
            });

        } catch (error) {
            console.error('❌ Analytics error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch global contacts analytics',
                error: error.message
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get organization-specific enrichment statistics
     * GET /api/analytics/organization-enrichment
     */
    async getOrganizationEnrichmentStats(req, res) {
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

            // Get organization enrichment statistics
            const statsResult = await client.query(`
                SELECT * FROM organization_enrichment_stats 
                WHERE organization_id = $1
            `, [organizationId]);

            const stats = statsResult.rows[0] || {};

            // Get recent enrichment activity for this organization
            const recentActivityResult = await client.query(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as enrichment_attempts,
                    COUNT(CASE WHEN success = true THEN 1 END) as successful_enrichments,
                    SUM(credits_used) as credits_used_today
                FROM email_enrichment_results
                WHERE organization_id = $1 
                AND created_at >= NOW() - INTERVAL '30 days'
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `);

            // Calculate credits saved by global database for this org
            const globalSavingsResult = await client.query(`
                SELECT COUNT(*) as global_hits_count
                FROM email_enrichment_results
                WHERE organization_id = $1
                AND api_response::text LIKE '%"global_database"%'
            `);

            return res.status(200).json({
                success: true,
                data: {
                    organization: {
                        id: organizationId,
                        name: stats.organization_name || 'Unknown',
                        totalEnrichmentAttempts: parseInt(stats.total_enrichment_attempts) || 0,
                        successfulEnrichments: parseInt(stats.successful_enrichments) || 0,
                        emailsFound: parseInt(stats.emails_found) || 0,
                        successRatePercent: parseFloat(stats.success_rate_percent) || 0,
                        totalCreditsUsed: parseInt(stats.total_credits_used) || 0,
                        lastEnrichmentAt: stats.last_enrichment_at,
                        globalDatabaseHits: parseInt(globalSavingsResult.rows[0]?.global_hits_count) || 0
                    },
                    recentActivity: recentActivityResult.rows.map(row => ({
                        date: row.date,
                        enrichmentAttempts: parseInt(row.enrichment_attempts),
                        successfulEnrichments: parseInt(row.successful_enrichments),
                        creditsUsedToday: parseInt(row.credits_used_today) || 0
                    }))
                },
                message: 'Organization enrichment statistics retrieved successfully'
            });

        } catch (error) {
            console.error('❌ Organization analytics error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch organization enrichment statistics',
                error: error.message
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get credit savings report
     * GET /api/analytics/credit-savings
     */
    async getCreditSavingsReport(req, res) {
        const client = await pool.connect();
        
        try {
            console.log('💰 Generating credit savings report...');

            // Global credit savings
            const globalSavingsResult = await client.query(`
                SELECT 
                    SUM(times_found - 1) as total_credits_saved,
                    COUNT(*) as total_contacts_reused,
                    AVG(times_found) as avg_reuse_per_contact
                FROM global_contacts
                WHERE times_found > 1
            `);

            // Most valuable contacts (highest credit savings)
            const topContactsResult = await client.query(`
                SELECT 
                    email,
                    name,
                    company_name,
                    times_found,
                    (times_found - 1) as credits_saved,
                    verification_status,
                    created_at
                FROM global_contacts
                WHERE times_found > 1
                ORDER BY times_found DESC
                LIMIT 10
            `);

            // Monthly savings trend
            const monthlySavingsResult = await client.query(`
                SELECT 
                    DATE_TRUNC('month', last_verified_at) as month,
                    SUM(times_found - 1) as credits_saved_monthly,
                    COUNT(*) as contacts_reused
                FROM global_contacts
                WHERE times_found > 1
                AND last_verified_at >= NOW() - INTERVAL '12 months'
                GROUP BY DATE_TRUNC('month', last_verified_at)
                ORDER BY month DESC
            `);

            const globalStats = globalSavingsResult.rows[0] || {};

            return res.status(200).json({
                success: true,
                data: {
                    summary: {
                        totalCreditsSaved: parseInt(globalStats.total_credits_saved) || 0,
                        totalContactsReused: parseInt(globalStats.total_contacts_reused) || 0,
                        avgReusePerContact: parseFloat(globalStats.avg_reuse_per_contact) || 0,
                        estimatedMoneySaved: (parseInt(globalStats.total_credits_saved) || 0) * 0.10 // Assuming $0.10 per credit
                    },
                    topValueContacts: topContactsResult.rows.map(row => ({
                        email: row.email,
                        name: row.name,
                        companyName: row.company_name,
                        timesFound: parseInt(row.times_found),
                        creditsSaved: parseInt(row.credits_saved),
                        verificationStatus: row.verification_status,
                        createdAt: row.created_at
                    })),
                    monthlySavings: monthlySavingsResult.rows.map(row => ({
                        month: row.month,
                        creditsSaved: parseInt(row.credits_saved_monthly),
                        contactsReused: parseInt(row.contacts_reused)
                    }))
                },
                message: 'Credit savings report generated successfully'
            });

        } catch (error) {
            console.error('❌ Credit savings report error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate credit savings report',
                error: error.message
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new AnalyticsController();
