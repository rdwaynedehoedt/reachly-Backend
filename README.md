# Reachly Backend Server

A Node.js/Express backend server for the Reachly email automation platform with OAuth authentication, Gmail integration, and Azure PostgreSQL database.

## 🚀 Features

- **OAuth Authentication** - Google OAuth 2.0 integration
- **Gmail Integration** - Send and manage emails via Gmail API
- **Lead Management** - Import and manage leads from CSV files
- **Campaign Automation** - Email campaign management system
- **Secure Authentication** - JWT-based auth with refresh tokens
- **Azure PostgreSQL** - Cloud database integration
- **Microservices Ready** - Scalable architecture

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Azure PostgreSQL database
- Google Cloud Console project with OAuth 2.0 credentials

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
```bash
cp env.example .env
```

Then edit `.env` with your actual credentials:

**⚠️ SECURITY WARNING: Never commit .env files or expose credentials in code!**

Required environment variables:
- `AZURE_PG_HOST` - Your Azure PostgreSQL host
- `AZURE_PG_USER` - Your database username  
- `AZURE_PG_PASSWORD` - Your database password
- `GOOGLE_CLIENT_ID` - Your Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Your Google OAuth client secret
- `EMAIL_OAUTH_CLIENT_ID` - Your Gmail integration OAuth client ID
- `EMAIL_OAUTH_CLIENT_SECRET` - Your Gmail integration OAuth client secret
- `JWT_SECRET` - A secure random string for JWT signing
- `REFRESH_TOKEN_SECRET` - A secure random string for refresh tokens

3. **Set up the database:**
```bash
npm run setup-db
```
This will create all necessary tables in your Azure PostgreSQL database.

4. **Start the development server:**
```bash
npm run dev
```

The server will start on `http://localhost:5000`

### Available Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon
- `npm run setup-db` - Set up the database tables
- `npm run setup-env` - Interactive environment setup
- `npm test` - Run tests

### API Endpoints

#### Authentication
- `POST /api/auth/signup` - Register a new user
- `POST /api/auth/login` - Login a user
- `POST /api/auth/logout` - Logout a user
- `POST /api/auth/refresh-token` - Refresh access token
- `GET /api/auth/me` - Get current user information

#### OAuth Integration
- `GET /api/oauth/google` - Initiate Google OAuth flow
- `GET /api/oauth/google/callback` - Handle OAuth callback
- `POST /api/oauth/revoke` - Revoke OAuth tokens

#### Email Authentication
- `POST /api/email-auth/connect` - Connect Gmail account
- `GET /api/email-auth/status` - Check email connection status
- `POST /api/email-auth/disconnect` - Disconnect Gmail account

#### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile

#### Health Check
- `GET /` - Basic server info
- `GET /api/db-test` - Test database connection

## 🗄️ Database Schema

The system includes the following tables:
- **users** - User accounts with authentication
- **user_profiles** - Extended user information
- **organizations** - Multi-tenant organizations
- **organization_members** - User-organization relationships
- **refresh_tokens** - Secure token refresh system
- **email_accounts** - Connected Gmail accounts
- **email_authentication** - OAuth tokens for email accounts

## 🔒 Security Features

- **OAuth 2.0** - Google OAuth authentication
- **Password Hashing** - Bcrypt with salt rounds
- **JWT Tokens** - Stateless authentication
- **Refresh Tokens** - Secure session management
- **CORS Protection** - Cross-origin request security
- **Input Validation** - Express-validator middleware
- **SQL Injection Protection** - Parameterized queries
- **Token Encryption** - Encrypted OAuth tokens storage

## 🏗️ Architecture

### Enterprise OAuth Pattern
The application uses a **dual OAuth client architecture** for enterprise scalability:

- **Authentication Client** - Handles user login/signup flows
- **Email Integration Client** - Dedicated Gmail API access

This pattern provides:
- ✅ Independent rate limits
- ✅ Security isolation
- ✅ Microservices readiness
- ✅ Enterprise compliance

### Tech Stack

- **Express.js** - Web framework
- **Azure PostgreSQL** - Cloud database
- **Google APIs** - Gmail integration
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT token management
- **CORS** - Cross-origin resource sharing
- **express-validator** - Input validation
- **cookie-parser** - Cookie handling
- **pg** - PostgreSQL client
- **googleapis** - Google API client

## 📁 Project Structure

```
reachly-Backend/
├── config/
│   ├── database.js      # Database configuration
│   └── oauth.js         # OAuth configuration
├── controllers/
│   ├── auth.controller.js      # Authentication logic
│   ├── emailAuth.controller.js # Email auth logic
│   ├── oauth.controller.js     # OAuth flows
│   └── user.controller.js      # User management
├── database/
│   ├── auth-schema.sql         # Authentication tables
│   └── email-accounts-schema.sql # Email integration tables
├── middleware/
│   └── auth.middleware.js      # Authentication middleware
├── routes/
│   ├── auth.js          # Auth routes
│   ├── emailAuth.js     # Email auth routes
│   ├── oauth.js         # OAuth routes
│   └── user.js          # User routes
├── scripts/
│   ├── clean-and-setup-db.js  # Database setup
│   ├── clean-tables.js         # Database cleanup
│   └── setup-env.js            # Environment setup
├── services/
│   ├── encryptionService.js    # Token encryption
│   └── gmailService.js         # Gmail API integration
└── server.js            # Main server file
```

## 🚀 Deployment

1. Set environment variables in your production environment
2. Run `npm run setup-db` to initialize the database
3. Start the server with `npm start`
4. Configure Google Cloud Console with production redirect URIs

## 📝 License

ISC License - See LICENSE file for details

## 🔧 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify Azure PostgreSQL credentials
   - Check firewall settings
   - Ensure SSL is enabled

2. **OAuth Errors**
   - Verify Google Cloud Console configuration
   - Check redirect URIs match exactly
   - Ensure OAuth clients are enabled

3. **Gmail API Issues**
   - Verify Gmail API is enabled in Google Cloud Console
   - Check OAuth scopes are correct
   - Ensure tokens are properly encrypted

For more detailed troubleshooting, see the documentation in the `docs/` directory.