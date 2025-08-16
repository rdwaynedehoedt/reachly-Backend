-- Leads and Campaigns Schema for Reachly
-- This schema creates the missing tables for leads, campaigns, sequences, and scheduling

-- Leads table (matches the controller expectations)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Basic contact information
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company_name VARCHAR(255),
    job_title VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    linkedin_url VARCHAR(500),
    location VARCHAR(255),
    
    -- Lead status and tracking
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'contacted', 'replied', 'unsubscribed', 'bounced', 'do_not_contact')),
    source VARCHAR(100) DEFAULT 'manual', -- manual, import, api, form, etc.
    tags TEXT[],
    
    -- Custom fields for flexibility
    custom_fields JSONB DEFAULT '{}',
    
    -- Lead scoring and engagement
    engagement_score INTEGER DEFAULT 0,
    last_contacted_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    
    -- Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(organization_id, email)
);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Campaign details
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Campaign configuration
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    type VARCHAR(50) DEFAULT 'sequence' CHECK (type IN ('sequence', 'single', 'drip')),
    
    -- Sending configuration
    from_name VARCHAR(255),
    from_email VARCHAR(255),
    reply_to_email VARCHAR(255),
    
    -- Scheduling
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Daily schedule settings
    schedule_days JSONB DEFAULT '["monday", "tuesday", "wednesday", "thursday", "friday"]', -- Days of week
    schedule_start_time TIME DEFAULT '09:00:00', -- Start time (e.g., 9:00 AM)
    schedule_end_time TIME DEFAULT '18:00:00', -- End time (e.g., 6:00 PM)
    
    -- Campaign limits
    daily_send_limit INTEGER DEFAULT 50,
    max_emails_per_lead INTEGER DEFAULT 5,
    
    -- Analytics
    total_leads INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_clicked INTEGER DEFAULT 0,
    emails_replied INTEGER DEFAULT 0,
    
    -- Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign sequences (email steps)
CREATE TABLE IF NOT EXISTS campaign_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    -- Sequence details
    step_number INTEGER NOT NULL,
    name VARCHAR(255),
    subject VARCHAR(500) NOT NULL,
    
    -- Email content
    html_content TEXT,
    text_content TEXT,
    
    -- Timing
    delay_days INTEGER DEFAULT 0, -- Days to wait after previous step (0 for first step)
    delay_hours INTEGER DEFAULT 0, -- Additional hours to wait
    delay_minutes INTEGER DEFAULT 0, -- Additional minutes to wait
    
    -- Sequence configuration
    is_active BOOLEAN DEFAULT true,
    send_conditions JSONB DEFAULT '{}', -- Conditions for sending (e.g., only if previous opened)
    
    -- Template variables
    personalization_fields JSONB DEFAULT '{}', -- Fields to personalize
    
    -- Analytics for this step
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_clicked INTEGER DEFAULT 0,
    emails_replied INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(campaign_id, step_number)
);

-- Campaign leads (which leads are in which campaigns)
CREATE TABLE IF NOT EXISTS campaign_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    
    -- Lead status in this campaign
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'unsubscribed', 'bounced')),
    current_step INTEGER DEFAULT 1, -- Which sequence step they're on
    next_send_at TIMESTAMP WITH TIME ZONE, -- When to send next email
    
    -- Campaign-specific lead data
    custom_variables JSONB DEFAULT '{}', -- Custom variables for this lead in this campaign
    
    -- Tracking
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_email_sent_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(campaign_id, lead_id)
);

-- Campaign schedules (for more complex scheduling needs)
CREATE TABLE IF NOT EXISTS campaign_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    
    -- Schedule details
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    
    -- Time settings
    start_time TIME NOT NULL DEFAULT '09:00:00',
    end_time TIME NOT NULL DEFAULT '18:00:00',
    
    -- Days of week (JSON array)
    days_of_week JSONB NOT NULL DEFAULT '["monday", "tuesday", "wednesday", "thursday", "friday"]',
    
    -- Date range
    start_date DATE,
    end_date DATE,
    
    -- Exclusions (holidays, blackout dates)
    excluded_dates JSONB DEFAULT '[]', -- Array of dates to exclude
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email send queue (for scheduled sending)
CREATE TABLE IF NOT EXISTS email_send_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- References
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    campaign_lead_id UUID NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE,
    sequence_id UUID NOT NULL REFERENCES campaign_sequences(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    email_account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    
    -- Email details
    recipient_email VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT,
    text_content TEXT,
    
    -- Scheduling
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Error handling
    error_message TEXT,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    
    -- Tracking
    sent_at TIMESTAMP WITH TIME ZONE,
    email_send_id UUID, -- References email_sends table when actually sent
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_organization_id ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_last_contacted ON leads(last_contacted_at);

CREATE INDEX IF NOT EXISTS idx_campaigns_organization_id ON campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_start_date ON campaigns(start_date);

CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_id ON campaign_sequences(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sequences_step ON campaign_sequences(campaign_id, step_number);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_id ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead_id ON campaign_leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_status ON campaign_leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_next_send ON campaign_leads(next_send_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_campaign_schedules_campaign_id ON campaign_schedules(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_active ON campaign_schedules(campaign_id, is_active);

CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_send_queue(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_email_queue_campaign ON email_send_queue(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_send_queue(status);

-- Update timestamp triggers
CREATE TRIGGER update_leads_updated_at 
    BEFORE UPDATE ON leads 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at 
    BEFORE UPDATE ON campaigns 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_sequences_updated_at 
    BEFORE UPDATE ON campaign_sequences 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_leads_updated_at 
    BEFORE UPDATE ON campaign_leads 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_schedules_updated_at 
    BEFORE UPDATE ON campaign_schedules 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_send_queue_updated_at 
    BEFORE UPDATE ON email_send_queue 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE leads IS 'Leads/contacts for email campaigns';
COMMENT ON TABLE campaigns IS 'Email campaigns with sequences and scheduling';
COMMENT ON TABLE campaign_sequences IS 'Individual email steps in a campaign sequence';
COMMENT ON TABLE campaign_leads IS 'Tracks which leads are enrolled in which campaigns';
COMMENT ON TABLE campaign_schedules IS 'Detailed scheduling configurations for campaigns';
COMMENT ON TABLE email_send_queue IS 'Queue for scheduled email sends';

COMMENT ON COLUMN campaigns.schedule_days IS 'JSON array of days when emails can be sent';
COMMENT ON COLUMN campaigns.daily_send_limit IS 'Maximum emails to send per day for this campaign';
COMMENT ON COLUMN campaign_sequences.delay_days IS 'Days to wait before sending this step';
COMMENT ON COLUMN campaign_leads.next_send_at IS 'When the next email should be sent to this lead';
COMMENT ON COLUMN email_send_queue.scheduled_at IS 'When this email should be sent';
