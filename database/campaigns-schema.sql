-- Campaign System Database Schema
-- Phase 1: MVP Campaign System

-- Campaigns table - Core campaign information
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Basic information
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    type VARCHAR(50) DEFAULT 'single' CHECK (type IN ('single', 'sequence')),
    
    -- Email configuration
    from_name VARCHAR(255),
    from_email VARCHAR(255),
    reply_to_email VARCHAR(255),
    
    -- Scheduling
    scheduled_at TIMESTAMP WITH TIME ZONE,
    send_immediately BOOLEAN DEFAULT false,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Limits and configuration
    daily_send_limit INTEGER DEFAULT 50,
    
    -- Mass email settings
    is_mass_email BOOLEAN DEFAULT false,
    mass_email_concurrency INTEGER DEFAULT 50,
    
    -- Analytics counters
    total_leads INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    emails_delivered INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_clicked INTEGER DEFAULT 0,
    emails_replied INTEGER DEFAULT 0,
    emails_bounced INTEGER DEFAULT 0,
    
    -- Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign leads - Junction table linking campaigns to leads
CREATE TABLE IF NOT EXISTS campaign_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed')),
    
    -- Personalization
    custom_variables JSONB DEFAULT '{}',
    
    -- Personalized email content
    subject VARCHAR(500),
    body_html TEXT,
    body_text TEXT,
    
    -- Email tracking timestamps
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    bounced_at TIMESTAMP WITH TIME ZONE,
    
    -- Error handling
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one lead per campaign
    UNIQUE(campaign_id, lead_id)
);

-- Campaign templates - Email templates for campaigns
CREATE TABLE IF NOT EXISTS campaign_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    -- Template details
    name VARCHAR(255) NOT NULL DEFAULT 'Default Template',
    subject VARCHAR(500) NOT NULL,
    body_html TEXT,
    body_text TEXT,
    
    -- Template settings
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_organization_id ON campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_id ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead_id ON campaign_leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_status ON campaign_leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_sent_at ON campaign_leads(sent_at);

CREATE INDEX IF NOT EXISTS idx_campaign_templates_campaign_id ON campaign_templates(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_active ON campaign_templates(campaign_id, is_active);

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaigns_updated_at 
    BEFORE UPDATE ON campaigns 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_leads_updated_at 
    BEFORE UPDATE ON campaign_leads 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_templates_updated_at 
    BEFORE UPDATE ON campaign_templates 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE campaigns IS 'Main campaigns table storing email campaign configurations';
COMMENT ON TABLE campaign_leads IS 'Junction table linking campaigns to leads with tracking data';
COMMENT ON TABLE campaign_templates IS 'Email templates associated with campaigns';

COMMENT ON COLUMN campaigns.status IS 'Campaign status: draft, active, paused, completed, archived';
COMMENT ON COLUMN campaigns.type IS 'Campaign type: single (one email) or sequence (multiple emails)';
COMMENT ON COLUMN campaigns.daily_send_limit IS 'Maximum emails to send per day for this campaign';
COMMENT ON COLUMN campaign_leads.status IS 'Email status for this lead: pending, sent, delivered, opened, clicked, replied, bounced, failed';
COMMENT ON COLUMN campaign_leads.custom_variables IS 'JSON object containing lead-specific personalization variables';
COMMENT ON COLUMN campaign_templates.is_active IS 'Whether this template is currently active for the campaign';
