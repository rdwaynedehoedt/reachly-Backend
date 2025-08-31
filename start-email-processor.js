#!/usr/bin/env node

/**
 * Email Job Processor Startup Script
 * 
 * This script starts the background email job processor service.
 * It can be run as:
 * - A standalone Node.js process
 * - A PM2 managed service
 * - A Docker container
 * - A systemd service
 * - A cron job (though continuous mode is recommended)
 */

const emailJobProcessor = require('./services/emailJobProcessor');

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('⚠️  Force shutdown...');
        process.exit(1);
    }
    
    console.log(`\n📧 Received ${signal}, starting graceful shutdown...`);
    isShuttingDown = true;
    
    try {
        await emailJobProcessor.stop();
        console.log('✅ Email processor stopped gracefully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
}

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // PM2 reload

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

// Main startup function
async function startEmailProcessor() {
    console.log('🚀 ===============================================');
    console.log('📧 REACHLY EMAIL JOB PROCESSOR STARTING...');
    console.log('🚀 ===============================================');
    console.log('');
    console.log(`🕐 Started at: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`🖥️  Node Version: ${process.version}`);
    console.log(`📁 Working Directory: ${process.cwd()}`);
    console.log('');

    try {
        // Test database connection first
        console.log('🔍 Testing database connection...');
        const pool = require('./config/database');
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('✅ Database connection successful');

        // Check for existing email accounts
        const client2 = await pool.connect();
        const accountsResult = await client2.query(`
            SELECT COUNT(*) as count FROM email_accounts WHERE status = 'active'
        `);
        const activeAccounts = parseInt(accountsResult.rows[0].count);
        client2.release();
        
        console.log(`📧 Found ${activeAccounts} active email accounts`);
        
        if (activeAccounts === 0) {
            console.log('⚠️  WARNING: No active email accounts found. Emails cannot be sent until accounts are configured.');
        }

        // Start the processor
        await emailJobProcessor.start();
        
        console.log('');
        console.log('✅ ===============================================');
        console.log('📧 EMAIL JOB PROCESSOR RUNNING SUCCESSFULLY!');
        console.log('✅ ===============================================');
        console.log('');
        console.log('📊 To monitor processor status:');
        console.log('   - Check logs for processing activity');
        console.log('   - Use /api/admin/processor-status endpoint');
        console.log('   - Monitor email_jobs table in database');
        console.log('');
        console.log('🛑 To stop processor: Ctrl+C or SIGTERM');
        console.log('');

        // Display initial status
        const status = await emailJobProcessor.getStatus();
        console.log('📈 Initial Status:', JSON.stringify(status, null, 2));
        
    } catch (error) {
        console.error('❌ Failed to start email processor:', error);
        process.exit(1);
    }
}

// Command line options
const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const showStatus = args.includes('--status') || args.includes('-s');
const processNow = args.includes('--process-now') || args.includes('-p');

if (showHelp) {
    console.log(`
📧 Reachly Email Job Processor

USAGE:
  node start-email-processor.js [OPTIONS]

OPTIONS:
  --help, -h        Show this help message
  --status, -s      Show current processor status and exit
  --process-now, -p Process pending jobs immediately and show status

EXAMPLES:
  node start-email-processor.js              # Start continuous processing
  node start-email-processor.js --status     # Check status
  node start-email-processor.js --process-now # Process jobs once

ENVIRONMENT VARIABLES:
  EMAIL_PROCESSOR_INTERVAL   Processing interval in ms (default: 30000)
  EMAIL_PROCESSOR_MAX_JOBS   Max concurrent jobs (default: 10)

PRODUCTION DEPLOYMENT:
  # PM2 (recommended)
  pm2 start start-email-processor.js --name "email-processor"
  
  # Docker
  FROM node:16
  COPY . /app
  WORKDIR /app
  CMD ["node", "start-email-processor.js"]
  
  # Systemd service
  [Unit]
  Description=Reachly Email Job Processor
  After=network.target
  
  [Service]
  Type=simple
  User=reachly
  WorkingDirectory=/path/to/reachly-backend
  ExecStart=/usr/bin/node start-email-processor.js
  Restart=always
  
  [Install]
  WantedBy=multi-user.target
`);
    process.exit(0);
}

if (showStatus) {
    (async () => {
        try {
            console.log('📊 Getting processor status...');
            const status = await emailJobProcessor.getStatus();
            console.log('\n📈 PROCESSOR STATUS:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(JSON.stringify(status, null, 2));
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error getting status:', error);
            process.exit(1);
        }
    })();
} else if (processNow) {
    (async () => {
        try {
            console.log('⚡ Processing jobs immediately...');
            const result = await emailJobProcessor.processNow();
            console.log('\n✅ PROCESSING COMPLETE:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(JSON.stringify(result, null, 2));
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error processing jobs:', error);
            process.exit(1);
        }
    })();
} else {
    // Start continuous processing
    startEmailProcessor();
}
