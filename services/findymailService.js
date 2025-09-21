/**
 * FindyMail API Integration Service
 * Handles all FindyMail API calls and database storage
 */

const axios = require('axios');
const { Pool } = require('pg');

// Use the same database configuration as the main application  
const pool = require('../config/database');

class FindyMailService {
  constructor() {
    this.baseURL = 'https://app.findymail.com/api';
    this.apiKey = process.env.FINDYMAIL_API_KEY;
    
    if (!this.apiKey) {
      console.warn('⚠️ FINDYMAIL_API_KEY not set in environment variables');
    }
  }

  /**
   * Get authentication headers for FindyMail API
   * Based on official API documentation: Bearer authentication
   */
  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Find email from LinkedIn URL - MAIN FUNCTION
   * @param {string} linkedinUrl - LinkedIn profile URL
   * @param {string} organizationId - Organization UUID
   * @param {string} leadId - Lead UUID (optional)
   * @param {string} userId - User UUID who initiated the request
   * @returns {Object} Enrichment result with email data
   */
  async findEmailFromLinkedIn(linkedinUrl, organizationId, leadId = null, userId) {
    const client = await pool.connect();
    
    try {
      console.log(`🔍 Finding email for LinkedIn: ${linkedinUrl}`);

      // Check if we already have enrichment data for this LinkedIn URL
      const existingResult = await this.checkExistingEnrichment(linkedinUrl, organizationId, 'linkedin', client);
      if (existingResult) {
        console.log('✅ Found existing enrichment data - returning cached result');
        return {
          success: true,
          cached: true,
          data: existingResult,
          creditsUsed: 0,
        };
      }

      // Prepare search parameters
      const searchInput = { linkedin_url: linkedinUrl };
      
      // Call FindyMail API
      const response = await axios.post(`${this.baseURL}/search/linkedin`, searchInput, {
        headers: this.getAuthHeaders(),
        timeout: 30000, // 30 second timeout
      });

      const apiResponse = response.data;
      console.log('📧 FindyMail API Response:', JSON.stringify(apiResponse, null, 2));

      // Extract contact data
      const contact = apiResponse.contact || {};
      const foundEmail = contact.email;
      const foundName = contact.name;
      const foundDomain = contact.domain;

      // Determine success
      const success = !!(foundEmail && foundEmail.includes('@'));
      const creditsUsed = success ? 1 : 0; // FindyMail charges 1 credit for successful email finds

      // Store enrichment result in database
      const enrichmentResult = await client.query(`
        INSERT INTO email_enrichment_results (
          organization_id, lead_id, search_type, search_input, api_source,
          api_response, found_email, found_name, found_domain, linkedin_url,
          verification_status, credits_used, success
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, created_at;
      `, [
        organizationId, leadId, 'linkedin', JSON.stringify({ linkedin_url: linkedinUrl }), 'findymail',
        JSON.stringify(apiResponse), foundEmail, foundName, foundDomain, linkedinUrl,
        'verified', creditsUsed, success
      ]);

      const enrichmentId = enrichmentResult.rows[0].id;

      // Track credits usage
      if (creditsUsed > 0) {
        await client.query(`
          INSERT INTO findymail_credits_usage (
            organization_id, operation_type, credits_used, api_endpoint, enrichment_result_id, user_id
          ) VALUES ($1, $2, $3, $4, $5, $6);
        `, [organizationId, 'finder', creditsUsed, '/api/search/linkedin', enrichmentId, userId]);
      }

      // If successful and we have a lead ID, the trigger will automatically update the leads table
      console.log(`${success ? '✅' : '❌'} Enrichment ${success ? 'successful' : 'failed'} - Credits used: ${creditsUsed}`);

      return {
        success,
        cached: false,
        data: {
          id: enrichmentId,
          email: foundEmail,
          name: foundName,
          domain: foundDomain,
          linkedinUrl,
          verificationStatus: 'verified',
          createdAt: enrichmentResult.rows[0].created_at,
        },
        creditsUsed,
        apiResponse, // Include for debugging
      };

    } catch (error) {
      console.error('❌ FindyMail API Error:', error.message);
      
      // Store failed enrichment attempt
      try {
        await client.query(`
          INSERT INTO email_enrichment_results (
            organization_id, lead_id, search_type, search_input, api_source,
            api_response, linkedin_url, success, credits_used
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
        `, [
          organizationId, leadId, 'linkedin', JSON.stringify({ linkedin_url: linkedinUrl }), 'findymail',
          JSON.stringify({ error: error.message, status: error.response?.status }), linkedinUrl, false, 0
        ]);
      } catch (dbError) {
        console.error('❌ Failed to store error in database:', dbError.message);
      }

      // Return structured error response
      return {
        success: false,
        cached: false,
        error: error.message,
        httpStatus: error.response?.status,
        data: null,
        creditsUsed: 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Verify email address using FindyMail
   * @param {string} email - Email to verify
   * @param {string} organizationId - Organization UUID
   * @param {string} userId - User UUID
   * @returns {Object} Verification result
   */
  async verifyEmail(email, organizationId, userId) {
    const client = await pool.connect();
    
    try {
      console.log(`📧 Verifying email: ${email}`);

      // Check for existing verification
      const existingResult = await this.checkExistingEnrichment(email, organizationId, 'verify', client);
      if (existingResult) {
        return {
          success: true,
          cached: true,
          data: existingResult,
          creditsUsed: 0,
        };
      }

      // Call FindyMail verification API
      const response = await axios.post(`${this.baseURL}/verify`, 
        { email }, 
        { headers: this.getAuthHeaders() }
      );

      const apiResponse = response.data;
      const verified = apiResponse.verified || false;
      const provider = apiResponse.provider;

      // Store verification result
      const verificationResult = await client.query(`
        INSERT INTO email_enrichment_results (
          organization_id, search_type, search_input, api_source, api_response,
          found_email, verification_status, email_provider, credits_used,
          api_endpoint, success, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, created_at;
      `, [
        organizationId, 'verify', JSON.stringify({ email }), 'findymail',
        JSON.stringify(apiResponse), email, verified ? 'verified' : 'unverified',
        provider, 1, '/api/verify', true, userId
      ]);

      // Track credits
      await client.query(`
        INSERT INTO findymail_credits_usage (
          organization_id, credits_used, api_endpoint, operation_type,
          enrichment_result_id, user_id
        ) VALUES ($1, $2, $3, $4, $5, $6);
      `, [organizationId, 1, '/api/verify', 'verifier', verificationResult.rows[0].id, userId]);

      return {
        success: true,
        cached: false,
        data: {
          email,
          verified,
          provider,
          verificationStatus: verified ? 'verified' : 'unverified',
        },
        creditsUsed: 1,
      };

    } catch (error) {
      console.error('❌ Email verification error:', error.message);
      
      return {
        success: false,
        error: error.message,
        creditsUsed: error.response?.status === 402 ? 1 : 0, // 402 = insufficient credits but still charged
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get remaining FindyMail credits
   * @returns {Object} Credits information
   */
  async getRemainingCredits() {
    try {
      const response = await axios.get(`${this.baseURL}/credits`, {
        headers: this.getAuthHeaders(),
      });

      return {
        success: true,
        data: {
          finderCredits: response.data.credits || 0,
          verifierCredits: response.data.verifier_credits || 0,
        },
      };
    } catch (error) {
      console.error('❌ Error fetching credits:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get organization's enrichment statistics
   * @param {string} organizationId - Organization UUID
   * @returns {Object} Statistics data
   */
  async getOrganizationStats(organizationId) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT * FROM organization_enrichment_stats 
        WHERE organization_id = $1;
      `, [organizationId]);

      return {
        success: true,
        data: result.rows[0] || {
          organization_id: organizationId,
          total_enrichment_attempts: 0,
          successful_enrichments: 0,
          emails_found: 0,
          success_rate_percent: 0,
          total_credits_used: 0,
        },
      };
    } catch (error) {
      console.error('❌ Error fetching organization stats:', error.message);
      return {
        success: false,
        error: error.message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Check for existing enrichment data to avoid duplicate API calls
   * @param {string} searchValue - LinkedIn URL or email to search for
   * @param {string} organizationId - Organization UUID
   * @param {string} searchType - Type of search (linkedin, verify, etc.)
   * @param {Object} client - Database client
   * @returns {Object|null} Existing enrichment data or null
   */
  async checkExistingEnrichment(searchValue, organizationId, searchType, client) {
    const query = searchType === 'linkedin' 
      ? 'SELECT * FROM email_enrichment_results WHERE organization_id = $1 AND api_source = $2 AND linkedin_url = $3 AND found_email IS NOT NULL ORDER BY created_at DESC LIMIT 1'
      : 'SELECT * FROM email_enrichment_results WHERE organization_id = $1 AND api_source = $2 AND found_email = $3 AND found_email IS NOT NULL ORDER BY created_at DESC LIMIT 1';
    
    const result = await client.query(query, [organizationId, 'findymail', searchValue]);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        id: row.id,
        email: row.found_email,
        name: row.found_name,
        domain: row.found_domain,
        linkedinUrl: row.linkedin_url,
        verificationStatus: row.verification_status,
        createdAt: row.created_at,
      };
    }
    
    return null;
  }

  /**
   * Get enrichment history for a lead
   * @param {string} leadId - Lead UUID
   * @returns {Object} Enrichment history
   */
  async getLeadEnrichmentHistory(leadId) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          id, search_type, found_email, found_name, verification_status,
          success, credits_used, created_at, error_message
        FROM email_enrichment_results 
        WHERE lead_id = $1 
        ORDER BY created_at DESC;
      `, [leadId]);

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    } finally {
      client.release();
    }
  }
}

module.exports = new FindyMailService();
