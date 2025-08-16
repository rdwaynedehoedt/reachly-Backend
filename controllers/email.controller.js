const gmailService = require('../services/gmailService');
const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Email Controller - Handles email sending and management
 */
class EmailController {

    /**
     * Send a single email
     * POST /api/emails/send
     */
    async sendEmail(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { 
                to, 
                subject, 
                textBody, 
                htmlBody, 
                accountId,
                cc,
                bcc 
            } = req.body;

            // Validation
            if (!to || !subject || (!textBody && !htmlBody)) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: to, subject, and either textBody or htmlBody'
                });
            }

            // Verify user owns the email account
            const accountResult = await client.query(`
                SELECT ea.*, u.email as user_email 
                FROM email_accounts ea
                JOIN users u ON ea.user_id = u.id
                WHERE ea.id = $1 AND ea.user_id = $2 AND ea.status = 'active'
            `, [accountId, userId]);

            if (accountResult.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Email account not found or access denied'
                });
            }

            const emailAccount = accountResult.rows[0];

            // Prepare email data
            const emailData = {
                to,
                subject,
                textBody,
                htmlBody,
                cc,
                bcc
            };

            // Send email using Gmail service
            console.log(`📧 Sending email from ${emailAccount.email} to ${to}`);
            const sendResult = await gmailService.sendEmail(accountId, emailData);

            // Log the email send to database
            const emailLogId = uuidv4();
            await client.query(`
                INSERT INTO email_sends (
                    id, user_id, email_account_id, recipient_email, 
                    subject, message_id, thread_id, status, sent_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            `, [
                emailLogId,
                userId,
                accountId,
                to,
                subject,
                sendResult.messageId,
                sendResult.threadId,
                'sent'
            ]);

            console.log(`✅ Email logged to database with ID: ${emailLogId}`);

            return res.status(200).json({
                success: true,
                message: 'Email sent successfully',
                data: {
                    emailId: emailLogId,
                    messageId: sendResult.messageId,
                    threadId: sendResult.threadId,
                    from: sendResult.from,
                    to: sendResult.to,
                    subject: sendResult.subject,
                    sentAt: new Date()
                }
            });

        } catch (error) {
            console.error('❌ Email sending error:', error);
            
            // Log failed attempt to database
            try {
                await client.query(`
                    INSERT INTO email_sends (
                        id, user_id, email_account_id, recipient_email, 
                        subject, status, error_message, sent_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                `, [
                    uuidv4(),
                    req.user.userId,
                    req.body.accountId,
                    req.body.to,
                    req.body.subject,
                    'failed',
                    error.message
                ]);
            } catch (logError) {
                console.error('❌ Failed to log email error:', logError);
            }

            return res.status(500).json({
                success: false,
                message: 'Failed to send email',
                error: error.message
            });
        } finally {
            client.release();
        }
    }

    /**
     * Get user's email accounts for sending
     * GET /api/emails/accounts
     */
    async getEmailAccounts(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;

            const result = await client.query(`
                SELECT 
                    id, email, display_name, provider, status, 
                    scopes, last_synced_at, created_at
                FROM email_accounts 
                WHERE user_id = $1 AND status = 'active'
                ORDER BY created_at DESC
            `, [userId]);

            return res.status(200).json({
                success: true,
                accounts: result.rows,
                total: result.rows.length
            });

        } catch (error) {
            console.error('❌ Get email accounts error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch email accounts'
            });
        } finally {
            client.release();
        }
    }

    /**
     * Test email account connection
     * POST /api/emails/test-connection
     */
    async testConnection(req, res) {
        try {
            const { accountId } = req.body;
            const userId = req.user.userId;

            // Verify ownership
            const client = await pool.connect();
            try {
                const result = await client.query(
                    'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
                    [accountId, userId]
                );

                if (result.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        message: 'Email account not found or access denied'
                    });
                }
            } finally {
                client.release();
            }

            // Test connection
            const testResult = await gmailService.testConnection(accountId);

            return res.status(200).json({
                success: true,
                message: 'Connection test successful',
                data: testResult
            });

        } catch (error) {
            console.error('❌ Connection test error:', error);
            return res.status(500).json({
                success: false,
                message: 'Connection test failed',
                error: error.message
            });
        }
    }

    /**
     * Get email sending history
     * GET /api/emails/history
     */
    async getEmailHistory(req, res) {
        const client = await pool.connect();
        
        try {
            const userId = req.user.userId;
            const { limit = 20, offset = 0, status } = req.query;

            let whereClause = 'WHERE es.user_id = $1';
            let params = [userId];

            if (status) {
                whereClause += ' AND es.status = $2';
                params.push(status);
            }

            const result = await client.query(`
                SELECT 
                    es.id, es.recipient_email, es.subject, es.status,
                    es.message_id, es.sent_at, es.error_message,
                    ea.email as from_email, ea.display_name
                FROM email_sends es
                JOIN email_accounts ea ON es.email_account_id = ea.id
                ${whereClause}
                ORDER BY es.sent_at DESC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `, [...params, limit, offset]);

            // Get total count
            const countResult = await client.query(`
                SELECT COUNT(*) as total
                FROM email_sends es
                ${whereClause}
            `, params);

            return res.status(200).json({
                success: true,
                data: {
                    emails: result.rows,
                    total: parseInt(countResult.rows[0].total),
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            });

        } catch (error) {
            console.error('❌ Get email history error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch email history'
            });
        } finally {
            client.release();
        }
    }
}

module.exports = new EmailController();
