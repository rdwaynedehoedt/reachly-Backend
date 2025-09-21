-- FindyMail Email Enrichment Schema for Reachly
-- Stores all data from FindyMail API calls to avoid duplicate API requests

-- ================================================================
-- 1. EMAIL ENRICHMENT RESULTS TABLE
-- ================================================================
-- Stores results from FindyMail API calls (email finding, verification, etc.)
CREATE TABLE IF NOT EXISTS email_enrichment_results (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE, -- Nullable for direct API calls
    
    -- Input data (what we searched for)
    search_type VARCHAR(50) NOT NULL CHECK (search_type IN ('linkedin', 'name_domain', 'domain_roles', 'phone', 'verify')),
    search_input JSONB NOT NULL, -- Store original search parameters
    
    -- FindyMail API response
    api_source VARCHAR(50) DEFAULT 'findymail' CHECK (api_source IN ('findymail', 'contactout')),
    api_response JSONB, -- Full API response for audit/debugging
    
    -- Extracted email data
    found_email VARCHAR(255),
    found_name VARCHAR(255),
    found_domain VARCHAR(255),
    
    -- LinkedIn specific data (when found via LinkedIn)
    linkedin_url VARCHAR(500),
    
    -- Email verification data
    verification_status VARCHAR(50), -- verified, unverified, risky, unknown
    email_provider VARCHAR(100), -- Gmail, Outlook, etc.
    
    -- FindyMail LinkedIn Profile data (from /api/linkedin/profile)
    linkedin_profile_data JSONB, -- Full profile data if fetched
    
    -- API usage and credits
    credits_used INTEGER DEFAULT 1,
    api_endpoint VARCHAR(100), -- Which FindyMail endpoint was called
    api_request_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Success/failure tracking
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    http_status_code INTEGER,
    
    -- Audit trail
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Business constraints
    CONSTRAINT unique_lead_search_type UNIQUE(lead_id, search_type) -- One result per search type per lead
);

-- ================================================================
-- 2. FINDYMAIL CREDITS TRACKING TABLE
-- ================================================================
-- Track FindyMail API credits usage per organization
CREATE TABLE IF NOT EXISTS findymail_credits_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Credit usage details
    credits_used INTEGER NOT NULL,
    credits_remaining INTEGER, -- If returned by API
    api_endpoint VARCHAR(100) NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- email_finder, verifier, linkedin_profile, phone_finder
    
    -- Request context
    enrichment_result_id UUID REFERENCES email_enrichment_results(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Timestamps
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- 3. ENHANCE EXISTING LEADS TABLE
-- ================================================================
-- Add FindyMail-specific columns to existing leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS findymail_enriched_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS findymail_email VARCHAR(255), -- Primary email found via FindyMail
ADD COLUMN IF NOT EXISTS findymail_email_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS findymail_profile_data JSONB DEFAULT '{}', -- LinkedIn profile data
ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(50) DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'no_data')),
ADD COLUMN IF NOT EXISTS last_enrichment_attempt TIMESTAMP WITH TIME ZONE;

-- ================================================================
-- 4. PERFORMANCE INDEXES
-- ================================================================
-- Indexes for email_enrichment_results
CREATE INDEX IF NOT EXISTS idx_enrichment_organization_id ON email_enrichment_results(organization_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_lead_id ON email_enrichment_results(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_search_type ON email_enrichment_results(search_type);
CREATE INDEX IF NOT EXISTS idx_enrichment_found_email ON email_enrichment_results(found_email);
CREATE INDEX IF NOT EXISTS idx_enrichment_success ON email_enrichment_results(success);
CREATE INDEX IF NOT EXISTS idx_enrichment_created_at ON email_enrichment_results(created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_api_timestamp ON email_enrichment_results(api_request_timestamp);

-- Indexes for findymail_credits_usage
CREATE INDEX IF NOT EXISTS idx_credits_organization_id ON findymail_credits_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_credits_used_at ON findymail_credits_usage(used_at);
CREATE INDEX IF NOT EXISTS idx_credits_operation_type ON findymail_credits_usage(operation_type);
CREATE INDEX IF NOT EXISTS idx_credits_user_id ON findymail_credits_usage(user_id);

-- Additional indexes for enhanced leads table
CREATE INDEX IF NOT EXISTS idx_leads_findymail_email ON leads(findymail_email);
CREATE INDEX IF NOT EXISTS idx_leads_enrichment_status ON leads(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_leads_findymail_enriched_at ON leads(findymail_enriched_at);

-- ================================================================
-- 5. UPDATE TIMESTAMP TRIGGERS
-- ================================================================
CREATE TRIGGER update_email_enrichment_results_updated_at 
    BEFORE UPDATE ON email_enrichment_results 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- 6. AUTOMATIC LEADS TABLE UPDATE TRIGGER
-- ================================================================
-- Auto-update leads table when enrichment results are successful
CREATE OR REPLACE FUNCTION update_lead_from_enrichment()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if enrichment was successful and has email
    IF NEW.success = true AND NEW.found_email IS NOT NULL AND NEW.lead_id IS NOT NULL THEN
        UPDATE leads SET
            findymail_email = NEW.found_email,
            findymail_email_verified = CASE 
                WHEN NEW.verification_status = 'verified' THEN true 
                ELSE false 
            END,
            findymail_profile_data = COALESCE(NEW.linkedin_profile_data, '{}'),
            enrichment_status = 'enriched',
            findymail_enriched_at = NEW.created_at,
            updated_at = NOW()
        WHERE id = NEW.lead_id;
    ELSIF NEW.success = false AND NEW.lead_id IS NOT NULL THEN
        -- Mark as failed if enrichment failed
        UPDATE leads SET
            enrichment_status = 'failed',
            last_enrichment_attempt = NEW.created_at,
            updated_at = NOW()
        WHERE id = NEW.lead_id;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER enrichment_update_lead_trigger
    AFTER INSERT OR UPDATE ON email_enrichment_results
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_from_enrichment();

-- ================================================================
-- 7. HELPER VIEWS FOR ANALYTICS
-- ================================================================
-- View for enrichment success rates per organization
CREATE OR REPLACE VIEW organization_enrichment_stats AS
SELECT 
    e.organization_id,
    o.name as organization_name,
    COUNT(*) as total_enrichment_attempts,
    COUNT(CASE WHEN e.success = true THEN 1 END) as successful_enrichments,
    COUNT(CASE WHEN e.found_email IS NOT NULL THEN 1 END) as emails_found,
    ROUND(
        COUNT(CASE WHEN e.success = true THEN 1 END)::numeric / 
        COUNT(*)::numeric * 100, 2
    ) as success_rate_percent,
    SUM(COALESCE(c.credits_used, 0)) as total_credits_used,
    MAX(e.created_at) as last_enrichment_at
FROM email_enrichment_results e
LEFT JOIN organizations o ON e.organization_id = o.id
LEFT JOIN findymail_credits_usage c ON e.id = c.enrichment_result_id
GROUP BY e.organization_id, o.name;

-- ================================================================
-- 8. SAMPLE DATA INSERTION FUNCTION (for testing)
-- ================================================================
CREATE OR REPLACE FUNCTION insert_sample_enrichment_data(
    org_id UUID,
    user_id UUID,
    sample_linkedin_url VARCHAR(500) DEFAULT 'https://linkedin.com/in/johndoe'
)
RETURNS UUID AS $$
DECLARE
    enrichment_id UUID;
BEGIN
    INSERT INTO email_enrichment_results (
        organization_id,
        search_type,
        search_input,
        api_source,
        api_response,
        found_email,
        found_name,
        found_domain,
        linkedin_url,
        verification_status,
        email_provider,
        credits_used,
        api_endpoint,
        success,
        created_by
    ) VALUES (
        org_id,
        'linkedin',
        jsonb_build_object('linkedin_url', sample_linkedin_url),
        'findymail',
        jsonb_build_object(
            'contact', jsonb_build_object(
                'name', 'John Doe',
                'email', 'john@example.com',
                'domain', 'example.com'
            )
        ),
        'john@example.com',
        'John Doe',
        'example.com',
        sample_linkedin_url,
        'verified',
        'Google',
        1,
        '/api/search/linkedin',
        true,
        user_id
    ) RETURNING id INTO enrichment_id;
    
    -- Insert credit usage record
    INSERT INTO findymail_credits_usage (
        organization_id,
        credits_used,
        api_endpoint,
        operation_type,
        enrichment_result_id,
        user_id
    ) VALUES (
        org_id,
        1,
        '/api/search/linkedin',
        'email_finder',
        enrichment_id,
        user_id
    );
    
    RETURN enrichment_id;
END;
$$ language 'plpgsql';

-- ================================================================
-- 9. DOCUMENTATION COMMENTS
-- ================================================================
COMMENT ON TABLE email_enrichment_results IS 'Stores all FindyMail API call results to prevent duplicate API requests and track usage';
COMMENT ON TABLE findymail_credits_usage IS 'Tracks FindyMail API credits consumption per organization for billing and usage monitoring';

COMMENT ON COLUMN email_enrichment_results.search_input IS 'Original search parameters as JSONB - allows recreation of API calls';
COMMENT ON COLUMN email_enrichment_results.api_response IS 'Full API response for debugging and potential data recovery';
COMMENT ON COLUMN email_enrichment_results.verification_status IS 'Email verification status from FindyMail: verified, unverified, risky, unknown';
COMMENT ON COLUMN email_enrichment_results.linkedin_profile_data IS 'Full LinkedIn profile data from /api/linkedin/profile endpoint';

COMMENT ON COLUMN leads.findymail_email IS 'Primary email found via FindyMail API (may differ from ContactOut email)';
COMMENT ON COLUMN leads.findymail_profile_data IS 'LinkedIn profile data from FindyMail API for lead enrichment';
COMMENT ON COLUMN leads.enrichment_status IS 'Current enrichment status: pending, enriched, failed, no_data';

COMMENT ON VIEW organization_enrichment_stats IS 'Analytics view showing enrichment success rates and credit usage per organization';

-- Print success message
DO $$
BEGIN
    RAISE NOTICE 'FindyMail schema created successfully!';
    RAISE NOTICE 'Tables created: email_enrichment_results, findymail_credits_usage';
    RAISE NOTICE 'Enhanced: leads table with FindyMail columns';
    RAISE NOTICE 'Views created: organization_enrichment_stats';
    RAISE NOTICE 'Functions created: update_lead_from_enrichment, insert_sample_enrichment_data';
END $$;
