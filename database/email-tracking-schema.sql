-- Email Tracking Schema for Reachly
-- Tracks individual email sends, opens, clicks, and replies

-- Email sends table - tracks every email sent
CREATE TABLE IF NOT EXISTS email_sends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    
    -- Email details
    recipient_email VARCHAR(255) NOT NULL,
    subject TEXT,
    message_id VARCHAR(255), -- Gmail message ID
    thread_id VARCHAR(255),  -- Gmail thread ID
    
    -- Tracking data
    status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed')),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    bounced_at TIMESTAMP WITH TIME ZONE,
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Metadata
    user_agent TEXT, -- For tracking opens
    ip_address INET, -- For tracking opens/clicks
    tracking_pixel_url TEXT, -- Generated tracking pixel URL
    
    -- Email metadata
    sequence_step INTEGER DEFAULT 1, -- Sequential number for email tracking
    
    -- Analytics
    custom_fields JSONB DEFAULT '{}', -- For additional tracking data
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email tracking events table - detailed event tracking
CREATE TABLE IF NOT EXISTS email_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_send_id UUID NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'marked_spam', 'unsubscribed')),
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Event metadata
    user_agent TEXT,
    ip_address INET,
    referrer TEXT,
    location JSONB, -- Geolocation data if available
    device_info JSONB, -- Device and browser information
    
    -- Link tracking (for click events)
    clicked_url TEXT,
    link_id VARCHAR(255), -- For A/B testing different links
    
    -- Additional data
    event_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email templates table (for future use)
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Template details
    name VARCHAR(255) NOT NULL,
    description TEXT,
    subject_template TEXT NOT NULL,
    html_template TEXT,
    text_template TEXT,
    
    -- Template metadata
    category VARCHAR(100), -- e.g., 'cold_outreach', 'follow_up', 'thank_you'
    tags TEXT[],
    is_active BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    
    -- Template variables
    required_variables TEXT[], -- e.g., ['firstName', 'company']
    sample_data JSONB, -- Sample data for preview
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_sends_user_id ON email_sends(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_email_account_id ON email_sends(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_status ON email_sends(status);
CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at ON email_sends(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_sends_message_id ON email_sends(message_id);


CREATE INDEX IF NOT EXISTS idx_tracking_events_email_send_id ON email_tracking_events(email_send_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_type ON email_tracking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_events_timestamp ON email_tracking_events(event_timestamp);

CREATE INDEX IF NOT EXISTS idx_email_templates_user_id ON email_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);

-- Update timestamp triggers
CREATE TRIGGER update_email_sends_updated_at 
    BEFORE UPDATE ON email_sends 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at 
    BEFORE UPDATE ON email_templates 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE email_sends IS 'Tracks individual email sends and their status';
COMMENT ON TABLE email_tracking_events IS 'Detailed event tracking for email interactions';
COMMENT ON TABLE email_templates IS 'Reusable email templates with variables';

COMMENT ON COLUMN email_sends.tracking_pixel_url IS 'URL for 1x1 pixel to track email opens';
COMMENT ON COLUMN email_sends.custom_fields IS 'Additional tracking data like A/B test variants';
COMMENT ON COLUMN email_tracking_events.event_data IS 'Additional event-specific data';
COMMENT ON COLUMN email_templates.required_variables IS 'Variables that must be provided when using template';
