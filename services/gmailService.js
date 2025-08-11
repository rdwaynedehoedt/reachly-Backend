const { google } = require('googleapis');
const pool = require('../config/database');
const EncryptionService = require('./encryptionService');

/**
 * Service for Gmail API operations
 * Handles sending emails, reading emails, and token management
 */
class GmailService {
    constructor() {
        this.encryptionService = new EncryptionService();
    }

    /**
     * Create OAuth2 client with stored tokens for a user account
     */
    async createAuthenticatedClient(accountId) {
        const client = await pool.connect();
        
        try {
            // Get account and tokens
            const result = await client.query(
                'SELECT encrypted_tokens, email, status FROM email_accounts WHERE id = $1',
                [accountId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Email account not found');
            }
            
            const account = result.rows[0];
            
            if (account.status !== 'active') {
                throw new Error(`Email account is ${account.status}`);
            }
            
            // Decrypt tokens
            const tokens = this.encryptionService.decryptTokens(account.encrypted_tokens);
            
            // Create OAuth2 client
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            
            // Set credentials
            oauth2Client.setCredentials(tokens);
            
            // Check if token needs refresh
            if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
                console.log(`🔄 Refreshing expired tokens for ${account.email}`);
                await this.refreshTokens(accountId, oauth2Client);
            }
            
            return { oauth2Client, email: account.email };
            
        } finally {
            client.release();
        }
    }

    /**
     * Refresh expired tokens
     */
    async refreshTokens(accountId, oauth2Client) {
        try {
            // Refresh the tokens
            const { credentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(credentials);
            
            // Encrypt and store new tokens
            const encryptedTokens = this.encryptionService.encryptTokens(credentials);
            
            // Update database
            const client = await pool.connect();
            try {
                await client.query(`
                    UPDATE email_accounts 
                    SET encrypted_tokens = $1, 
                        token_expires_at = $2,
                        status = 'active',
                        updated_at = NOW()
                    WHERE id = $3
                `, [
                    encryptedTokens,
                    new Date(credentials.expiry_date),
                    accountId
                ]);
                
                console.log(`✅ Refreshed tokens for account ${accountId}`);
                
            } finally {
                client.release();
            }
            
        } catch (error) {
            console.error('❌ Failed to refresh tokens:', error);
            
            // Mark account as expired
            const client = await pool.connect();
            try {
                await client.query(
                    'UPDATE email_accounts SET status = $1 WHERE id = $2',
                    ['expired', accountId]
                );
            } finally {
                client.release();
            }
            
            throw new Error('Failed to refresh tokens - account marked as expired');
        }
    }

    /**
     * Send email through Gmail API
     */
    async sendEmail(accountId, emailData) {
        try {
            const { oauth2Client, email: fromEmail } = await this.createAuthenticatedClient(accountId);
            
            // Create Gmail API client
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            // Construct email message
            const message = this.constructEmailMessage({
                from: fromEmail,
                to: emailData.to,
                cc: emailData.cc,
                bcc: emailData.bcc,
                subject: emailData.subject,
                textBody: emailData.textBody,
                htmlBody: emailData.htmlBody,
                attachments: emailData.attachments
            });
            
            // Send email
            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: message
                }
            });
            
            console.log(`📧 Email sent successfully from ${fromEmail} to ${emailData.to}`);
            console.log(`📋 Message ID: ${response.data.id}`);
            
            return {
                success: true,
                messageId: response.data.id,
                threadId: response.data.threadId,
                from: fromEmail,
                to: emailData.to,
                subject: emailData.subject
            };
            
        } catch (error) {
            console.error('❌ Failed to send email:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    /**
     * Construct RFC 2822 email message
     */
    constructEmailMessage(emailData) {
        const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        let message = '';
        
        // Headers
        message += `From: ${emailData.from}\r\n`;
        message += `To: ${emailData.to}\r\n`;
        
        if (emailData.cc) {
            message += `Cc: ${emailData.cc}\r\n`;
        }
        
        if (emailData.bcc) {
            message += `Bcc: ${emailData.bcc}\r\n`;
        }
        
        message += `Subject: ${emailData.subject}\r\n`;
        message += `MIME-Version: 1.0\r\n`;
        message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
        
        // Text body
        if (emailData.textBody) {
            message += `--${boundary}\r\n`;
            message += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
            message += `${emailData.textBody}\r\n\r\n`;
        }
        
        // HTML body
        if (emailData.htmlBody) {
            message += `--${boundary}\r\n`;
            message += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
            message += `${emailData.htmlBody}\r\n\r\n`;
        }
        
        message += `--${boundary}--\r\n`;
        
        // Convert to base64url
        return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /**
     * Get recent emails
     */
    async getEmails(accountId, options = {}) {
        try {
            const { oauth2Client, email: fromEmail } = await this.createAuthenticatedClient(accountId);
            
            // Create Gmail API client
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            // Get message list
            const listResponse = await gmail.users.messages.list({
                userId: 'me',
                maxResults: options.maxResults || 10,
                q: options.query || ''
            });
            
            if (!listResponse.data.messages) {
                return [];
            }
            
            // Get message details
            const messages = await Promise.all(
                listResponse.data.messages.map(async (message) => {
                    const messageResponse = await gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'full'
                    });
                    
                    return this.parseEmailMessage(messageResponse.data);
                })
            );
            
            console.log(`📧 Retrieved ${messages.length} emails for ${fromEmail}`);
            
            return messages;
            
        } catch (error) {
            console.error('❌ Failed to get emails:', error);
            throw new Error(`Failed to get emails: ${error.message}`);
        }
    }

    /**
     * Parse Gmail message to standard format
     */
    parseEmailMessage(message) {
        const headers = message.payload.headers;
        
        const getHeader = (name) => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header ? header.value : '';
        };
        
        // Extract body
        let textBody = '';
        let htmlBody = '';
        
        const extractBody = (part) => {
            if (part.mimeType === 'text/plain' && part.body.data) {
                textBody = Buffer.from(part.body.data, 'base64').toString('utf8');
            } else if (part.mimeType === 'text/html' && part.body.data) {
                htmlBody = Buffer.from(part.body.data, 'base64').toString('utf8');
            } else if (part.parts) {
                part.parts.forEach(extractBody);
            }
        };
        
        if (message.payload.parts) {
            message.payload.parts.forEach(extractBody);
        } else if (message.payload.body.data) {
            extractBody(message.payload);
        }
        
        return {
            id: message.id,
            threadId: message.threadId,
            from: getHeader('From'),
            to: getHeader('To'),
            cc: getHeader('Cc'),
            subject: getHeader('Subject'),
            date: new Date(getHeader('Date')),
            textBody: textBody,
            htmlBody: htmlBody,
            snippet: message.snippet,
            labelIds: message.labelIds || []
        };
    }

    /**
     * Test email account connection
     */
    async testConnection(accountId) {
        try {
            const { oauth2Client, email } = await this.createAuthenticatedClient(accountId);
            
            // Create Gmail API client
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            
            // Test by getting profile info
            const profile = await gmail.users.getProfile({ userId: 'me' });
            
            console.log(`✅ Connection test successful for ${email}`);
            
            return {
                success: true,
                email: email,
                messagesTotal: profile.data.messagesTotal,
                threadsTotal: profile.data.threadsTotal
            };
            
        } catch (error) {
            console.error('❌ Connection test failed:', error);
            throw new Error(`Connection test failed: ${error.message}`);
        }
    }
}

module.exports = new GmailService();
