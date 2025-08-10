# Multi-Tenant Database Schema for Reachly

## Overview

This document outlines the database schema for Reachly's multi-tenant email marketing platform, optimized for the single-database, shared schema approach.

## Multi-Tenant Design Principles

1. **Organization ID as Tenant Identifier**
   - Every tenant-specific table includes an `organization_id` column
   - All queries filter by this column to ensure data isolation

2. **Indexing Strategy**
   - Primary index on `id` (UUID)
   - Secondary index on `organization_id` for all tenant tables
   - Composite indexes for common query patterns

3. **Row-Level Security**
   - PostgreSQL policies to enforce tenant isolation at the database level
   - Additional application-level checks

## Core Schema

### Authentication Schema

```sql
-- Authentication schema (managed by Supabase Auth)
CREATE SCHEMA IF NOT EXISTS auth;

-- Users table (managed by Supabase Auth)
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Public Schema (Application Data)

```sql
-- Public schema for application data
CREATE SCHEMA IF NOT EXISTS public;

-- Organizations (Tenants)
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE,
  logo_url TEXT,
  website VARCHAR(255),
  industry VARCHAR(100),
  size VARCHAR(50),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Organization Members
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- member, admin, owner
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, active, inactive
  invited_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- User Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  avatar_url TEXT,
  title VARCHAR(100),
  phone VARCHAR(50),
  timezone VARCHAR(50) DEFAULT 'UTC',
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contacts/Leads
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(50),
  company VARCHAR(100),
  job_title VARCHAR(100),
  status VARCHAR(50) DEFAULT 'active', -- active, unsubscribed, bounced
  source VARCHAR(50),
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(organization_id, email)
);

-- Contact Lists
CREATE TABLE IF NOT EXISTS public.contact_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_dynamic BOOLEAN DEFAULT FALSE,
  filter_criteria JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contact List Members
CREATE TABLE IF NOT EXISTS public.contact_list_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id UUID NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(list_id, contact_id)
);

-- Email Templates
CREATE TABLE IF NOT EXISTS public.email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  subject VARCHAR(255),
  html_content TEXT,
  text_content TEXT,
  variables JSONB DEFAULT '[]',
  category VARCHAR(50),
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_id UUID REFERENCES public.email_templates(id),
  subject VARCHAR(255),
  from_name VARCHAR(100),
  from_email VARCHAR(255),
  reply_to VARCHAR(255),
  status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, sending, sent, paused, cancelled
  scheduled_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign Lists (which lists are targeted by campaign)
CREATE TABLE IF NOT EXISTS public.campaign_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(campaign_id, list_id)
);

-- Campaign Messages (individual email sends)
CREATE TABLE IF NOT EXISTS public.campaign_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, opened, clicked, bounced, complained, unsubscribed
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(campaign_id, contact_id)
);

-- Email Events
CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.campaign_messages(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- sent, delivered, opened, clicked, bounced, complained, unsubscribed
  ip_address VARCHAR(50),
  user_agent TEXT,
  link_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Indexing Strategy

```sql
-- Organization Members
CREATE INDEX idx_org_members_org_id ON public.organization_members(organization_id);
CREATE INDEX idx_org_members_user_id ON public.organization_members(user_id);
CREATE INDEX idx_org_members_status ON public.organization_members(organization_id, status);

-- Contacts
CREATE INDEX idx_contacts_org_id ON public.contacts(organization_id);
CREATE INDEX idx_contacts_email ON public.contacts(organization_id, email);
CREATE INDEX idx_contacts_status ON public.contacts(organization_id, status);

-- Contact Lists
CREATE INDEX idx_contact_lists_org_id ON public.contact_lists(organization_id);

-- Contact List Members
CREATE INDEX idx_list_members_list_id ON public.contact_list_members(list_id);
CREATE INDEX idx_list_members_contact_id ON public.contact_list_members(contact_id);

-- Email Templates
CREATE INDEX idx_templates_org_id ON public.email_templates(organization_id);
CREATE INDEX idx_templates_archived ON public.email_templates(organization_id, is_archived);

-- Campaigns
CREATE INDEX idx_campaigns_org_id ON public.campaigns(organization_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(organization_id, status);
CREATE INDEX idx_campaigns_scheduled ON public.campaigns(organization_id, scheduled_at)
  WHERE status = 'scheduled';

-- Campaign Messages
CREATE INDEX idx_messages_campaign_id ON public.campaign_messages(campaign_id);
CREATE INDEX idx_messages_contact_id ON public.campaign_messages(contact_id);
CREATE INDEX idx_messages_status ON public.campaign_messages(campaign_id, status);

-- Email Events
CREATE INDEX idx_events_org_id ON public.email_events(organization_id);
CREATE INDEX idx_events_message_id ON public.email_events(message_id);
CREATE INDEX idx_events_type ON public.email_events(organization_id, event_type);
CREATE INDEX idx_events_created ON public.email_events(organization_id, created_at);
```

## Row-Level Security Policies

```sql
-- Enable row level security
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

-- Example policies (to be implemented with Supabase or custom logic)
CREATE POLICY org_isolation_policy ON public.contacts
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::uuid);

CREATE POLICY org_member_policy ON public.organization_members
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::uuid);
```

## Performance Optimization

1. **Partitioning Strategy**
   - Consider partitioning large tables like `campaign_messages` and `email_events` by organization_id or date

2. **JSONB for Flexibility**
   - Use JSONB for custom fields and preferences
   - Create GIN indexes for JSONB fields that need to be queried

3. **Connection Pooling**
   - Configure appropriate connection pool size
   - Use PgBouncer for connection pooling

4. **Query Optimization**
   - Always include organization_id in WHERE clauses
   - Use prepared statements
   - Implement query caching where appropriate

## Cost Optimization

1. **Appropriate Instance Size**
   - B1ms is sufficient for MVP with low traffic
   - Monitor CPU and memory usage
   - Scale up only when necessary

2. **Storage Management**
   - Use TEXT for large content fields
   - Consider compression for large text fields
   - Implement data retention policies for events

3. **Connection Efficiency**
   - Reuse connections with pooling
   - Close connections when not in use
   - Monitor connection count

4. **Query Efficiency**
   - Optimize queries to reduce compute costs
   - Use EXPLAIN ANALYZE to identify inefficient queries
   - Implement appropriate indexes

## Migration Strategy

1. **Initial Setup**
   - Create base schema with core tables
   - Implement RLS policies
   - Set up indexes

2. **Incremental Updates**
   - Use migrations for schema changes
   - Version control all migrations
   - Test migrations on staging before production

3. **Data Growth Management**
   - Monitor table sizes
   - Implement archiving strategy for old data
   - Consider table partitioning for very large tables