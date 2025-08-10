const { supabase } = require('../config/database');

/**
 * Get user profile
 */
exports.getProfile = async (req, res) => {
  try {
    // User is already authenticated via middleware
    const userId = req.user.id;

    // Get user profile from Supabase
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: data
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while getting the profile'
    });
  }
};

/**
 * Update user profile
 */
exports.updateProfile = async (req, res) => {
  try {
    // User is already authenticated via middleware
    const userId = req.user.id;
    const { name, avatar_url, bio } = req.body;

    // Update profile in Supabase
    const { data, error } = await supabase
      .from('profiles')
      .update({
        name,
        avatar_url,
        bio,
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: data
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the profile'
    });
  }
};