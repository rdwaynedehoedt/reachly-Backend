const { Pool } = require('pg');
require('dotenv').config();

// Database connection from environment variables
const pool = new Pool({
  host: process.env.AZURE_PG_HOST,
  port: process.env.AZURE_PG_PORT || 5432,
  database: process.env.AZURE_PG_DATABASE,
  user: process.env.AZURE_PG_USER,
  password: process.env.AZURE_PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

/**
 * Update user profile
 */
exports.updateProfile = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.userId;
    const {
      jobTitle,
      company,
      phone,
      bio,
      timezone,
      role,
      experienceLevel,
      goals,
      onboardingCompleted
    } = req.body;

    // Update user profile
    const result = await client.query(`
      UPDATE user_profiles 
      SET 
        job_title = COALESCE($1, job_title),
        company = COALESCE($2, company),
        phone = COALESCE($3, phone),
        bio = COALESCE($4, bio),
        timezone = COALESCE($5, timezone),
        role = COALESCE($6, role),
        experience_level = COALESCE($7, experience_level),
        goals = COALESCE($8, goals),
        onboarding_completed = COALESCE($9, onboarding_completed),
        updated_at = NOW()
      WHERE user_id = $10
      RETURNING *
    `, [
      jobTitle,
      company,
      phone,
      bio,
      timezone,
      role,
      experienceLevel,
      goals,
      onboardingCompleted,
      userId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: result.rows[0]
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating profile'
    });
  } finally {
    client.release();
  }
};

/**
 * Complete onboarding with organization and team setup
 */
exports.completeOnboarding = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const userId = req.user.userId;
    const {
      role,
      experienceLevel,
      goals,
      organization,
      teamMembers,
      jobTitle
    } = req.body;

    console.log('Onboarding data received:', { 
      userId, 
      role, 
      experienceLevel, 
      goals, 
      organization, 
      teamMembers 
    });

    let organizationId = null;

    // Handle organization creation or joining
    if (organization) {
      if (organization.mode === 'create' && organization.name) {
        // Create new organization
        const orgResult = await client.query(`
          INSERT INTO organizations (name, industry, size, created_by)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [
          organization.name,
          organization.industry || null,
          organization.size || null,
          userId
        ]);
        
        organizationId = orgResult.rows[0].id;

        // Add user as owner of the organization
        await client.query(`
          INSERT INTO organization_members (organization_id, user_id, role, status, joined_at)
          VALUES ($1, $2, 'owner', 'active', NOW())
        `, [organizationId, userId]);

      } else if (organization.mode === 'join' && organization.existingOrgId) {
        // Join existing organization
        organizationId = organization.existingOrgId;
        
        // Add user as member (pending approval)
        await client.query(`
          INSERT INTO organization_members (organization_id, user_id, role, status)
          VALUES ($1, $2, 'member', 'pending')
        `, [organizationId, userId]);
      }
    }

    // Update user profile with onboarding data
    await client.query(`
      UPDATE user_profiles 
      SET 
        role = $1,
        experience_level = $2,
        goals = $3,
        company = $4,
        job_title = $5,
        onboarding_completed = true,
        updated_at = NOW()
      WHERE user_id = $6
    `, [
      role,
      experienceLevel,
      goals,
      organization?.name || null,
      jobTitle || role,
      userId
    ]);

    // Handle team member invitations
    if (teamMembers && teamMembers.length > 0 && organizationId) {
      for (const member of teamMembers) {
        if (member.email && member.role) {
          // Check if user already exists
          const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [member.email]
          );

          if (existingUser.rows.length > 0) {
            // User exists, add them to organization
            const existingUserId = existingUser.rows[0].id;
            await client.query(`
              INSERT INTO organization_members (organization_id, user_id, role, status, invited_by)
              VALUES ($1, $2, $3, 'pending', $4)
              ON CONFLICT (organization_id, user_id) DO NOTHING
            `, [organizationId, existingUserId, member.role, userId]);
          }
          // Note: For non-existing users, you might want to implement email invitations
          // This would involve creating invitation tokens and sending emails
        }
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      data: {
        organizationId,
        teamInvitationsSent: teamMembers?.length || 0
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Complete onboarding error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while completing onboarding'
    });
  } finally {
    client.release();
  }
};