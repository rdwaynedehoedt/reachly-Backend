# Reachly Backend Server

A Node.js/Express backend server for the Reachly application with custom JWT authentication and Azure PostgreSQL database.

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Azure PostgreSQL database (already set up)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
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
- `JWT_SECRET` - A secure random string for JWT signing

3. Set up the database:
```bash
npm run setup-db
```
This will create all necessary authentication tables in your Azure PostgreSQL database.

4. Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:5000`

### Available Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon
- `npm run setup-db` - Set up the authentication database tables
- `npm run test-connection` - Test database connection
- `npm test` - Run tests (not implemented yet)

### API Endpoints

#### Authentication
- `POST /api/auth/signup` - Register a new user
- `POST /api/auth/login` - Login a user
- `POST /api/auth/logout` - Logout a user
- `POST /api/auth/refresh-token` - Refresh access token
- `GET /api/auth/me` - Get current user information

#### Health Check
- `GET /` - Basic server info
- `GET /api/db-test` - Test database connection

### Environment Variables

See `env.example` for required environment variables:
- `JWT_SECRET` - Secret key for JWT token signing
- `AZURE_PG_*` - Azure PostgreSQL connection details

## Database Schema

The authentication system includes tables for:
- **users** - User accounts with authentication
- **user_profiles** - Extended user information
- **organizations** - Multi-tenant organizations
- **organization_members** - User-organization relationships
- **refresh_tokens** - Secure token refresh system

## Security Features

- **Password Hashing** - Bcrypt with salt rounds
- **JWT Tokens** - Stateless authentication
- **Refresh Tokens** - Secure session management
- **CORS Protection** - Cross-origin request security
- **Input Validation** - Express-validator middleware
- **SQL Injection Protection** - Parameterized queries

## Tech Stack

- **Express.js** - Web framework
- **Azure PostgreSQL** - Database
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT token management
- **CORS** - Cross-origin resource sharing
- **express-validator** - Input validation
- **cookie-parser** - Cookie handling
- **pg** - PostgreSQL client