// Vérifie la session Supabase envoyée dans l'en-tête Authorization.
// Préfixe "_" : Vercel ne l'expose pas comme route.

const { createClient } = require('@supabase/supabase-js');

async function getUserFromRequest(req) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !anonKey || !token) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error || !user ? null : user;
}

module.exports = { getUserFromRequest };
