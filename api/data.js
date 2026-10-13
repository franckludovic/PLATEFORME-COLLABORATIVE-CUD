// api/data.js
// Lecture, écriture et suppression des tables Supabase utilisées par l'interface.
// Équivalent serverless de handleDataRequest() dans server.js (à garder synchronisé).
//
//   GET    /api/data?table=<nom>                 authentification requise (sauf « directions » en lecture)
//   POST   /api/data?table=<nom>   { records }   écriture (upsert) en tant qu'utilisateur connecté
//   DELETE /api/data?table=<nom>&id=<id>         suppression : administrateurs seulement

const { createClient } = require('@supabase/supabase-js');
const { json, readJsonBody } = require('./_shared');

const TABLE_ALIASES = {
  directions: 'directions',
  users: 'users',
  employes: 'users',
  employees: 'users',
  topics: 'topics',
  conversations: 'conversations',
  messages: 'messages',
  chat_history: 'chat_history',
  chatHistory: 'chat_history',
  files: 'files',
  meetings: 'meetings',
  notifications: 'notifications',
  activities: 'activities'
};

function resolveTableName(rawName) {
  return TABLE_ALIASES[String(rawName || '').trim()] || null;
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function clientFor(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function authenticate(req) {
  if (!isConfigured()) return { error: 'Supabase non configuré.' };
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: 'Authentification requise.' };

  const { data: { user }, error } = await clientFor().auth.getUser(token);
  if (error || !user) return { error: 'Session invalide ou expirée.' };
  return { client: clientFor(token), user };
}

async function isAdmin(client, user) {
  const { data: profiles, error } = await client
    .from('users')
    .select('id, email, "isAdmin"')
    .eq('email', user.email)
    .limit(1);
  if (error) return { error: error.message };
  return { admin: profiles?.[0]?.isAdmin === true };
}

async function readTable(client, tableName) {
  const resolved = resolveTableName(tableName);
  if (!resolved) return { ok: false, message: 'Table inconnue.' };
  const { data, error } = await client.from(resolved).select('*');
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data || [] };
}

async function writeTable(client, user, tableName, records) {
  const resolved = resolveTableName(tableName);
  if (!resolved) return { ok: false, message: 'Table inconnue.' };

  const payload = (Array.isArray(records) ? records : [records]).map(record => ({ ...record }));

  if (resolved === 'users') {
    const check = await isAdmin(client, user);
    if (check.error) return { ok: false, message: check.error };
    for (const record of payload) {
      const isOwnProfile = String(record.email || '').toLowerCase() === String(user.email || '').toLowerCase();
      if (!isOwnProfile && !check.admin) {
        return { ok: false, message: 'Vous ne pouvez modifier que votre propre profil.' };
      }
      if (!check.admin) delete record.isAdmin;
    }
  }

  const { data, error } = await client.from(resolved).upsert(payload, { onConflict: 'id' }).select();
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data || [] };
}

async function removeRecord(client, user, tableName, id) {
  const resolved = resolveTableName(tableName);
  if (!resolved || !id) return { ok: false, message: 'Table ou identifiant invalide.' };

  const check = await isAdmin(client, user);
  if (check.error) return { ok: false, message: check.error };
  if (!check.admin) return { ok: false, message: 'Droits administrateur requis.' };

  const { data, error } = await client.from(resolved).delete().eq('id', id).select();
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data || [] };
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const tableName = url.searchParams.get('table') || url.searchParams.get('collection') || url.searchParams.get('entity');

  const auth = await authenticate(req);
  if (!auth.client) {
    // Les directions sont publiques en lecture (écran de connexion).
    if (req.method === 'GET' && tableName === 'directions' && !req.headers.authorization && isConfigured()) {
      const result = await readTable(clientFor(), tableName);
      return json(res, result.ok ? 200 : 503, { ok: result.ok, data: result.data || [], message: result.message || 'OK' });
    }
    return json(res, 401, { ok: false, data: [], message: auth.error });
  }

  if (req.method === 'GET') {
    const result = await readTable(auth.client, tableName);
    return json(res, result.ok ? 200 : 503, { ok: result.ok, data: result.data || [], message: result.message || 'OK' });
  }

  if (req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const targetTable = payload.table || payload.collection || payload.entity || tableName;
      const records = payload.records ?? payload.data ?? payload.record ?? payload;
      const result = await writeTable(auth.client, auth.user, targetTable, records);
      if (!result.ok) return json(res, 400, { ok: false, message: result.message || 'Impossible d’enregistrer les données.' });
      return json(res, 200, { ok: true, data: result.data || [], message: 'Données enregistrées.' });
    } catch (error) {
      return json(res, 400, { ok: false, message: 'Payload invalide.' });
    }
  }

  if (req.method === 'DELETE') {
    const result = await removeRecord(auth.client, auth.user, tableName, url.searchParams.get('id'));
    if (!result.ok) return json(res, 400, { ok: false, message: result.message });
    return json(res, 200, { ok: true, data: result.data });
  }

  return json(res, 405, { ok: false, message: 'Méthode non autorisée.' });
};
