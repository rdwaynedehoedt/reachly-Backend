/**
 * FindyMail API Controller
 * Handles all FindyMail-related API endpoints
 */

const findymailService = require('../services/findymailService');
const pool = require('../config/database'); // Use same Azure PostgreSQL config as rest of app

/**
 * Helper function to get user's organization ID
 * Includes temporary fix for JWT user ID mismatch
 */
const getUserOrganizationId = async (userId) => {
  const client = await pool.connect();
  try {
    let orgResult = { rows: [] };
    
    // First try exact match (catch UUID format errors)
    try {
      orgResult = await client.query(`
        SELECT om.organization_id, o.name, om.user_id as found_user_id
        FROM organization_members om 
        JOIN organizations o ON om.organization_id = o.id
        WHERE om.user_id = $1 AND om.status = 'active'
        LIMIT 1
      `, [userId]);
    } catch (error) {
      console.log(`⚠️ UUID format error for ${userId}: ${error.message}`);
    }
    
    // If no exact match or UUID error, try to find a similar user ID (temporary fix for JWT mismatch)
    if (orgResult.rows.length === 0) {
      console.log(`🔄 Attempting fuzzy match for user ID: ${userId}`);
      
      // Try to find user with similar ID pattern (using text comparison to avoid UUID errors)
      try {
        const similarResult = await client.query(`
          SELECT om.organization_id, o.name, om.user_id as found_user_id, u.email
          FROM organization_members om 
          JOIN organizations o ON om.organization_id = o.id
          JOIN users u ON om.user_id = u.id
          WHERE om.user_id::text LIKE $1 AND om.status = 'active'
          LIMIT 1
        `, [userId.substring(0, 30) + '%']); // Match first 30 chars
        
        if (similarResult.rows.length > 0) {
          console.log(`✅ Found similar user: ${similarResult.rows[0].found_user_id} (${similarResult.rows[0].email})`);
          orgResult = similarResult;
        }
      } catch (fuzzyError) {
        console.log(`❌ Fuzzy match also failed: ${fuzzyError.message}`);
      }
      
      // If still no match, throw error
      if (orgResult.rows.length === 0) {
        throw new Error(`No active organization membership found for user: ${userId}`);
      }
    }
    
    return {
      organizationId: orgResult.rows[0].organization_id,
      organizationName: orgResult.rows[0].name,
      actualUserId: orgResult.rows[0].found_user_id
    };
  } finally {
    client.release();
  }
};

/**
 * Find email from LinkedIn URL
 * POST /api/findymail/find-email-linkedin
 */
const findEmailFromLinkedIn = async (req, res) => {
  try {
    const { linkedin_url, lead_id } = req.body;
    
    // Validation
    if (!linkedin_url) {
      return res.status(400).json({
        success: false,
        error: 'LinkedIn URL is required',
      });
    }

    // Basic LinkedIn URL validation
    if (!linkedin_url.includes('linkedin.com')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid LinkedIn URL format',
      });
    }

    // Get user's organization ID (required for authenticated requests)
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userId = req.user.userId;
    const { organizationId, organizationName } = await getUserOrganizationId(userId);

    console.log(`📧 Processing LinkedIn email search request:`, {
      linkedin_url,
      lead_id,
      organizationId,
      organizationName,
      userId,
    });

    // Call FindyMail service (API key validation temporarily disabled for testing)
    const result = await findymailService.findEmailFromLinkedIn(
      linkedin_url,
      organizationId,
      lead_id,
      userId
    );

    // Return response
    if (result.success) {
      res.json({
        success: true,
        cached: result.cached,
        data: result.data,
        credits_used: result.creditsUsed,
        message: result.cached 
          ? 'Email found from existing data'
          : 'Email successfully found via FindyMail API',
      });
    } else {
      // Handle specific error cases
      let statusCode = 500;
      let errorMessage = result.error;

      if (result.httpStatus === 402) {
        statusCode = 402;
        errorMessage = 'Insufficient FindyMail credits';
      } else if (result.httpStatus === 423) {
        statusCode = 423;
        errorMessage = 'FindyMail subscription is paused';
      } else if (result.httpStatus === 404) {
        statusCode = 404;
        errorMessage = 'Email not found for this LinkedIn profile';
      }

      res.status(statusCode).json({
        success: false,
        error: errorMessage,
        credits_used: result.creditsUsed,
      });
    }

  } catch (error) {
    console.error('❌ FindEmail controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while finding email',
    });
  }
};

/**
 * Verify email address
 * POST /api/findymail/verify-email
 */
const verifyEmail = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required',
      });
    }

    // Get user's organization ID (required for authenticated requests)
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userId = req.user.userId;
    const { organizationId, organizationName } = await getUserOrganizationId(userId);

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    console.log(`📧 Processing email verification request: ${email}`);

    const result = await findymailService.verifyEmail(email, organizationId, userId);

    if (result.success) {
      res.json({
        success: true,
        cached: result.cached,
        data: result.data,
        credits_used: result.creditsUsed,
      });
    } else {
      let statusCode = 500;
      if (result.error.includes('credits')) statusCode = 402;
      if (result.error.includes('paused')) statusCode = 423;

      res.status(statusCode).json({
        success: false,
        error: result.error,
        credits_used: result.creditsUsed,
      });
    }

  } catch (error) {
    console.error('❌ VerifyEmail controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while verifying email',
    });
  }
};

/**
 * Get remaining FindyMail credits
 * GET /api/findymail/credits
 */
const getCredits = async (req, res) => {
  try {
    const result = await findymailService.getRemainingCredits();

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }

  } catch (error) {
    console.error('❌ GetCredits controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching credits',
    });
  }
};

/**
 * Get organization enrichment statistics
 * GET /api/findymail/stats
 */
const getOrganizationStats = async (req, res) => {
  try {
    // Get user's organization ID (required for authenticated requests)
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userId = req.user.userId;
    const { organizationId } = await getUserOrganizationId(userId);

    const result = await findymailService.getOrganizationStats(organizationId);

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }

  } catch (error) {
    console.error('❌ GetOrganizationStats controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching statistics',
    });
  }
};

/**
 * Get enrichment history for a specific lead
 * GET /api/findymail/lead/:leadId/history
 */
const getLeadEnrichmentHistory = async (req, res) => {
  try {
    const { leadId } = req.params;
    
    // Get user's organization ID (required for authenticated requests)
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userId = req.user.userId;
    const { organizationId } = await getUserOrganizationId(userId);

    // Verify lead belongs to organization
    const client = await pool.connect();
    try {
      const leadCheck = await client.query(
        'SELECT id FROM leads WHERE id = $1 AND organization_id = $2',
        [leadId, organizationId]
      );

      if (leadCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found or access denied',
        });
      }
    } finally {
      client.release();
    }

    const result = await findymailService.getLeadEnrichmentHistory(leadId);

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }

  } catch (error) {
    console.error('❌ GetLeadEnrichmentHistory controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching enrichment history',
    });
  }
};

/**
 * Bulk find emails for multiple LinkedIn URLs
 * POST /api/findymail/bulk-find-emails
 */
const bulkFindEmails = async (req, res) => {
  try {
    const { linkedin_urls } = req.body; // Array of objects: [{linkedin_url, lead_id}]
    
    if (!linkedin_urls || !Array.isArray(linkedin_urls) || linkedin_urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'linkedin_urls array is required',
      });
    }

    // Get user's organization ID (required for authenticated requests)
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const userId = req.user.userId;
    const { organizationId, organizationName } = await getUserOrganizationId(userId);

    if (linkedin_urls.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 LinkedIn URLs allowed per batch',
      });
    }

    console.log(`📧 Processing bulk email search for ${linkedin_urls.length} LinkedIn URLs`);

    const results = [];
    let totalCreditsUsed = 0;

    // Process each LinkedIn URL
    for (const item of linkedin_urls) {
      const { linkedin_url, lead_id } = item;
      
      if (!linkedin_url) {
        results.push({
          linkedin_url,
          lead_id,
          success: false,
          error: 'LinkedIn URL is required',
        });
        continue;
      }

      try {
        const result = await findymailService.findEmailFromLinkedIn(
          linkedin_url,
          organizationId,
          lead_id,
          userId
        );

        results.push({
          linkedin_url,
          lead_id,
          success: result.success,
          cached: result.cached,
          data: result.data,
          credits_used: result.creditsUsed,
          error: result.error || null,
        });

        totalCreditsUsed += result.creditsUsed || 0;

      } catch (error) {
        results.push({
          linkedin_url,
          lead_id,
          success: false,
          error: error.message,
          credits_used: 0,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    res.json({
      success: true,
      summary: {
        total: results.length,
        successful: successCount,
        failed: failedCount,
        total_credits_used: totalCreditsUsed,
      },
      results,
    });

  } catch (error) {
    console.error('❌ BulkFindEmails controller error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while processing bulk email search',
    });
  }
};

module.exports = {
  findEmailFromLinkedIn,
  verifyEmail,
  getCredits,
  getOrganizationStats,
  getLeadEnrichmentHistory,
  bulkFindEmails,
};
