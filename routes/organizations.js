const express = require('express');
const { supabaseClient, supabaseAdmin } = require('../config/supabase');
const router = express.Router();

// Middleware to verify authentication
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseClient.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Create new organization
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, slug, description, website_url } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!name || !slug) {
      return res.status(400).json({
        error: 'Organization name and slug are required'
      });
    }

    // Check if slug is available
    const { data: existingOrg } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existingOrg) {
      return res.status(400).json({
        error: 'Organization slug already taken'
      });
    }

    // Create organization
    const { data: organization, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name,
        slug,
        description,
        website_url
      })
      .select()
      .single();

    if (orgError) {
      return res.status(400).json({ error: orgError.message });
    }

    // Add creator as admin member
    const { error: memberError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: organization.id,
        user_id: userId,
        role: 'admin',
        joined_at: new Date().toISOString()
      });

    if (memberError) {
      // Rollback organization creation
      await supabaseAdmin
        .from('organizations')
        .delete()
        .eq('id', organization.id);
      
      return res.status(400).json({ error: memberError.message });
    }

    // Create user profile if it doesn't exist
    await createUserProfileIfNeeded(userId, req.user);

    res.status(201).json({
      message: 'Organization created successfully',
      organization
    });

  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// Get user's organizations
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: organizations, error } = await supabaseAdmin
      .from('organization_members')
      .select(`
        role,
        joined_at,
        is_active,
        organizations:organization_id (
          id,
          name,
          slug,
          description,
          website_url,
          logo_url,
          subscription_tier,
          is_active,
          created_at
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const formattedOrgs = organizations.map(member => ({
      ...member.organizations,
      user_role: member.role,
      joined_at: member.joined_at
    }));

    res.json({ organizations: formattedOrgs });

  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Get organization by slug
router.get('/:slug', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;

    // Get organization with user's membership info
    const { data: orgData, error } = await supabaseAdmin
      .from('organizations')
      .select(`
        *,
        organization_members!inner (
          role,
          joined_at,
          is_active
        )
      `)
      .eq('slug', slug)
      .eq('organization_members.user_id', userId)
      .eq('organization_members.is_active', true)
      .single();

    if (error || !orgData) {
      return res.status(404).json({ error: 'Organization not found or access denied' });
    }

    // Get organization members count
    const { count: memberCount } = await supabaseAdmin
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgData.id)
      .eq('is_active', true);

    const organization = {
      ...orgData,
      user_role: orgData.organization_members[0].role,
      member_count: memberCount
    };

    delete organization.organization_members;

    res.json({ organization });

  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// Update organization
router.patch('/:slug', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    // Check if user is admin of this organization
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('role, organization_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Update organization
    const { data: organization, error } = await supabaseAdmin
      .from('organizations')
      .update(updates)
      .eq('slug', slug)
      .eq('id', membership.organization_id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      message: 'Organization updated successfully',
      organization
    });

  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// Get organization members
router.get('/:slug/members', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;

    // Verify user has access to this organization
    const { data: userMembership } = await supabaseAdmin
      .from('organizations')
      .select(`
        id,
        organization_members!inner (user_id)
      `)
      .eq('slug', slug)
      .eq('organization_members.user_id', userId)
      .eq('organization_members.is_active', true)
      .single();

    if (!userMembership) {
      return res.status(404).json({ error: 'Organization not found or access denied' });
    }

    // Get all members
    const { data: members, error } = await supabaseAdmin
      .from('organization_members')
      .select(`
        role,
        joined_at,
        invited_at,
        is_active,
        user_profiles:user_id (
          id,
          first_name,
          last_name,
          display_name,
          avatar_url
        )
      `)
      .eq('organization_id', userMembership.id)
      .eq('is_active', true)
      .order('joined_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ members });

  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ error: 'Failed to fetch organization members' });
  }
});

// Invite user to organization
router.post('/:slug/invite', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const { email, role = 'member' } = req.body;
    const userId = req.user.id;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user is admin
    const { data: adminCheck } = await supabaseAdmin
      .from('organizations')
      .select(`
        id,
        name,
        organization_members!inner (role)
      `)
      .eq('slug', slug)
      .eq('organization_members.user_id', userId)
      .eq('organization_members.role', 'admin')
      .eq('organization_members.is_active', true)
      .single();

    if (!adminCheck) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check if user exists in auth.users
    const { data: existingUser } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    
    if (!existingUser.user) {
      return res.status(400).json({ 
        error: 'User with this email does not exist. They need to sign up first.' 
      });
    }

    // Check if user is already a member
    const { data: existingMember } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', adminCheck.id)
      .eq('user_id', existingUser.user.id)
      .single();

    if (existingMember) {
      return res.status(400).json({ error: 'User is already a member of this organization' });
    }

    // Add user to organization
    const { data: newMember, error } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: adminCheck.id,
        user_id: existingUser.user.id,
        role,
        invited_by: userId,
        joined_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Create user profile if needed
    await createUserProfileIfNeeded(existingUser.user.id, existingUser.user);

    res.status(201).json({
      message: 'User added to organization successfully',
      member: newMember
    });

  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// Remove user from organization
router.delete('/:slug/members/:memberId', requireAuth, async (req, res) => {
  try {
    const { slug, memberId } = req.params;
    const userId = req.user.id;

    // Check if user is admin
    const { data: adminCheck } = await supabaseAdmin
      .from('organizations')
      .select(`
        id,
        organization_members!inner (role)
      `)
      .eq('slug', slug)
      .eq('organization_members.user_id', userId)
      .eq('organization_members.role', 'admin')
      .eq('organization_members.is_active', true)
      .single();

    if (!adminCheck) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Remove member
    const { error } = await supabaseAdmin
      .from('organization_members')
      .update({ is_active: false })
      .eq('organization_id', adminCheck.id)
      .eq('user_id', memberId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Member removed successfully' });

  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Helper function to create user profile if needed
async function createUserProfileIfNeeded(userId, userAuth) {
  try {
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (!existingProfile) {
      const { error } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: userId,
          first_name: userAuth.user_metadata?.first_name || '',
          last_name: userAuth.user_metadata?.last_name || '',
          display_name: userAuth.user_metadata?.display_name || userAuth.email?.split('@')[0] || 'User'
        });

      if (error) {
        console.error('Failed to create user profile:', error);
      }
    }
  } catch (error) {
    console.error('Error checking/creating user profile:', error);
  }
}

module.exports = router;