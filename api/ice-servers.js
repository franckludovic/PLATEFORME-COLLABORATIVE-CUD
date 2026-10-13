// api/ice-servers.js
// Serveurs STUN/TURN pour la visioconférence.
//
// TURN via Cloudflare Realtime : le serveur signe la demande avec la clé API
// (jamais exposée au navigateur) et renvoie des identifiants TURN temporaires.
//
// Variables d'environnement (Vercel → Settings → Environment Variables) :
//   CLOUDFLARE_TURN_KEY_ID      identifiant de la clé TURN (Realtime → TURN)
//   CLOUDFLARE_TURN_API_TOKEN   jeton API associé à cette clé
//   TURN_TTL_SECONDS            durée de validité des identifiants (optionnel, 3600 par défaut)

const { json } = require('./_shared');
const { getUserFromRequest } = require('./_auth');

const STUN_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

async function cloudflareIceServers() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) return null;

  const ttl = Number(process.env.TURN_TTL_SECONDS) || 3600;
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl })
    }
  );
  if (!response.ok) throw new Error(`Cloudflare a refusé la demande (HTTP ${response.status}).`);

  const data = await response.json();
  const servers = data.iceServers ?? data;
  const list = Array.isArray(servers) ? servers : [servers];
  return list.filter(server => server && server.urls);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed.' });
  }
  if (!(await getUserFromRequest(req))) {
    return json(res, 401, { error: 'Authentification requise.' });
  }

  try {
    const turn = await cloudflareIceServers();
    if (turn && turn.length) return json(res, 200, { iceServers: [...STUN_SERVERS, ...turn] });
  } catch (error) {
    // Pas de TURN : la visio reste possible en direct (STUN), c'est simplement moins fiable.
    console.error('TURN indisponible :', error.message);
  }
  return json(res, 200, { iceServers: STUN_SERVERS });
};
