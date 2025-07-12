# Reachly Backend Architecture

## Overview

Reachly is a B2B lead generation SaaS platform that fetches targeted leads from Clay & Lusha, displays them in a dashboard, tracks user quotas, and allows CSV exports. The backend will be built with Node.js and Express, using PostgreSQL as the database with Prisma ORM.

## Core Components

### 1. API Layer

- **Authentication Routes**: User registration, login, and session management
- **Lead Generation Routes**: Endpoints for filtering and generating leads
- **User Management Routes**: User profile, subscription, and quota management
- **Admin Routes**: Administrative functions and analytics

### 2. Service Layer

- **Auth Service**: Handles user authentication and authorization
- **Lead Service**: Interfaces with Clay & Lusha APIs to fetch and process leads
- **User Service**: Manages user profiles and subscriptions
- **Credit Service**: Tracks and manages user credit usage
- **Export Service**: Handles CSV generation and exports

### 3. Data Layer

- **PostgreSQL Database**: Primary data store
- **Prisma ORM**: Database access and schema management
- **Redis Cache**: (Optional) For performance optimization

## Database Schema

### Users Table
- id (UUID)
- email (String, unique)
- passwordHash (String)
- name (String)
- role (Enum: USER, ADMIN)
- createdAt (DateTime)
- updatedAt (DateTime)

### Subscriptions Table
- id (UUID)
- userId (UUID, FK to Users)
- plan (String)
- creditLimit (Integer)
- creditsUsed (Integer)
- startDate (DateTime)
- endDate (DateTime)
- status (Enum: ACTIVE, INACTIVE, TRIAL)
- createdAt (DateTime)
- updatedAt (DateTime)

### Leads Table
- id (UUID)
- userId (UUID, FK to Users)
- firstName (String)
- lastName (String)
- email (String)
- phone (String)
- company (String)
- title (String)
- linkedInUrl (String)
- industry (String)
- location (String)
- source (Enum: CLAY, LUSHA)
- createdAt (DateTime)
- updatedAt (DateTime)

### LeadFilters Table
- id (UUID)
- userId (UUID, FK to Users)
- name (String)
- industry (String[])
- jobTitles (String[])
- locations (String[])
- companySize (String[])
- createdAt (DateTime)
- updatedAt (DateTime)

## API Endpoints

### Authentication
- `POST /api/auth/register`: Register a new user
- `POST /api/auth/login`: User login
- `POST /api/auth/logout`: User logout
- `GET /api/auth/me`: Get current user info

### Leads
- `POST /api/leads/generate`: Generate leads based on filters
- `GET /api/leads`: Get user's leads with pagination
- `GET /api/leads/:id`: Get specific lead details
- `POST /api/leads/export`: Export leads to CSV

### User Management
- `GET /api/users/profile`: Get user profile
- `PUT /api/users/profile`: Update user profile
- `GET /api/users/credits`: Get user credit information

### Admin
- `GET /api/admin/users`: Get all users (admin only)
- `GET /api/admin/analytics`: Get platform analytics (admin only)
- `PUT /api/admin/users/:id`: Update user information (admin only)

## Third-Party Integrations

### Clay API
- Authentication
- Lead generation endpoints
- Rate limiting considerations

### Lusha API
- Authentication
- Lead generation endpoints
- Rate limiting considerations

## Security Considerations

- JWT-based authentication
- Input validation and sanitization
- Rate limiting
- CORS configuration
- Environment variable management
- Data encryption for sensitive information

## Scalability Considerations

- Horizontal scaling with load balancing
- Database indexing for performance
- Caching strategies
- Background job processing for lead generation

## Deployment Strategy

- CI/CD pipeline setup
- Environment configurations (dev, staging, production)
- Containerization with Docker
- Hosting on Railway/Render

## Monitoring and Logging

- Error tracking
- Performance monitoring
- User activity logging
- API usage metrics 