const crypto = require('crypto');

/**
 * Service for encrypting and decrypting OAuth tokens
 * Compatible with all Node.js versions (uses AES-256-CBC)
 */
class EncryptionService {
    constructor() {
        this.algorithm = 'aes-256-cbc';
        this.keyLength = 32; // 256 bits
        this.ivLength = 16;  // 128 bits
        
        if (!process.env.ENCRYPTION_KEY) {
            throw new Error('ENCRYPTION_KEY environment variable is required');
        }
        
        // Ensure the key is exactly 32 bytes
        this.key = crypto.createHash('sha256')
            .update(process.env.ENCRYPTION_KEY)
            .digest();
    }

    /**
     * Encrypt OAuth tokens for secure storage
     * @param {Object} tokens - The tokens object to encrypt
     * @returns {string} - Base64 encoded encrypted data with IV
     */
    encryptTokens(tokens) {
        try {
            // Convert tokens to JSON string
            const plaintext = JSON.stringify(tokens);
            
            // Generate random IV for each encryption
            const iv = crypto.randomBytes(this.ivLength);
            
            // Create cipher
            const cipher = crypto.createCipher('aes-256-cbc', this.key);
            
            // Encrypt the data
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            // Combine IV + encrypted data
            const combined = Buffer.concat([
                iv,
                Buffer.from(encrypted, 'hex')
            ]);
            
            // Return base64 encoded result
            return combined.toString('base64');
            
        } catch (error) {
            console.error('❌ Error encrypting tokens:', error);
            console.error('Node.js version:', process.version);
            throw new Error('Failed to encrypt tokens');
        }
    }

    /**
     * Decrypt OAuth tokens from storage
     * @param {string} encryptedData - Base64 encoded encrypted data
     * @returns {Object} - The decrypted tokens object
     */
    decryptTokens(encryptedData) {
        try {
            // Decode from base64
            const combined = Buffer.from(encryptedData, 'base64');
            
            // Extract IV and encrypted data
            const iv = combined.subarray(0, this.ivLength);
            const encrypted = combined.subarray(this.ivLength);
            
            // Create decipher
            const decipher = crypto.createDecipher('aes-256-cbc', this.key);
            
            // Decrypt the data
            let decrypted = decipher.update(encrypted, null, 'utf8');
            decrypted += decipher.final('utf8');
            
            // Parse and return the tokens
            return JSON.parse(decrypted);
            
        } catch (error) {
            console.error('❌ Error decrypting tokens:', error);
            console.error('Node.js version:', process.version);
            throw new Error('Failed to decrypt tokens');
        }
    }

    /**
     * Validate that tokens can be encrypted and decrypted correctly
     * @param {Object} testTokens - Test tokens to validate encryption
     * @returns {boolean} - True if encryption/decryption works
     */
    validateEncryption(testTokens = null) {
        try {
            const test = testTokens || {
                access_token: 'test_access_token',
                refresh_token: 'test_refresh_token',
                token_type: 'Bearer',
                expires_in: 3600
            };
            
            console.log('🔧 Testing encryption with Node.js', process.version);
            
            // Test encryption
            const encrypted = this.encryptTokens(test);
            console.log('✅ Encryption successful');
            
            // Test decryption  
            const decrypted = this.decryptTokens(encrypted);
            console.log('✅ Decryption successful');
            
            // Verify they match
            const isValid = JSON.stringify(test) === JSON.stringify(decrypted);
            console.log('✅ Validation result:', isValid);
            
            return isValid;
            
        } catch (error) {
            console.error('❌ Encryption validation failed:', error);
            return false;
        }
    }

    /**
     * Generate a secure random encryption key
     * @returns {string} - 64-character hex string suitable for ENCRYPTION_KEY
     */
    static generateEncryptionKey() {
        return crypto.randomBytes(32).toString('hex');
    }
}

module.exports = EncryptionService;