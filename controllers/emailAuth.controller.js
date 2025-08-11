const { google } = require('googleapis');
const crypto = require('crypto');
const pool = require('../config/database');
const EncryptionService = require('../services/encryptionService');

/**
 * Controller for handling OAuth authentication with email providers
 */
class EmailAuthController {
    constructor() {
        this.encryptionService = new EncryptionService();
        
        // Gmail OAuth scopes
        this.gmailScopes = [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];
    }

    /**
     * Create OAuth2 client for Google (Email-specific)
     */
    createGoogleOAuth2Client() {
        return new google.auth.OAuth2(
            process.env.EMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
            process.env.EMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
            process.env.EMAIL_OAUTH_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI
        );
    }

    /**
     * Initiate Google OAuth flow
     * GET /auth/google/connect
     */
    async initiateGoogleAuth(req, res) {
        try {
            const userId = req.user.userId; // From auth middleware
            
            // Create OAuth2 client
            const oauth2Client = this.createGoogleOAuth2Client();
            
            // Generate state parameter for security (CSRF protection)
            const state = crypto.randomBytes(32).toString('hex');
            
            // Store state temporarily (in production, use Redis or session)
            // For now, we'll encode userId in the state
            const stateData = {
                userId: userId,
                timestamp: Date.now(),
                random: state
            };
            const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64');
            
            // Generate authorization URL
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline', // Request refresh token
                scope: this.gmailScopes,
                state: encodedState,
                prompt: 'consent' // Force consent screen to get refresh token
            });
            
            console.log(`🔗 Generated OAuth URL for user ${userId}`);
            
            res.json({
                success: true,
                authUrl: authUrl,
                provider: 'gmail'
            });
            
        } catch (error) {
            console.error('❌ Error initiating Google OAuth:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to initiate OAuth flow',
                error: error.message
            });
        }
    }

    /**
     * Handle Google OAuth callback
     * GET /auth/google/callback
     */
    async handleGoogleCallback(req, res) {
        try {
            const { code, state, error } = req.query;
            
            // Check for OAuth errors
            if (error) {
                console.error('❌ OAuth error:', error);
                return res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=oauth_error&details=${error}`);
            }
            
            if (!code || !state) {
                return res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=missing_params`);
            }
            
            // Decode and validate state
            let stateData;
            try {
                stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            } catch {
                return res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=invalid_state`);
            }
            
            // Check state timestamp (expire after 10 minutes)
            if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
                return res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=expired_state`);
            }
            
            const userId = stateData.userId;
            
            // Create OAuth2 client and exchange code for tokens
            const oauth2Client = this.createGoogleOAuth2Client();
            const { tokens } = await oauth2Client.getToken(code);
            
            // Set credentials to get user info
            oauth2Client.setCredentials(tokens);
            
            // Get user information
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            
            const { email, name, picture } = userInfo.data;
            
            console.log(`📧 Connected Gmail account: ${email} for user ${userId}`);
            
            // Store encrypted tokens in database
            await this.storeEmailAccount(userId, {
                provider: 'gmail',
                email: email,
                displayName: name,
                tokens: tokens,
                scopes: this.gmailScopes
            });
            
            // Redirect back to frontend with success
            res.redirect(`${process.env.FRONTEND_URL}/onboarding?connected=gmail&email=${encodeURIComponent(email)}`);
            
        } catch (error) {
            console.error('❌ Error handling Google OAuth callback:', error);
            res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=callback_error&details=${error.message}`);
        }
    }

    /**
     * Store email account with encrypted tokens
     */
    async storeEmailAccount(userId, accountData) {
        const client = await pool.connect();
        
        try {
            // Check if account already exists
            const existingAccount = await client.query(
                'SELECT id FROM email_accounts WHERE user_id = $1 AND email = $2 AND provider = $3',
                [userId, accountData.email, accountData.provider]
            );
            
            // Encrypt tokens
            const encryptedTokens = this.encryptionService.encryptTokens(accountData.tokens);
            
            // Calculate token expiry
            const expiresAt = accountData.tokens.expiry_date 
                ? new Date(accountData.tokens.expiry_date)
                : new Date(Date.now() + (accountData.tokens.expires_in || 3600) * 1000);
            
            if (existingAccount.rows.length > 0) {
                // Update existing account
                await client.query(`
                    UPDATE email_accounts 
                    SET encrypted_tokens = $1, 
                        token_expires_at = $2, 
                        scopes = $3, 
                        status = 'active',
                        display_name = $4,
                        updated_at = NOW()
                    WHERE user_id = $5 AND email = $6 AND provider = $7
                `, [
                    encryptedTokens,
                    expiresAt,
                    accountData.scopes,
                    accountData.displayName,
                    userId,
                    accountData.email,
                    accountData.provider
                ]);
                
                console.log(`✅ Updated existing email account: ${accountData.email}`);
                
            } else {
                // Insert new account
                await client.query(`
                    INSERT INTO email_accounts (
                        user_id, provider, email, display_name, 
                        encrypted_tokens, token_expires_at, scopes, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
                `, [
                    userId,
                    accountData.provider,
                    accountData.email,
                    accountData.displayName,
                    encryptedTokens,
                    expiresAt,
                    accountData.scopes
                ]);
                
                console.log(`✅ Stored new email account: ${accountData.email}`);
            }
            
        } finally {
            client.release();
        }
    }

    /**
     * Get user's connected email accounts
     * GET /auth/email-accounts
     */
    async getEmailAccounts(req, res) {
        try {
            const userId = req.user.userId;
            
            const client = await pool.connect();
            
            try {
                const result = await client.query(`
                    SELECT id, provider, email, display_name, status, 
                           token_expires_at, scopes, created_at, last_synced_at
                    FROM email_accounts 
                    WHERE user_id = $1 
                    ORDER BY created_at DESC
                `, [userId]);
                
                const accounts = result.rows.map(account => ({
                    id: account.id,
                    provider: account.provider,
                    email: account.email,
                    displayName: account.display_name,
                    status: account.status,
                    expiresAt: account.token_expires_at,
                    scopes: account.scopes,
                    createdAt: account.created_at,
                    lastSyncedAt: account.last_synced_at
                }));
                
                res.json({
                    success: true,
                    accounts: accounts
                });
                
            } finally {
                client.release();
            }
            
        } catch (error) {
            console.error('❌ Error fetching email accounts:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch email accounts',
                error: error.message
            });
        }
    }

    /**
     * Disconnect email account
     * DELETE /auth/email-accounts/:accountId
     */
    async disconnectEmailAccount(req, res) {
        try {
            const userId = req.user.userId;
            const { accountId } = req.params;
            
            const client = await pool.connect();
            
            try {
                // Get account details before deletion
                const accountResult = await client.query(
                    'SELECT provider, email, encrypted_tokens FROM email_accounts WHERE id = $1 AND user_id = $2',
                    [accountId, userId]
                );
                
                if (accountResult.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Email account not found'
                    });
                }
                
                const account = accountResult.rows[0];
                
                // For Google accounts, revoke the tokens
                if (account.provider === 'gmail') {
                    try {
                        const tokens = this.encryptionService.decryptTokens(account.encrypted_tokens);
                        const oauth2Client = this.createGoogleOAuth2Client();
                        oauth2Client.setCredentials(tokens);
                        await oauth2Client.revokeCredentials();
                    } catch (revokeError) {
                        console.warn('⚠️ Failed to revoke Google tokens:', revokeError.message);
                        // Continue with deletion even if revoke fails
                    }
                }
                
                // Delete the account
                await client.query(
                    'DELETE FROM email_accounts WHERE id = $1 AND user_id = $2',
                    [accountId, userId]
                );
                
                console.log(`✅ Disconnected email account: ${account.email}`);
                
                res.json({
                    success: true,
                    message: 'Email account disconnected successfully'
                });
                
            } finally {
                client.release();
            }
            
        } catch (error) {
            console.error('❌ Error disconnecting email account:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to disconnect email account',
                error: error.message
            });
        }
    }
}

module.exports = new EmailAuthController();
