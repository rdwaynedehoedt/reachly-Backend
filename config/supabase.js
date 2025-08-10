const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create Supabase client with anon key (for client-side operations)
const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Create Supabase admin client with service role key (for server-side operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = {
  supabaseClient,
  supabaseAdmin
};