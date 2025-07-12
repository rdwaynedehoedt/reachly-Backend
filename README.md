# Reachly Backend

Backend service for Reachly - a B2B lead generation SaaS platform.

## Overview

Reachly helps businesses find targeted B2B leads through integrations with Clay & Lusha. The platform provides a clean dashboard to view leads, tracks user quotas, and allows for CSV exports.

## Features

- User authentication and authorization
- Lead generation with customizable filters
- Credit-based usage tracking
- Lead export functionality
- Admin dashboard

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT
- **API Integrations**: Clay & Lusha

## Getting Started

### Prerequisites

- Node.js (v16+)
- PostgreSQL
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/reachly-backend.git
cd reachly-backend
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
```
Edit the `.env` file with your configuration.

4. Set up the database
```bash
npx prisma migrate dev
```

5. Start the development server
```bash
npm run dev
```

## Project Structure

```
reachly-backend/
├── src/
│   ├── config/         # Configuration files
│   ├── controllers/    # Request handlers
│   ├── middleware/     # Express middleware
│   ├── models/         # Prisma models
│   ├── routes/         # API routes
│   ├── services/       # Business logic
│   ├── utils/          # Utility functions
│   └── app.js          # Express app setup
├── prisma/             # Prisma schema and migrations
├── docs/               # Documentation
├── tests/              # Test files
└── package.json        # Project dependencies
```

## API Documentation

Detailed API documentation can be found in the [docs/architecture.md](docs/architecture.md) file.

## Development

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

## Deployment

Instructions for deploying to Railway/Render:

1. Set up a new project on Railway/Render
2. Connect your GitHub repository
3. Configure environment variables
4. Deploy

## License

This project is proprietary and confidential.

## Contact

For any inquiries, please contact [your-email@example.com]. 