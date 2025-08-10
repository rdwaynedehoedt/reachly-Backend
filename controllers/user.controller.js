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
 * Complete onboarding
 */
exports.completeOnboarding = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.userId;
    const {
      role,
      experienceLevel,
      goals,
      company,
      jobTitle
    } = req.body;

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
      company,
      jobTitle,
      userId
    ]);

    return res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully'
    });

  } catch (error) {
    console.error('Complete onboarding error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while completing onboarding'
    });
  } finally {
    client.release();
  }
};