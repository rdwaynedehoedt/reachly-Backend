-- Leads Schema for Reachly
-- Core table for managing contact leads and prospects

-- Lead import batches - Track CSV imports and bulk operations
CREATE TABLE IF NOT EXISTS lead_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Import details
    filename VARCHAR(500),
    original_name VARCHAR(500),
    import_type VARCHAR(50) DEFAULT 'csv' CHECK (import_type IN ('csv', 'api', 'manual')),
    
    -- Import status
    status VARCHAR(50) DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
    
    -- Statistics
    total_rows INTEGER DEFAULT 0,
    successful_imports INTEGER DEFAULT 0,
    failed_imports INTEGER DEFAULT 0,
    duplicate_emails INTEGER DEFAULT 0,
    
    -- Error tracking
    error_details TEXT,
    validation_errors JSONB DEFAULT '[]',
    
    -- Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Main leads table - Core prospect/contact information
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Basic contact information
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(50),
    
    -- Company information
    company_name VARCHAR(255),
    job_title VARCHAR(255),
    website VARCHAR(500),
    linkedin_url VARCHAR(500),
    
    -- Lead status and management
    status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new', 'active', 'contacted', 'replied', 'qualified', 'unqualified', 'bounced', 'unsubscribed')),
    lead_score INTEGER DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
    
    -- Source and attribution
    source VARCHAR(255), -- e.g., "CSV Import: prospects-q1-2024.csv", "LinkedIn", "Website"
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    
    -- Organization and categorization
    tags TEXT[] DEFAULT '{}',
    industry VARCHAR(100),
    company_size VARCHAR(50),
    location VARCHAR(255),
    timezone VARCHAR(50),
    
    -- Custom fields for flexible data storage
    custom_fields JSONB DEFAULT '{}',
    original_row_data JSONB, -- Store original CSV/import data
    
    -- Communication preferences
    email_verified BOOLEAN DEFAULT false,
    opted_in BOOLEAN DEFAULT true,
    do_not_contact BOOLEAN DEFAULT false,
    preferred_contact_time TIME,
    preferred_contact_days TEXT[],
    
    -- Engagement tracking
    last_contacted_at TIMESTAMP WITH TIME ZONE,
    last_replied_at TIMESTAMP WITH TIME ZONE,
    total_emails_sent INTEGER DEFAULT 0,
    total_emails_opened INTEGER DEFAULT 0,
    total_emails_clicked INTEGER DEFAULT 0,
    
    -- Import tracking
    import_batch_id UUID REFERENCES lead_import_batches(id),
    
    -- Audit and tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Business constraints
    CONSTRAINT unique_org_email UNIQUE(organization_id, email)
);

-- Lead Lists - Static groupings (renamed from contact_lists for consistency)
CREATE TABLE IF NOT EXISTS lead_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- List information
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'static' CHECK (type IN ('static', 'dynamic', 'import')),
    
    -- List settings
    is_active BOOLEAN DEFAULT true,
    allow_duplicate_emails BOOLEAN DEFAULT false,
    
    -- Import tracking
    import_source VARCHAR(255),
    import_batch_id UUID REFERENCES lead_import_batches(id),
    
    -- Statistics (updated via triggers)
    total_leads INTEGER DEFAULT 0,
    active_leads INTEGER DEFAULT 0,
    
    -- Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique list names per organization
    UNIQUE(organization_id, name)
);

-- Lead List Memberships - Junction table for leads in lists
CREATE TABLE IF NOT EXISTS lead_list_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_list_id UUID NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    
    -- Member status
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'removed')),
    
    -- Membership metadata
    added_by UUID REFERENCES users(id),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    removed_at TIMESTAMP WITH TIME ZONE,
    
    -- Source tracking
    source VARCHAR(100) DEFAULT 'manual', -- manual, import, automation
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one lead per list
    UNIQUE(lead_list_id, lead_id)
);

-- Performance indexes for leads table
CREATE INDEX IF NOT EXISTS idx_leads_organization_id ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_last_contacted ON leads(last_contacted_at);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_company_name ON leads(company_name);
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_import_batch ON leads(import_batch_id);

-- Lead search index (for full-text search)
CREATE INDEX IF NOT EXISTS idx_leads_search ON leads USING gin(
    to_tsvector('english', 
        COALESCE(first_name, '') || ' ' || 
        COALESCE(last_name, '') || ' ' || 
        COALESCE(email, '') || ' ' || 
        COALESCE(company_name, '')
    )
);

-- Performance indexes for lead import batches
CREATE INDEX IF NOT EXISTS idx_lead_import_batches_org ON lead_import_batches(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_import_batches_status ON lead_import_batches(status);
CREATE INDEX IF NOT EXISTS idx_lead_import_batches_created_at ON lead_import_batches(created_at);

-- Performance indexes for lead lists
CREATE INDEX IF NOT EXISTS idx_lead_lists_organization_id ON lead_lists(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_lists_type ON lead_lists(type);
CREATE INDEX IF NOT EXISTS idx_lead_lists_active ON lead_lists(is_active);

-- Performance indexes for lead list memberships
CREATE INDEX IF NOT EXISTS idx_lead_list_memberships_list_id ON lead_list_memberships(lead_list_id);
CREATE INDEX IF NOT EXISTS idx_lead_list_memberships_lead_id ON lead_list_memberships(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_list_memberships_status ON lead_list_memberships(status);

-- Update timestamp triggers
CREATE TRIGGER update_leads_updated_at 
    BEFORE UPDATE ON leads 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_import_batches_updated_at 
    BEFORE UPDATE ON lead_import_batches 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_lists_updated_at 
    BEFORE UPDATE ON lead_lists 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_list_memberships_updated_at 
    BEFORE UPDATE ON lead_list_memberships 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Automatic statistics updates for lead lists
CREATE OR REPLACE FUNCTION update_lead_list_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update lead list statistics
    UPDATE lead_lists SET
        total_leads = (
            SELECT COUNT(*) FROM lead_list_memberships 
            WHERE lead_list_id = COALESCE(NEW.lead_list_id, OLD.lead_list_id)
        ),
        active_leads = (
            SELECT COUNT(*) FROM lead_list_memberships llm
            JOIN leads l ON llm.lead_id = l.id
            WHERE llm.lead_list_id = COALESCE(NEW.lead_list_id, OLD.lead_list_id) 
            AND llm.status = 'active'
            AND l.status IN ('new', 'active', 'contacted', 'qualified')
        ),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.lead_list_id, OLD.lead_list_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER lead_list_stats_trigger
    AFTER INSERT OR UPDATE OR DELETE ON lead_list_memberships
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_list_stats();

-- Comments for documentation
COMMENT ON TABLE leads IS 'Core table for managing contact leads and prospects';
COMMENT ON TABLE lead_import_batches IS 'Tracks CSV imports and bulk lead operations';
COMMENT ON TABLE lead_lists IS 'Static groupings of leads for organization and targeting';
COMMENT ON TABLE lead_list_memberships IS 'Junction table linking leads to lists with membership status';

COMMENT ON COLUMN leads.status IS 'Lead status: new, active, contacted, replied, qualified, unqualified, bounced, unsubscribed';
COMMENT ON COLUMN leads.custom_fields IS 'Flexible JSONB storage for additional lead data';
COMMENT ON COLUMN leads.original_row_data IS 'Stores original CSV/import data for reference';
COMMENT ON COLUMN leads.opted_in IS 'Whether lead has explicitly opted in for email communications';
COMMENT ON COLUMN leads.do_not_contact IS 'Override flag to prevent all communications';
COMMENT ON COLUMN lead_lists.type IS 'List type: static (manual), dynamic (auto-updating), import (from CSV)';
COMMENT ON COLUMN lead_list_memberships.source IS 'How the lead was added to this list: manual, import, automation';
