/**
 * Database Setup Script for Reachly Multi-Tenant Architecture
 * This script creates all necessary tables and RLS policies for a secure multi-tenant system
 * 
 * Architecture: Single Database + Row Level Security (RLS)
 * - Organizations have multiple users
 * - Data is isolated by organization_id
 * - Secure with Supabase RLS policies
 */

const { supabaseAdmin } = require('../config/supabase');

async function setupDatabase() {
  console.log('🚀 Starting Reachly database setup...');

  try {
    // 1. Create Organizations table
    await createOrganizationsTable();
    
    // 2. Create User Profiles table (extends Supabase auth.users)
    await createUserProfilesTable();
    
    // 3. Create Organization Members junction table
    await createOrganizationMembersTable();
    
    // 4. Create helper functions for RLS
    await createRLSHelperFunctions();
    
    // 5. Set up RLS policies
    await setupRLSPolicies();
    
    // 6. Create sample data (optional)
    await createSampleData();

    console.log('✅ Database setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    throw error;
  }
}

async function createOrganizationsTable() {
  console.log('📋 Creating organizations table...');
  
  const query = `
    -- Organizations table
    CREATE TABLE IF NOT EXISTS public.organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      website_url VARCHAR(500),
      logo_url VARCHAR(500),
      settings JSONB DEFAULT '{}',
      subscription_tier VARCHAR(50) DEFAULT 'free',
      max_users INTEGER DEFAULT 5,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations(slug);
    CREATE INDEX IF NOT EXISTS idx_organizations_active ON public.organizations(is_active);
    
    -- Enable RLS
    ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
    
    -- Create updated_at trigger
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    CREATE TRIGGER update_organizations_updated_at 
      BEFORE UPDATE ON public.organizations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql: query });
  if (error) throw error;
  console.log('✅ Organizations table created');
}

async function createUserProfilesTable() {
  console.log('👤 Creating user profiles table...');
  
  const query = `
    -- User profiles table (extends Supabase auth.users)
    CREATE TABLE IF NOT EXISTS public.user_profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      display_name VARCHAR(200),
      avatar_url VARCHAR(500),
      phone VARCHAR(20),
      timezone VARCHAR(50) DEFAULT 'UTC',
      preferences JSONB DEFAULT '{}',
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name ON public.user_profiles(display_name);
    
    -- Enable RLS
    ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
    
    -- Create updated_at trigger
    CREATE TRIGGER update_user_profiles_updated_at 
      BEFORE UPDATE ON public.user_profiles
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql: query });
  if (error) throw error;
  console.log('✅ User profiles table created');
}

async function createOrganizationMembersTable() {
  console.log('🏢 Creating organization members table...');
  
  const query = `
    -- Organization members junction table
    CREATE TABLE IF NOT EXISTS public.organization_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      permissions JSONB DEFAULT '[]',
      invited_by UUID REFERENCES auth.users(id),
      invited_at TIMESTAMPTZ DEFAULT NOW(),
      joined_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      
      -- Ensure user can only be in organization once
      UNIQUE(organization_id, user_id)
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.organization_members(organization_id);
    CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.organization_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_org_members_role ON public.organization_members(role);
    CREATE INDEX IF NOT EXISTS idx_org_members_active ON public.organization_members(is_active);
    
    -- Enable RLS
    ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
    
    -- Create updated_at trigger
    CREATE TRIGGER update_organization_members_updated_at 
      BEFORE UPDATE ON public.organization_members
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql: query });
  if (error) throw error;
  console.log('✅ Organization members table created');
}

async function createRLSHelperFunctions() {
  console.log('🔧 Creating RLS helper functions...');
  
  const query = `
    -- Helper function to get current user's organization IDs
    CREATE OR REPLACE FUNCTION auth.get_user_organization_ids()
    RETURNS UUID[] AS $$
    BEGIN
      RETURN (
        SELECT ARRAY_AGG(organization_id)
        FROM public.organization_members
        WHERE user_id = auth.uid() AND is_active = true
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    -- Helper function to check if user is member of organization
    CREATE OR REPLACE FUNCTION auth.is_organization_member(org_id UUID)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1
        FROM public.organization_members
        WHERE organization_id = org_id 
          AND user_id = auth.uid() 
          AND is_active = true
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    -- Helper function to check if user has specific role in organization
    CREATE OR REPLACE FUNCTION auth.has_organization_role(org_id UUID, required_role TEXT)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1
        FROM public.organization_members
        WHERE organization_id = org_id 
          AND user_id = auth.uid() 
          AND role = required_role
          AND is_active = true
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
    
    -- Function to get current user's organization from JWT or context
    CREATE OR REPLACE FUNCTION auth.current_organization_id()
    RETURNS UUID AS $$
    DECLARE
      org_id UUID;
    BEGIN
      -- Try to get from custom header first (for multi-tenant sessions)
      SELECT (
        current_setting('request.headers', true)::jsonb->>'x-organization-id'
      )::uuid INTO org_id;
      
      -- If no header, get from app_metadata
      IF org_id IS NULL THEN
        SELECT (
          current_setting('request.jwt.claims', true)::jsonb
          ->'app_metadata'->>'current_organization_id'
        )::uuid INTO org_id;
      END IF;
      
      -- Validate user has access to this organization
      IF org_id IS NOT NULL AND auth.is_organization_member(org_id) THEN
        RETURN org_id;
      END IF;
      
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql: query });
  if (error) throw error;
  console.log('✅ RLS helper functions created');
}

async function setupRLSPolicies() {
  console.log('🔒 Setting up RLS policies...');
  
  const query = `
    -- Organizations policies
    CREATE POLICY "Users can view their organizations" ON public.organizations
      FOR SELECT USING (id = ANY(auth.get_user_organization_ids()));
    
    CREATE POLICY "Admins can update their organizations" ON public.organizations
      FOR UPDATE USING (auth.has_organization_role(id, 'admin'));
    
    -- User profiles policies
    CREATE POLICY "Users can view all user profiles" ON public.user_profiles
      FOR SELECT USING (auth.uid() IS NOT NULL);
    
    CREATE POLICY "Users can update their own profile" ON public.user_profiles
      FOR UPDATE USING (auth.uid() = id);
    
    CREATE POLICY "Users can insert their own profile" ON public.user_profiles
      FOR INSERT WITH CHECK (auth.uid() = id);
    
    -- Organization members policies
    CREATE POLICY "Users can view members of their organizations" ON public.organization_members
      FOR SELECT USING (organization_id = ANY(auth.get_user_organization_ids()));
    
    CREATE POLICY "Admins can manage organization members" ON public.organization_members
      FOR ALL USING (auth.has_organization_role(organization_id, 'admin'));
    
    CREATE POLICY "Users can view their own memberships" ON public.organization_members
      FOR SELECT USING (user_id = auth.uid());
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql: query });
  if (error) throw error;
  console.log('✅ RLS policies created');
}

async function createSampleData() {
  console.log('📊 Creating sample data...');
  
  // Note: In a real setup, you might want to skip this or make it optional
  const query = `
    -- Insert sample organization (only if none exist)
    INSERT INTO public.organizations (name, slug, description)
    SELECT 'Sample Organization', 'sample-org', 'A sample organization for testing'
    WHERE NOT EXISTS (SELECT 1 FROM public.organizations LIMIT 1);
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql: query });
  if (error) throw error;
  console.log('✅ Sample data created');
}

// Execute SQL function for Supabase
async function execSQL(sql) {
  const { data, error } = await supabaseAdmin.rpc('exec_sql', { sql });
  if (error) throw error;
  return data;
}

// Export for use in other files
module.exports = {
  setupDatabase,
  execSQL
};

// Run setup if called directly
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log('🎉 Database setup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Setup failed:', error);
      process.exit(1);
    });
}