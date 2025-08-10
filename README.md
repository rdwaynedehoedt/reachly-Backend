# Reachly Backend Server

A Node.js/Express backend server for the Reachly application with Supabase integration.

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Supabase account

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```
Then edit `.env` with your actual Supabase credentials.

3. Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:5000`

### Available Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon
- `npm test` - Run tests (not implemented yet)

### API Endpoints

- `GET /` - Basic server info
- `GET /api/health` - Health check endpoint

### Environment Variables

See `.env.example` for required environment variables.

## Tech Stack

- **Express.js** - Web framework
- **Supabase** - Database and authentication
- **CORS** - Cross-origin resource sharing
- **Helmet** - Security middleware
- **Morgan** - HTTP request logger
- **dotenv** - Environment variable management