import { createClient } from '@supabase/supabase-js'

// Supabase client - works directly in browser, no server needed!
const supabaseUrl = 'https://fjimaldasqsugzaimgqs.supabase.co'
const supabaseKey = 'sb_secret_LhauJjtLw5sf8rrzuc9sqA_S9ZP9U5l'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

export default supabase
