export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://not-configured.invalid';
export const supabasePublicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
  || (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'anon-key-not-configured';
