// api/upload-attachment.js
// Reçoit une pièce jointe binaire et renvoie son URL publique.
//
//   POST /api/upload-attachment
//   En-têtes : X-File-Name, X-User-Id
//   Corps    : fichier binaire brut

const path = require('path');
const crypto = require('crypto');
const { json, readRawBody } = require('./_shared');
const { hasBlob, blobModule } = require('./_records-store');
const { getUserFromRequest } = require('./_auth');

const ALLOWED = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf',
  '.mp4', '.webm', '.mov', '.avi',
  '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.ppt', '.pptx', '.txt', '.zip', '.rar', '.7z'
];

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.csv': 'text/csv',
  '.txt': 'text/plain; charset=utf-8'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }

  const user = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: 'Authentification requise.' });

  const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'attachment'));
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const userId = String(req.headers['x-user-id'] || '').replace(/[^0-9]/g, '') || 'anonymous';
  const extension = path.extname(safeName).toLowerCase();

  if (!ALLOWED.includes(extension)) {
    return json(res, 400, { error: 'Type de fichier non pris en charge.' });
  }

  try {
    const buffer = await readRawBody(req);
    if (!buffer.length) {
      return json(res, 400, { error: 'Fichier vide.' });
    }

    const filename = `message-${userId}-${crypto.randomUUID()}${extension}`;

    // Développement local sans Blob : pas de persistance, on renvoie une URL
    // symbolique pour ne pas casser l'interface.
    if (!hasBlob) {
      return json(res, 200, { path: `/uploads/attachments/${filename}`, name: safeName, stored: 'none' });
    }

    const { put } = await blobModule();
    const blob = await put(`cud-collab/attachments/${filename}`, buffer, {
      access: 'public',
      contentType: MIME[extension] || req.headers['content-type'] || 'application/octet-stream',
      addRandomSuffix: false
    });

    return json(res, 200, { path: blob.url, name: safeName, filename });
  } catch (error) {
    return json(res, 500, {
      error: "Impossible d'enregistrer la pièce jointe.",
      detail: error.message || String(error)
    });
  }
};

