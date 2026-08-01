// Fill these in from your Supabase project:
//   Supabase dashboard -> Project Settings -> API
//
// The anon key is safe to keep here: Row Level Security (see schema.sql) means
// it can only ever read or write rows belonging to the signed-in user.

export const SUPABASE_URL = "https://yrgvnucqjreyhbpggamb.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZ3ZudWNxanJleWhicGdnYW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NDMwNzAsImV4cCI6MjEwMTExOTA3MH0.nJBhg22uVcJ6JRypH46B3GqXKAqc20UvJD_vhFraLcU";

// Sanity check that the two values above were actually filled in.
// Checks their shape, not their contents — so editing them can't break this.
export const isConfigured = () =>
  /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(SUPABASE_URL.trim()) &&
  SUPABASE_ANON_KEY.trim().startsWith("eyJ");