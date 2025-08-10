# Reachly Platform Architecture

## Overview

Reachly is a multi-tenant email marketing platform that allows organizations to create campaigns, manage leads, and send targeted emails. This document outlines the architecture, data model, and key workflows.

## Multi-Tenant Architecture

### Single-Database Multi-Tenancy Model

For Reachly's MVP, we're implementing a **single-database, shared schema** multi-tenant model. This approach offers:

- **Cost efficiency**: One database serves all tenants, reducing hosting costs
- **Simplified maintenance**: Single codebase and database to maintain
- **Easier updates**: Changes apply to all tenants simultaneously
- **Resource sharing**: Efficient use of database connections and server resources

### Tenant Isolation

Data isolation is achieved through:
1. **Organization ID column**: Every tenant-specific table includes an `organization_id` column
2. **Row-level security**: Database policies ensure tenants can only access their own data
3. **Application-level filtering**: All queries include organization filters

## Data Model

### Core Entities

1. **Users**
   - Authentication credentials
   - Personal information
   - System-wide roles

2. **Organizations**
   - Tenant boundaries
   - Billing entity
   - Organization-wide settings

3. **Organization Members**
   - Links users to organizations
   - Organization-specific roles
   - Invitation/approval status

4. **Contacts/Leads**
   - Email recipients
   - Contact information
   - Segmentation attributes

5. **Campaigns**
   - Email campaign configuration
   - Scheduling information
   - Performance metrics

6. **Email Templates**
   - Reusable email designs
   - Personalization variables
   - HTML/plain text content

7. **Campaign Analytics**
   - Open rates
   - Click-through rates
   - Conversion tracking

## Key User Flows

### User Onboarding

1. **Sign Up**
   - User creates account with email/password
   - Basic profile information collected

2. **Organization Creation/Selection**
   - New user creates an organization OR
   - Selects existing organization to join

3. **Organization Admin Approval** (for joining existing orgs)
   - Admin receives notification
   - Admin approves/rejects request
   - User gains access upon approval

### Campaign Creation

1. **Setup Campaign**
   - Name, description, objectives
   - Target audience selection

2. **Create/Select Email Template**
   - Design email or choose template
   - Add personalization variables

3. **Schedule and Launch**
   - Set timing parameters
   - Review and launch campaign

4. **Monitor Results**
   - Track opens, clicks, conversions
   - View analytics dashboard

## Database Indexing Strategy

For optimal performance with minimal cost:

1. **Primary Keys**: UUID for all tables
   - Avoids sequential ID security issues
   - Better for distributed systems

2. **Foreign Keys**: Indexed for all relationships
   - `organization_id`
   - `user_id`
   - `campaign_id`
   - etc.

3. **Composite Indexes**: For common query patterns
   - `(organization_id, created_at)` for time-based queries
   - `(organization_id, email)` for contact lookups
   - `(organization_id, status)` for filtering by status

4. **Partial Indexes**: For frequently filtered subsets
   - Active campaigns
   - Pending invitations
   - Recent activities

## Performance Considerations

1. **Query Optimization**
   - Always filter by `organization_id` first
   - Use prepared statements
   - Limit result sets

2. **Connection Pooling**
   - Reuse database connections
   - Set appropriate pool sizes

3. **Caching Strategy**
   - Cache frequently accessed data
   - Use Redis for shared cache

4. **Batch Processing**
   - Process email sends in batches
   - Background job processing for analytics

## Cost Optimization

1. **Database Sizing**
   - Start with smaller instance (B1ms is good for MVP)
   - Monitor usage and scale as needed

2. **Connection Efficiency**
   - Use connection pooling
   - Close unused connections

3. **Query Efficiency**
   - Optimize queries to reduce compute
   - Use appropriate indexes

4. **Storage Management**
   - Compress large text fields
   - Consider external storage for large assets

## Security Considerations

1. **Data Isolation**
   - Row-level security policies
   - Application-level filtering

2. **Authentication**
   - JWT-based auth with short expiry
   - Refresh token rotation

3. **Authorization**
   - Role-based access control
   - Permission checks at API level

4. **Data Protection**
   - Encrypt sensitive data
   - Audit logging for sensitive operations

## Next Steps for MVP

1. Implement user authentication with organization context
2. Create organization management endpoints
3. Develop contact/lead management system
4. Build email template designer
5. Implement campaign creation and scheduling
6. Develop basic analytics tracking