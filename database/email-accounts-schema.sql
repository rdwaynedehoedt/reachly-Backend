-- Email Accounts Table for OAuth Token Storage
-- This table stores encrypted OAuth tokens for connected email accounts

CREATE TABLE IF NOT EXISTS email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Provider information
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap_smtp')),
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    
    -- OAuth token storage (encrypted)
    encrypted_tokens TEXT NOT NULL, -- Contains access_token, refresh_token, token_type
    token_expires_at TIMESTAMP,
    scopes TEXT[] DEFAULT '{}', -- e.g., ['gmail.send', 'gmail.readonly']
    
    -- Account status and metadata
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
    last_synced_at TIMESTAMP,
    sync_enabled BOOLEAN DEFAULT true,
    
    -- Provider-specific settings
    provider_settings JSONB DEFAULT '{}', -- For IMAP/SMTP settings, etc.
    
    -- Tracking
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(user_id, email, provider)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_accounts_user_id ON email_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON email_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
CREATE INDEX IF NOT EXISTS idx_email_accounts_expires ON email_accounts(token_expires_at) WHERE token_expires_at IS NOT NULL;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_email_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_email_accounts_updated_at
    BEFORE UPDATE ON email_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_email_accounts_updated_at();

-- Comments for documentation
COMMENT ON TABLE email_accounts IS 'Stores OAuth tokens and settings for connected email accounts';
COMMENT ON COLUMN email_accounts.encrypted_tokens IS 'AES-256-GCM encrypted JSON containing OAuth tokens';
COMMENT ON COLUMN email_accounts.scopes IS 'Array of granted OAuth scopes';
COMMENT ON COLUMN email_accounts.provider_settings IS 'Provider-specific configuration (IMAP settings, etc.)';
