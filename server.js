require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabase, supabaseReady } = require('./supabaseClient');
const iceServersHandler = require('./api/ice-servers');

const root = __dirname;
const imagesDir = path.join(root, 'images');
const attachmentsDir = path.join(root, 'uploads', 'attachments');
const requestedPort = Number(process.env.PORT || 3000);
const signalingRooms = new Map();

fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(attachmentsDir, { recursive: true });

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function handleSignal(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const room = String(payload.room || 'default');
      const messages = signalingRooms.get(room) || [];
      messages.push({ ...payload, at: Date.now() });
      signalingRooms.set(room, messages.slice(-100));
      sendJson(res, 200, { ok: true });
    } catch (error) { sendJson(res, 400, { error: 'Signalisation invalide.' }); }
  });
}

function getSignals(req, res) {
  const room = new URL(req.url, `http://${req.headers.host}`).searchParams.get('room') || 'default';
  sendJson(res, 200, signalingRooms.get(room) || []);
}

function getSupabaseConfig(req, res) {
  if (!supabaseReady) return sendJson(res, 503, { error: 'Supabase Auth n’est pas configuré sur le serveur.' });
  return sendJson(res, 200, { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY });
}

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
  const value = String(rawName || '').trim();
  return TABLE_ALIASES[value] || null;
}

async function readDataTable(tableName) {
  if (!supabaseReady || !supabase) return { ok: false, data: [], message: 'Supabase non configuré.' };

  const resolved = resolveTableName(tableName);
  if (!resolved) return { ok: false, data: [], message: 'Table inconnue.' };

  try {
    const { data, error } = await supabase.from(resolved).select('*');
    if (error) return { ok: false, data: [], message: error.message };
    return { ok: true, data: data || [] };
  } catch (error) {
    return { ok: false, data: [], message: error.message };
  }
}

async function getAuthenticatedSupabase(req) {
  if (!supabaseReady || !supabase) return { error: 'Supabase non configuré.' };
  const authorization = String(req.headers.authorization || '');
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: 'Authentification requise.' };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Session invalide ou expirée.' };
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return { client, user };
}

async function readAuthenticatedTable(client, tableName) {
  const resolved = resolveTableName(tableName);
  if (!resolved) return { ok: false, message: 'Table inconnue.' };
  const { data, error } = await client.from(resolved).select('*');
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data || [] };
}

async function writeAuthenticatedTable(client, user, tableName, records) {
  const resolved = resolveTableName(tableName);
  if (!resolved) return { ok: false, message: 'Table inconnue.' };
  const payload = (Array.isArray(records) ? records : [records]).map(record => ({ ...record }));

  if (resolved === 'users') {
    const { data: profiles, error: profileError } = await client.from('users').select('id, email, "isAdmin"').eq('email', user.email).limit(1);
    if (profileError) return { ok: false, message: profileError.message };
    const isAdmin = profiles?.[0]?.isAdmin === true;
    for (const record of payload) {
      if (String(record.email || '').toLowerCase() !== String(user.email || '').toLowerCase() && !isAdmin) {
        return { ok: false, message: 'Vous ne pouvez modifier que votre propre profil.' };
      }
      if (!isAdmin) delete record.isAdmin;
    }
  }

  const { data, error } = await client.from(resolved).upsert(payload, { onConflict: 'id' }).select();
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data || [] };
}

async function deleteAuthenticatedRecord(client, user, tableName, id) {
  const resolved = resolveTableName(tableName);
  if (!resolved || !id) return { ok: false, message: 'Table ou identifiant invalide.' };

  const { data: profiles, error: profileError } = await client.from('users').select('id, email, "isAdmin"').eq('email', user.email).limit(1);
  if (profileError) return { ok: false, message: profileError.message };
  if (!profiles?.[0]?.isAdmin) return { ok: false, message: 'Droits administrateur requis.' };

  const { data, error } = await client.from(resolved).delete().eq('id', id).select();
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data || [] };
}

async function handleDataRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tableName = url.searchParams.get('table') || url.searchParams.get('collection') || url.searchParams.get('entity');

  const auth = await getAuthenticatedSupabase(req);
  if (!auth.client) {
    if (req.method === 'GET' && tableName === 'directions' && !req.headers.authorization && supabaseReady) {
      const result = await readDataTable(tableName);
      return sendJson(res, result.ok ? 200 : 503, { ok: result.ok, data: result.data || [], message: result.message || 'OK' });
    }
    return sendJson(res, 401, { ok: false, data: [], message: auth.error });
  }

  if (req.method === 'GET') {
    const result = await readAuthenticatedTable(auth.client, tableName);
    return sendJson(res, result.ok ? 200 : 503, { ok: result.ok, data: result.data || [], message: result.message || 'OK' });
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const targetTable = payload.table || payload.collection || payload.entity || tableName;
        const records = payload.records ?? payload.data ?? payload.record ?? payload;
        const result = await writeAuthenticatedTable(auth.client, auth.user, targetTable, records);
        if (!result.ok) return sendJson(res, 400, { ok: false, message: result.message || 'Impossible d’enregistrer les données.' });
        return sendJson(res, 200, { ok: true, data: result.data || [], message: 'Données enregistrées.' });
      } catch (error) {
        return sendJson(res, 400, { ok: false, message: 'Payload invalide.' });
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const result = await deleteAuthenticatedRecord(auth.client, auth.user, tableName, id);
    if (!result.ok) return sendJson(res, 400, { ok: false, message: result.message });
    return sendJson(res, 200, { ok: true, data: result.data });
  }

  return sendJson(res, 405, { ok: false, message: 'Méthode non autorisée.' });
}

async function checkSupabase(req, res) {
  if (!supabaseReady) return sendJson(res, 200, { ok: false, message: 'Supabase not configured yet', env: { url: !!process.env.SUPABASE_URL, anonKey: !!process.env.SUPABASE_ANON_KEY } });

  try {
    const { data, error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      return sendJson(res, 200, { ok: false, message: 'Supabase connected but table check failed', details: error.message });
    }
    return sendJson(res, 200, { ok: true, message: 'Supabase connection is working', count: data?.length ?? 0 });
  } catch (error) {
    return sendJson(res, 200, { ok: false, message: 'Supabase connection failed', details: error.message });
  }
}

function uploadProfileImage(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 8 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/.exec(payload.dataUrl || '');
      const userId = String(payload.userId || '').replace(/[^0-9]/g, '');
      if (!match || !userId) return sendJson(res, 400, { error: 'Image ou utilisateur invalide.' });
      const extension = match[1].split('/')[1].replace('jpeg', 'jpg');
      const filename = `profile-${userId}-${crypto.randomUUID()}.${extension}`;
      fs.writeFileSync(path.join(imagesDir, filename), Buffer.from(match[2], 'base64'));
      return sendJson(res, 200, { path: `/images/${filename}` });
    } catch (error) { return sendJson(res, 400, { error: 'Impossible d’enregistrer cette image.' }); }
  });
}

function uploadAttachment(req, res) {
  const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'attachment'));
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const userId = String(req.headers['x-user-id'] || '').replace(/[^0-9]/g, '') || 'anonymous';
  const extension = path.extname(safeName).toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.mp4', '.webm', '.mov', '.avi', '.doc', '.docx', '.xls', '.xlsx', '.csv'];
  if (!allowed.includes(extension)) return sendJson(res, 400, { error: 'Type de fichier non pris en charge.' });

  const filename = `message-${userId}-${crypto.randomUUID()}${extension}`;
  const destination = path.join(attachmentsDir, filename);
  const stream = fs.createWriteStream(destination);
  req.pipe(stream);
  stream.on('finish', () => sendJson(res, 200, { path: `/uploads/attachments/${filename}`, name: safeName }));
  stream.on('error', () => {
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    sendJson(res, 500, { error: 'Impossible d’enregistrer la pièce jointe.' });
  });
}

function serveSupabaseSdk(req, res) {
  const sdkPath = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(sdkPath).pipe(res);
}

function serveStatic(req, res) {
  const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  const hidden = /(^|\/)\./.test(relative) || /^(api|node_modules)\//.test(relative) ||
    /^(server\.js|supabaseClient\.js|package(-lock)?\.json)$/.test(relative) || /\.(sql|md)$/i.test(relative);
  if (hidden) { res.writeHead(404); return res.end('Not found'); }
  if (!filePath.startsWith(root + path.sep) && filePath !== root || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const serverFactory = () => http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/upload-profile') return uploadProfileImage(req, res);
  if (req.method === 'POST' && req.url === '/api/upload-attachment') return uploadAttachment(req, res);
  if (req.method === 'POST' && req.url === '/api/signal') return handleSignal(req, res);
  if (req.method === 'GET' && req.url === '/api/supabase-config') return getSupabaseConfig(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/ice-servers')) return iceServersHandler(req, res);
  if (req.method === 'GET' && req.url === '/api/supabase-sdk') return serveSupabaseSdk(req, res);
  if ((req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE') && req.url.startsWith('/api/data')) return handleDataRequest(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/signals')) return getSignals(req, res);
  if (req.method === 'GET' && req.url === '/api/db-check') return checkSupabase(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('Method Not Allowed');
});

function startServer(port) {
  const server = serverFactory();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} occupé. Nouvelle tentative sur ${port + 1}...`);
      return startServer(port + 1);
    }
    throw error;
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`CUD Collab disponible sur http://localhost:${port}`);
  });
}

startServer(requestedPort);
