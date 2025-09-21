-- Global Contacts Database Schema
-- Shared knowledge base of verified emails to reduce API costs across all organizations
-- Privacy-friendly: stores contacts without revealing which organization searched for them

CREATE TABLE IF NOT EXISTS global_contacts (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Contact information (what we found from APIs)
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    
    -- Professional information
    company_name VARCHAR(255),
    job_title VARCHAR(255),
    linkedin_url VARCHAR(500),
    
    -- Contact verification
    verification_status VARCHAR(50) DEFAULT 'unknown' CHECK (verification_status IN ('verified', 'unverified', 'risky', 'unknown', 'invalid')),
    email_provider VARCHAR(100), -- Gmail, Outlook, etc.
    
    -- Data quality tracking
    confidence_score INTEGER DEFAULT 100 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    data_sources TEXT[] DEFAULT '{}', -- ['findymail', 'contactout', 'manual']
    
    -- Usage statistics (anonymous)
    times_found INTEGER DEFAULT 1, -- How many times this contact was successfully found
    last_verified_at TIMESTAMP DEFAULT NOW(),
    last_api_update TIMESTAMP DEFAULT NOW(),
    
    -- Data freshness
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for fast lookups
    UNIQUE(email),
    INDEX(linkedin_url) WHERE linkedin_url IS NOT NULL,
    INDEX(company_name) WHERE company_name IS NOT NULL,
    INDEX(verification_status),
    INDEX(last_verified_at),
    INDEX(email_provider) WHERE email_provider IS NOT NULL
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_global_contacts_email ON global_contacts(email);
CREATE INDEX IF NOT EXISTS idx_global_contacts_linkedin ON global_contacts(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_global_contacts_company ON global_contacts(company_name) WHERE company_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_global_contacts_verification ON global_contacts(verification_status);
CREATE INDEX IF NOT EXISTS idx_global_contacts_updated ON global_contacts(updated_at);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_global_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.times_found = OLD.times_found + 1; -- Increment usage counter
    NEW.last_verified_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_global_contacts_updated_at
    BEFORE UPDATE ON global_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_global_contacts_updated_at();

-- Helper function to find contact by email or LinkedIn URL
CREATE OR REPLACE FUNCTION find_global_contact(
    search_email VARCHAR(255) DEFAULT NULL,
    search_linkedin_url VARCHAR(500) DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    email VARCHAR(255),
    name VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    company_name VARCHAR(255),
    job_title VARCHAR(255),
    linkedin_url VARCHAR(500),
    verification_status VARCHAR(50),
    email_provider VARCHAR(100),
    confidence_score INTEGER,
    times_found INTEGER,
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP
) AS $$
BEGIN
    IF search_email IS NOT NULL THEN
        RETURN QUERY 
        SELECT gc.id, gc.email, gc.name, gc.first_name, gc.last_name,
               gc.company_name, gc.job_title, gc.linkedin_url,
               gc.verification_status, gc.email_provider, gc.confidence_score,
               gc.times_found, gc.last_verified_at, gc.created_at
        FROM global_contacts gc 
        WHERE gc.email = search_email 
        AND gc.verification_status != 'invalid'
        LIMIT 1;
    ELSIF search_linkedin_url IS NOT NULL THEN
        RETURN QUERY 
        SELECT gc.id, gc.email, gc.name, gc.first_name, gc.last_name,
               gc.company_name, gc.job_title, gc.linkedin_url,
               gc.verification_status, gc.email_provider, gc.confidence_score,
               gc.times_found, gc.last_verified_at, gc.created_at
        FROM global_contacts gc 
        WHERE gc.linkedin_url = search_linkedin_url 
        AND gc.email IS NOT NULL 
        AND gc.verification_status != 'invalid'
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Analytics view for tracking savings
CREATE OR REPLACE VIEW global_contacts_analytics AS
SELECT 
    COUNT(*) as total_contacts,
    COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) as verified_contacts,
    COUNT(CASE WHEN email_provider = 'Gmail' THEN 1 END) as gmail_contacts,
    COUNT(CASE WHEN email_provider = 'Outlook' THEN 1 END) as outlook_contacts,
    SUM(times_found - 1) as total_credits_saved, -- Each re-use saves 1 credit
    AVG(confidence_score) as avg_confidence_score,
    MAX(last_verified_at) as last_contact_added,
    COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as contacts_added_24h,
    COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as contacts_added_7d,
    COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as contacts_added_30d
FROM global_contacts;

-- Comments for documentation
COMMENT ON TABLE global_contacts IS 'Global shared database of verified contacts to reduce API costs across all organizations. Privacy-friendly - no organization tracking.';
COMMENT ON COLUMN global_contacts.times_found IS 'Number of times this contact was successfully found - used to calculate credit savings';
COMMENT ON COLUMN global_contacts.confidence_score IS 'Data quality score (0-100) based on verification status and data sources';
COMMENT ON COLUMN global_contacts.data_sources IS 'Array of sources where this contact was found (findymail, contactout, manual)';

-- Sample data insertion function (for testing)
CREATE OR REPLACE FUNCTION insert_sample_global_contact()
RETURNS UUID AS $$
DECLARE
    contact_id UUID;
BEGIN
    INSERT INTO global_contacts (
        email, name, first_name, last_name, company_name, job_title,
        linkedin_url, verification_status, email_provider, confidence_score,
        data_sources
    ) VALUES (
        'john.doe@example.com',
        'John Doe',
        'John',
        'Doe',
        'Example Corp',
        'Software Engineer',
        'https://linkedin.com/in/johndoe',
        'verified',
        'Gmail',
        95,
        ARRAY['findymail']
    ) RETURNING id INTO contact_id;
    
    RETURN contact_id;
END;
$$ LANGUAGE plpgsql;
