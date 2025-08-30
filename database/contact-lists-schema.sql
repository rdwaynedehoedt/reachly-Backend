-- Contact Lists Schema - Industry Standard Approach
-- Based on Mailchimp, HubSpot, and ActiveCampaign patterns

-- Contact Lists - Static groupings of contacts (like Mailchimp Audiences)
CREATE TABLE IF NOT EXISTS contact_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- List information
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'custom' CHECK (type IN ('custom', 'import', 'segment')),
    
    -- List settings
    is_active BOOLEAN DEFAULT true,
    allow_duplicate_emails BOOLEAN DEFAULT false,
    
    -- Import tracking
    import_source VARCHAR(255), -- e.g., "CSV Import: prospects-q1-2024.csv"
    import_date TIMESTAMP WITH TIME ZONE,
    
    -- Statistics (updated via triggers)
    total_contacts INTEGER DEFAULT 0,
    active_contacts INTEGER DEFAULT 0,
    unsubscribed_contacts INTEGER DEFAULT 0,
    
    -- Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique list names per organization
    UNIQUE(organization_id, name)
);

-- Contact List Members - Junction table for contacts in lists
CREATE TABLE IF NOT EXISTS contact_list_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_list_id UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    
    -- Member status
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced', 'suppressed')),
    
    -- Subscription tracking
    subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    unsubscribed_at TIMESTAMP WITH TIME ZONE,
    unsubscribe_reason TEXT,
    
    -- Metadata
    added_by UUID REFERENCES users(id),
    source VARCHAR(100) DEFAULT 'manual', -- manual, import, api, automation
    custom_fields JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one contact per list (but allow resubscribing)
    UNIQUE(contact_list_id, lead_id)
);

-- Campaign Contact Lists - Track which lists were used in campaigns
CREATE TABLE IF NOT EXISTS campaign_contact_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_list_id UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
    
    -- Targeting options
    include_list BOOLEAN DEFAULT true, -- true = include, false = exclude
    filter_criteria JSONB DEFAULT '{}', -- additional filters applied to the list
    
    -- Stats at time of campaign
    contacts_targeted INTEGER DEFAULT 0,
    contacts_sent INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Allow multiple lists per campaign
    UNIQUE(campaign_id, contact_list_id)
);

-- Lead Campaign History - Enhanced tracking (replaces simple campaign_leads)
CREATE TABLE IF NOT EXISTS lead_campaign_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_list_id UUID REFERENCES contact_lists(id), -- which list they came from
    
    -- Campaign participation
    status VARCHAR(50) DEFAULT 'targeted' CHECK (status IN ('targeted', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'suppressed')),
    
    -- Timing
    targeted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    bounced_at TIMESTAMP WITH TIME ZONE,
    
    -- Personalization
    custom_variables JSONB DEFAULT '{}',
    subject VARCHAR(500),
    body_html TEXT,
    body_text TEXT,
    
    -- Error handling
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Suppression Lists - Industry standard for managing unsubscribes/bounces
CREATE TABLE IF NOT EXISTS suppression_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Suppression details
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(100) NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual', 'invalid')),
    source VARCHAR(100), -- which campaign/list caused the suppression
    
    -- Additional data
    bounce_type VARCHAR(50), -- hard, soft, etc.
    complaint_type VARCHAR(50), -- spam, abuse, etc.
    notes TEXT,
    
    suppressed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    suppressed_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique email per organization
    UNIQUE(organization_id, email)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_contact_lists_organization_id ON contact_lists(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_lists_type ON contact_lists(type);
CREATE INDEX IF NOT EXISTS idx_contact_lists_active ON contact_lists(is_active);

CREATE INDEX IF NOT EXISTS idx_contact_list_members_list_id ON contact_list_members(contact_list_id);
CREATE INDEX IF NOT EXISTS idx_contact_list_members_lead_id ON contact_list_members(lead_id);
CREATE INDEX IF NOT EXISTS idx_contact_list_members_status ON contact_list_members(status);

CREATE INDEX IF NOT EXISTS idx_campaign_contact_lists_campaign_id ON campaign_contact_lists(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contact_lists_list_id ON campaign_contact_lists(contact_list_id);

CREATE INDEX IF NOT EXISTS idx_lead_campaign_history_lead_id ON lead_campaign_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_campaign_history_campaign_id ON lead_campaign_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_campaign_history_status ON lead_campaign_history(status);
CREATE INDEX IF NOT EXISTS idx_lead_campaign_history_sent_at ON lead_campaign_history(sent_at);

CREATE INDEX IF NOT EXISTS idx_suppression_lists_organization_id ON suppression_lists(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppression_lists_email ON suppression_lists(email);
CREATE INDEX IF NOT EXISTS idx_suppression_lists_reason ON suppression_lists(reason);

CREATE INDEX IF NOT EXISTS idx_lead_campaign_history_lead_campaign ON lead_campaign_history(lead_id, campaign_id, created_at);

-- Update timestamp triggers
CREATE TRIGGER update_contact_lists_updated_at 
    BEFORE UPDATE ON contact_lists 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contact_list_members_updated_at 
    BEFORE UPDATE ON contact_list_members 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_campaign_history_updated_at 
    BEFORE UPDATE ON lead_campaign_history 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Automatic statistics updates
CREATE OR REPLACE FUNCTION update_contact_list_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update contact list statistics
    UPDATE contact_lists SET
        total_contacts = (
            SELECT COUNT(*) FROM contact_list_members 
            WHERE contact_list_id = COALESCE(NEW.contact_list_id, OLD.contact_list_id)
        ),
        active_contacts = (
            SELECT COUNT(*) FROM contact_list_members 
            WHERE contact_list_id = COALESCE(NEW.contact_list_id, OLD.contact_list_id) 
            AND status = 'active'
        ),
        unsubscribed_contacts = (
            SELECT COUNT(*) FROM contact_list_members 
            WHERE contact_list_id = COALESCE(NEW.contact_list_id, OLD.contact_list_id) 
            AND status = 'unsubscribed'
        ),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.contact_list_id, OLD.contact_list_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER contact_list_stats_trigger
    AFTER INSERT OR UPDATE OR DELETE ON contact_list_members
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_list_stats();

-- Comments for documentation
COMMENT ON TABLE contact_lists IS 'Static groupings of contacts, similar to Mailchimp Audiences or HubSpot Lists';
COMMENT ON TABLE contact_list_members IS 'Junction table linking contacts to lists with subscription status';
COMMENT ON TABLE campaign_contact_lists IS 'Track which contact lists were used in each campaign';
COMMENT ON TABLE lead_campaign_history IS 'Enhanced campaign participation tracking for each lead';
COMMENT ON TABLE suppression_lists IS 'Organization-wide suppression list for unsubscribes, bounces, and complaints';

COMMENT ON COLUMN contact_lists.type IS 'List type: custom (manual), import (from CSV), segment (dynamic filter)';
COMMENT ON COLUMN contact_list_members.status IS 'Member status: active, unsubscribed, bounced, suppressed';
COMMENT ON COLUMN lead_campaign_history.status IS 'Campaign participation status for tracking engagement';
COMMENT ON COLUMN suppression_lists.reason IS 'Suppression reason: unsubscribed, bounced, complained, manual, invalid';
