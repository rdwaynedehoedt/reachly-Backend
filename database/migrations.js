/**
 * Database Migrations for Reachly
 * This file contains migration functions for updating the database schema
 */

const { supabaseAdmin } = require('../config/supabase');

class DatabaseMigrations {
  constructor() {
    this.migrations = [
      {
        version: '001',
        name: 'initial_setup',
        description: 'Create initial tables and RLS policies',
        up: this.migration001Up.bind(this),
        down: this.migration001Down.bind(this)
      },
      {
        version: '002',
        name: 'add_audit_logs',
        description: 'Add audit logging for organization changes',
        up: this.migration002Up.bind(this),
        down: this.migration002Down.bind(this)
      }
      // Add more migrations here as needed
    ];
  }

  async runMigrations() {
    console.log('🔄 Running database migrations...');
    
    // Create migrations table if it doesn't exist
    await this.createMigrationsTable();
    
    // Get current migration version
    const currentVersion = await this.getCurrentVersion();
    console.log(`📍 Current database version: ${currentVersion || 'none'}`);
    
    // Run pending migrations
    for (const migration of this.migrations) {
      if (!currentVersion || migration.version > currentVersion) {
        console.log(`⬆️  Running migration ${migration.version}: ${migration.name}`);
        await migration.up();
        await this.recordMigration(migration);
        console.log(`✅ Migration ${migration.version} completed`);
      }
    }
    
    console.log('🎉 All migrations completed!');
  }

  async createMigrationsTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version VARCHAR(10) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    
    await this.execSQL(query);
  }

  async getCurrentVersion() {
    const { data, error } = await supabaseAdmin
      .from('schema_migrations')
      .select('version')
      .order('version', { ascending: false })
      .limit(1);
    
    if (error && error.code !== 'PGRST116') { // Table doesn't exist
      throw error;
    }
    
    return data?.[0]?.version || null;
  }

  async recordMigration(migration) {
    const { error } = await supabaseAdmin
      .from('schema_migrations')
      .insert({
        version: migration.version,
        name: migration.name,
        description: migration.description
      });
    
    if (error) throw error;
  }

  // Migration 001: Initial Setup
  async migration001Up() {
    const query = `
      -- Enable necessary extensions
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      
      -- RPC function to execute raw SQL (for migrations)
      CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
      RETURNS TEXT AS $$
      BEGIN
        EXECUTE sql_query;
        RETURN 'SQL executed successfully';
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;
    
    await this.execSQL(query);
  }

  async migration001Down() {
    const query = `
      DROP FUNCTION IF EXISTS exec_sql(TEXT);
    `;
    
    await this.execSQL(query);
  }

  // Migration 002: Add Audit Logs
  async migration002Up() {
    const query = `
      -- Audit logs table
      CREATE TABLE IF NOT EXISTS public.audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id UUID,
        old_values JSONB,
        new_values JSONB,
        metadata JSONB DEFAULT '{}',
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes for audit logs
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON public.audit_logs(organization_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);
      
      -- Enable RLS
      ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
      
      -- RLS policies for audit logs
      CREATE POLICY "Users can view audit logs for their organizations" ON public.audit_logs
        FOR SELECT USING (organization_id = ANY(auth.get_user_organization_ids()));
      
      CREATE POLICY "System can insert audit logs" ON public.audit_logs
        FOR INSERT WITH CHECK (true);
    `;
    
    await this.execSQL(query);
  }

  async migration002Down() {
    const query = `
      DROP TABLE IF EXISTS public.audit_logs CASCADE;
    `;
    
    await this.execSQL(query);
  }

  async execSQL(sql) {
    const { data, error } = await supabaseAdmin.rpc('exec_sql', { sql });
    if (error) throw error;
    return data;
  }

  // Rollback to specific version
  async rollbackTo(targetVersion) {
    console.log(`🔄 Rolling back to version ${targetVersion}...`);
    
    const currentVersion = await this.getCurrentVersion();
    if (!currentVersion) {
      console.log('📍 No migrations to rollback');
      return;
    }
    
    // Find migrations to rollback (in reverse order)
    const migrationsToRollback = this.migrations
      .filter(m => m.version > targetVersion)
      .reverse();
    
    for (const migration of migrationsToRollback) {
      console.log(`⬇️  Rolling back migration ${migration.version}: ${migration.name}`);
      await migration.down();
      await this.removeMigrationRecord(migration.version);
      console.log(`✅ Rollback ${migration.version} completed`);
    }
    
    console.log('🎉 Rollback completed!');
  }

  async removeMigrationRecord(version) {
    const { error } = await supabaseAdmin
      .from('schema_migrations')
      .delete()
      .eq('version', version);
    
    if (error) throw error;
  }
}

module.exports = DatabaseMigrations;

// CLI interface
if (require.main === module) {
  const migrations = new DatabaseMigrations();
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case 'up':
      migrations.runMigrations()
        .then(() => process.exit(0))
        .catch(error => {
          console.error('Migration failed:', error);
          process.exit(1);
        });
      break;
      
    case 'rollback':
      const targetVersion = arg || '000';
      migrations.rollbackTo(targetVersion)
        .then(() => process.exit(0))
        .catch(error => {
          console.error('Rollback failed:', error);
          process.exit(1);
        });
      break;
      
    default:
      console.log('Usage:');
      console.log('  node migrations.js up              - Run all pending migrations');
      console.log('  node migrations.js rollback [ver]  - Rollback to version (default: 000)');
      process.exit(1);
  }
}