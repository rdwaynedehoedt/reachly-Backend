-- ================================================================
-- EMAIL SCHEDULING SYSTEM - PostgreSQL Schema
-- ================================================================
-- This schema supports enterprise-grade email scheduling with:
-- - Job-based email processing
-- - Rate limiting per organization  
-- - Timezone-aware scheduling
-- - Cost-optimized storage with auto-cleanup
-- - Full audit trails for compliance
-- ================================================================

-- Note: Using gen_random_uuid() which is available in PostgreSQL 13+ 
-- No extensions needed for Azure PostgreSQL compatibility

-- ================================================================
-- 1. EMAIL JOBS TABLE - Core job queue
-- ================================================================
CREATE TABLE IF NOT EXISTS email_jobs (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Campaign and organization context
    campaign_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    
    -- Recipient information
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),
    
    -- Email content (can be template or final content)
    subject VARCHAR(500) NOT NULL,
    body_text TEXT,
    body_html TEXT,
    personalization_data JSONB DEFAULT '{}',
    
    -- Scheduling information
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Job management
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    
    -- Error handling and retries
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error_message TEXT,
    last_attempted_at TIMESTAMP WITH TIME ZONE,
    
    -- Rate limiting context
    rate_limit_key VARCHAR(100), -- e.g., 'org_123' or 'campaign_456'
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit and tracking
    created_by UUID,
    processing_node VARCHAR(50), -- Which server/process handled this job
    
    -- Foreign key constraints
    CONSTRAINT fk_email_jobs_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_email_jobs_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- ================================================================
-- 2. CAMPAIGN SCHEDULES TABLE - Campaign-level scheduling config
-- ================================================================
CREATE TABLE IF NOT EXISTS campaign_schedules (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL UNIQUE,
    
    -- Scheduling type
    schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('immediate', 'scheduled', 'drip')),
    
    -- Immediate sending config
    immediate_rate_limit INTEGER DEFAULT 100, -- emails per hour
    
    -- Scheduled sending config
    start_date DATE,
    end_date DATE,
    send_time_start TIME,
    send_time_end TIME,
    send_timezone VARCHAR(50) DEFAULT 'UTC',
    daily_limit INTEGER,
    
    -- Drip campaign config
    drip_interval_hours INTEGER,
    drip_days_between INTEGER,
    
    -- Rate limiting
    max_emails_per_hour INTEGER DEFAULT 100,
    max_emails_per_day INTEGER DEFAULT 1000,
    
    -- Status and tracking
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key constraint
    CONSTRAINT fk_campaign_schedules_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- ================================================================
-- 3. RATE LIMITING TABLE - Track sending rates
-- ================================================================
CREATE TABLE IF NOT EXISTS email_rate_limits (
    -- Composite primary key for rate limiting
    rate_limit_key VARCHAR(100) NOT NULL,
    time_window TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Counters
    emails_sent_count INTEGER DEFAULT 0,
    emails_failed_count INTEGER DEFAULT 0,
    
    -- Window type (hour, day, etc.)
    window_type VARCHAR(10) NOT NULL CHECK (window_type IN ('hour', 'day')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (rate_limit_key, time_window, window_type)
);

-- ================================================================
-- 4. EMAIL JOB LOGS - Detailed tracking and debugging
-- ================================================================
CREATE TABLE IF NOT EXISTS email_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_job_id UUID NOT NULL,
    
    -- Log details
    log_level VARCHAR(10) NOT NULL CHECK (log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    
    -- Context
    processing_node VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key constraint
    CONSTRAINT fk_email_job_logs_job FOREIGN KEY (email_job_id) REFERENCES email_jobs(id) ON DELETE CASCADE
);

-- ================================================================
-- 5. PERFORMANCE INDEXES
-- ================================================================

-- Primary processing query: get jobs to process
CREATE INDEX IF NOT EXISTS idx_email_jobs_processing 
ON email_jobs(scheduled_for, status, organization_id) 
WHERE status IN ('pending', 'processing');

-- Rate limiting queries
CREATE INDEX IF NOT EXISTS idx_email_jobs_rate_limiting 
ON email_jobs(rate_limit_key, created_at, status);

-- Campaign management queries
CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign 
ON email_jobs(campaign_id, status, created_at);

-- Organization queries
CREATE INDEX IF NOT EXISTS idx_email_jobs_organization 
ON email_jobs(organization_id, status, created_at);

-- Retry and error handling
CREATE INDEX IF NOT EXISTS idx_email_jobs_retry 
ON email_jobs(status, retry_count, last_attempted_at) 
WHERE status = 'failed' AND retry_count < max_retries;

-- Cleanup queries (for old completed jobs)
CREATE INDEX IF NOT EXISTS idx_email_jobs_cleanup 
ON email_jobs(status, created_at) 
WHERE status IN ('sent', 'failed', 'cancelled');

-- Rate limiting table indexes
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
ON email_rate_limits(rate_limit_key, time_window, window_type);

-- ================================================================
-- 6. TRIGGERS FOR AUTOMATIC MAINTENANCE
-- ================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to relevant tables
CREATE TRIGGER update_email_jobs_updated_at 
    BEFORE UPDATE ON email_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_schedules_updated_at 
    BEFORE UPDATE ON campaign_schedules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_limits_updated_at 
    BEFORE UPDATE ON email_rate_limits 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- 7. COST OPTIMIZATION - AUTOMATIC CLEANUP
-- ================================================================

-- Function to clean up old completed jobs (cost optimization)
CREATE OR REPLACE FUNCTION cleanup_old_email_jobs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete successful jobs older than 30 days
    DELETE FROM email_jobs 
    WHERE status = 'sent' 
    AND created_at < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Log the cleanup (simplified for Azure compatibility)
    RAISE NOTICE 'Cleanup completed: % jobs deleted', deleted_count;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old rate limiting data
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete rate limit records older than 7 days
    DELETE FROM email_rate_limits 
    WHERE time_window < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 8. SAMPLE DATA INSERTS (for testing)
-- ================================================================
-- Note: Sample data removed to avoid foreign key constraint issues
-- Sample data will be added programmatically when real campaigns exist

-- ================================================================
-- 9. HELPFUL VIEWS FOR MONITORING
-- ================================================================

-- View for job processing queue
CREATE OR REPLACE VIEW email_jobs_queue AS
SELECT 
    ej.id,
    ej.campaign_id,
    ej.recipient_email,
    ej.scheduled_for,
    ej.status,
    ej.priority,
    ej.retry_count,
    c.name as campaign_name,
    o.name as organization_name
FROM email_jobs ej
JOIN campaigns c ON ej.campaign_id = c.id
JOIN organizations o ON ej.organization_id = o.id
WHERE ej.status IN ('pending', 'processing')
ORDER BY ej.priority DESC, ej.scheduled_for ASC;

-- View for campaign progress
CREATE OR REPLACE VIEW campaign_progress AS
SELECT 
    c.id as campaign_id,
    c.name as campaign_name,
    COUNT(ej.id) as total_jobs,
    COUNT(CASE WHEN ej.status = 'pending' THEN 1 END) as pending_jobs,
    COUNT(CASE WHEN ej.status = 'processing' THEN 1 END) as processing_jobs,
    COUNT(CASE WHEN ej.status = 'sent' THEN 1 END) as sent_jobs,
    COUNT(CASE WHEN ej.status = 'failed' THEN 1 END) as failed_jobs,
    ROUND(
        COUNT(CASE WHEN ej.status = 'sent' THEN 1 END) * 100.0 / 
        NULLIF(COUNT(ej.id), 0), 2
    ) as completion_percentage
FROM campaigns c
LEFT JOIN email_jobs ej ON c.id = ej.campaign_id
GROUP BY c.id, c.name;

-- ================================================================
-- 10. COMMENTS FOR DOCUMENTATION
-- ================================================================

COMMENT ON TABLE email_jobs IS 'Core table for email job queue - replaces Redis queue functionality';
COMMENT ON TABLE campaign_schedules IS 'Campaign-level scheduling configuration and rate limiting';
COMMENT ON TABLE email_rate_limits IS 'Rate limiting tracking to prevent spam and respect provider limits';
COMMENT ON TABLE email_job_logs IS 'Detailed logging for debugging and audit trails';

COMMENT ON COLUMN email_jobs.personalization_data IS 'JSONB field for lead-specific data like {{firstName}}, {{companyName}}, etc.';
COMMENT ON COLUMN email_jobs.rate_limit_key IS 'Key for rate limiting - typically organization_id or campaign_id';
COMMENT ON COLUMN email_jobs.processing_node IS 'Which server/process is handling this job - for distributed systems';

-- ================================================================
-- SCHEMA COMPLETE
-- ================================================================
-- This schema provides:
-- ✅ Enterprise-grade job queue functionality
-- ✅ Built-in rate limiting and cost optimization  
-- ✅ Timezone-aware scheduling
-- ✅ Comprehensive audit trails
-- ✅ Performance optimized with proper indexes
-- ✅ Automatic cleanup to control costs
-- ✅ Monitoring views for operational insights
-- ================================================================
