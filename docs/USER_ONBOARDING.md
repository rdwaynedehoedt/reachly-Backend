# User Onboarding & Organization Management

## Overview

This document details the user onboarding process for Reachly, focusing on user registration, organization creation/joining, and role management.

## User Registration Flow

### 1. Initial Sign Up

When a user first signs up:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐
│  User fills │     │  Validate   │     │ Create user account │
│  sign-up    ├────►│  email &    ├────►│ in authentication   │
│  form       │     │  password   │     │ system              │
└─────────────┘     └─────────────┘     └─────────────────────┘
                                                  │
                                                  ▼
┌─────────────────────┐     ┌─────────────────────┐
│ Redirect to         │     │ Create user record  │
│ organization        │◄────┤ in database with    │
│ selection screen    │     │ basic profile info  │
└─────────────────────┘     └─────────────────────┘
```

### 2. Organization Selection

After registration, users must either create a new organization or join an existing one:

```
┌─────────────────┐
│ Organization    │
│ Selection Screen│
└────────┬────────┘
         │
         ▼
┌─────────────────────┐     ┌─────────────────────┐
│                     │ Yes │ Create new          │
│ Create new org?     ├────►│ organization record │
│                     │     │ & set user as admin │
└──────────┬──────────┘     └─────────────────────┘
           │ No                       │
           ▼                          │
┌─────────────────────┐               │
│ Search & select     │               │
│ existing            │               │
│ organization        │               │
└──────────┬──────────┘               │
           │                          │
           ▼                          ▼
┌─────────────────────┐     ┌─────────────────────┐
│ Create pending      │     │ Redirect to         │
│ membership request  │     │ dashboard           │
└──────────┬──────────┘     └─────────────────────┘
           │
           ▼
┌─────────────────────┐
│ Show "Pending       │
│ Approval" screen    │
└─────────────────────┘
```

### 3. Admin Approval Process

For users joining existing organizations:

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ Admin receives  │     │ Admin reviews       │     │ System updates      │
│ notification of │     │ request and         │     │ membership status   │
│ join request    ├────►│ approves/rejects    ├────►│ in database         │
└─────────────────┘     └─────────────────────┘     └─────────────────────┘
                                                               │
                                                               ▼
┌─────────────────────┐     ┌─────────────────────┐
│ User receives       │     │ If approved, user   │
│ email notification  │◄────┤ gains access to     │
│ of decision         │     │ organization        │
└─────────────────────┘     └─────────────────────┘
```

## Database Schema for User & Organization Management

### Users Table

```sql
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_confirmed BOOLEAN DEFAULT FALSE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Organizations Table

```sql
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE,
  logo_url TEXT,
  website VARCHAR(255),
  industry VARCHAR(100),
  size VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Organization Members Table

```sql
CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- member, admin, owner
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, active, inactive
  invited_by UUID REFERENCES auth.users(id),
  invitation_token VARCHAR(255),
  invitation_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);
```

## Role-Based Access Control

### User Roles

1. **System Roles**
   - **Super Admin**: Can manage all system settings
   - **Support**: Can access support-related functions

2. **Organization Roles**
   - **Owner**: Full control of organization
   - **Admin**: Can manage users and most settings
   - **Member**: Standard user with limited permissions

### Permission Matrix

| Action                      | Owner | Admin | Member |
|----------------------------|:-----:|:-----:|:------:|
| View organization dashboard | ✅    | ✅    | ✅     |
| Create campaigns           | ✅    | ✅    | ✅     |
| Manage contacts            | ✅    | ✅    | ✅     |
| View analytics             | ✅    | ✅    | ✅     |
| Invite new members         | ✅    | ✅    | ❌     |
| Approve member requests    | ✅    | ✅    | ❌     |
| Manage organization settings| ✅    | ✅    | ❌     |
| Manage billing             | ✅    | ❌    | ❌     |
| Delete organization        | ✅    | ❌    | ❌     |

## Implementation Notes

### 1. User Creation

- Create user in authentication system (Supabase Auth)
- Create user profile in database
- Handle email verification

### 2. Organization Creation

- Validate organization name
- Generate unique slug
- Create organization record
- Create owner membership record

### 3. Organization Joining

- Search functionality by name
- Create pending membership record
- Notification system for admins
- Approval/rejection workflow

### 4. Session Management

- Store current organization context in user session
- Allow switching between organizations for users with multiple memberships

### 5. Security Considerations

- Validate organization access on every request
- Apply role-based permission checks
- Audit logging for sensitive actions