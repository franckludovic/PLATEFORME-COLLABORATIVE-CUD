// api/upload-profile.js
// Reçoit une image de profil en base64 (data URL) et renvoie son URL publique.
//
//   POST /api/upload-profile  { userId, dataUrl }

const crypto = require('crypto');
const { json, readJsonBody, getBaseUrl } = require('./_shared');
const { hasBlob, blobModule } = require('./_records-store');
const { getUserFromRequest } = require('./_auth');

const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }

  const user = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: 'Authentification requise.' });

  try {
    const payload = await readJsonBody(req);
    const userId = String(payload.userId || '').replace(/[^0-9]/g, '');
    const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/.exec(payload.dataUrl || '');
    if (!match || !userId) {
      return json(res, 400, { error: 'Image ou utilisateur invalide.' });
    }

    const extension = ALLOWED[match[1]];
    if (!extension) {
      return json(res, 400, { error: "Format d'image non pris en charge." });
    }

    const buffer = Buffer.from(match[2], 'base64');
    const filename = `profile-${userId}-${crypto.randomUUID()}.${extension}`;

    // En développement local (sans Blob), on renvoie l'image en data URL :
    // le rendu fonctionne, même si rien n'est persisté.
    if (!hasBlob) {
      return json(res, 200, { path: payload.dataUrl, stored: 'inline' });
    }

    const { put } = await blobModule();
    const blob = await put(`cud-collab/images/${filename}`, buffer, {
      access: 'public',
      contentType: match[1],
      addRandomSuffix: false
    });

    return json(res, 200, { path: blob.url, filename });
  } catch (error) {
    return json(res, 400, { error: "Impossible d'enregistrer cette image." });
  }
};

