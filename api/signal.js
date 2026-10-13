// api/signal.js
// Reçoit les messages de signalisation WebRTC (offer/answer/candidate).
// Les fonctions serverless étant sans état, les messages sont stockés dans
// Vercel Blob (ou /tmp en développement local).
//
//   POST /api/signal  { room, userId, type, ... }

const { json, readJsonBody } = require('./_shared');
const { readRecords, writeRecords } = require('./_records-store');
const { getUserFromRequest } = require('./_auth');

const MAX_PER_ROOM = 200;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }

  if (!(await getUserFromRequest(req))) return json(res, 401, { error: 'Authentification requise.' });

  try {
    const payload = await readJsonBody(req);
    const room = String(payload.room || 'default');
    const store = await readRecords('signals');
    const messages = (store[room] || []).slice(-MAX_PER_ROOM);
    messages.push({ ...payload, at: Date.now() });
    store[room] = messages.slice(-MAX_PER_ROOM);
    await writeRecords('signals', store);
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 400, { error: 'Signalisation invalide.' });
  }
};
