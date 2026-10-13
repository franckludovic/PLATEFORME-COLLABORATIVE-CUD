// api/signals.js
// Renvoie les messages de signalisation WebRTC d'une salle.
//
//   GET /api/signals?room=xxx

const { json } = require('./_shared');
const { readRecords } = require('./_records-store');
const { getUserFromRequest } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }

  if (!(await getUserFromRequest(req))) return json(res, 401, []);

  try {
    const room = String(
      (req.query && req.query.room) ||
        new URL(req.url, 'http://localhost').searchParams.get('room') ||
        'default'
    );
    const store = await readRecords('signals');
    return json(res, 200, store[room] || []);
  } catch (error) {
    return json(res, 200, []);
  }
};
