const { json } = require('./_shared');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed.' });
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return json(res, 503, { error: 'Supabase Auth is not configured.' });
  }

  return json(res, 200, { url, anonKey });
};
