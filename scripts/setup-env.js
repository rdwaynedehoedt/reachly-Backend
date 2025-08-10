const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔐 Secure Environment Setup for Reachly Backend\n');
console.log('⚠️  This script will help you create a secure .env file.');
console.log('💡 Your credentials will only be stored locally and never exposed.\n');

const questions = [
  { key: 'AZURE_PG_HOST', prompt: 'Enter your Azure PostgreSQL host: ' },
  { key: 'AZURE_PG_DATABASE', prompt: 'Enter your database name (default: postgres): ' },
  { key: 'AZURE_PG_USER', prompt: 'Enter your database username: ' },
  { key: 'AZURE_PG_PASSWORD', prompt: 'Enter your database password: ' },
  { key: 'GOOGLE_CLIENT_ID', prompt: 'Enter your Google OAuth Client ID: ' },
  { key: 'GOOGLE_CLIENT_SECRET', prompt: 'Enter your Google OAuth Client Secret: ' },
];

let envData = {
  PORT: '5000',
  NODE_ENV: 'development',
  AZURE_PG_PORT: '5432',
  AZURE_PG_SSL: 'true',
  JWT_SECRET: generateSecureSecret(),
  JWT_EXPIRES_IN: '15m',
  REFRESH_TOKEN_SECRET: generateSecureSecret(),
  REFRESH_TOKEN_EXPIRES_IN: '7d',
  FRONTEND_URL: 'http://localhost:3000'
};

function generateSecureSecret() {
  return require('crypto').randomBytes(32).toString('hex');
}

async function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question.prompt, (answer) => {
      envData[question.key] = answer || (question.key === 'AZURE_PG_DATABASE' ? 'postgres' : '');
      resolve();
    });
  });
}

async function setupEnvironment() {
  try {
    console.log('Please provide your credentials:\n');

    for (const question of questions) {
      await askQuestion(question);
    }

    // Generate .env content
    const envContent = Object.entries(envData)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Write .env file
    fs.writeFileSync('.env', envContent);

    console.log('\n✅ Environment file created successfully!');
    console.log('📁 File: .env');
    console.log('🔒 Your credentials are secure and local only.');
    console.log('\n🚀 Next steps:');
    console.log('   1. npm run setup-db');
    console.log('   2. npm run dev');

  } catch (error) {
    console.error('❌ Error setting up environment:', error.message);
  } finally {
    rl.close();
  }
}

// Check if .env already exists
if (fs.existsSync('.env')) {
  rl.question('\n⚠️  .env file already exists. Overwrite? (y/N): ', (answer) => {
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      setupEnvironment();
    } else {
      console.log('✅ Keeping existing .env file.');
      rl.close();
    }
  });
} else {
  setupEnvironment();
}