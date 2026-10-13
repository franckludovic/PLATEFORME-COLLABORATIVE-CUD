// Utilitaires partagés entre les fonctions serverless Vercel.
// Vercel accepte tout fichier commençant par "_" à l'intérieur de /api
// sans le convertir en route HTTP.

const MAX_REQUEST_BYTES = 4.5 * 1024 * 1024; // limite du corps de requête sur Vercel

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  // Vercel peut déjà avoir lu et analysé le corps : on le réutilise, sinon
  // l'événement "end" du flux ne se déclenche jamais et la requête reste bloquée.
  if (req.body !== undefined && req.body !== null) {
    try {
      if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.length ? JSON.parse(req.body.toString('utf8')) : {});
      if (typeof req.body === 'string') return Promise.resolve(req.body ? JSON.parse(req.body) : {});
      if (typeof req.body === 'object') return Promise.resolve(req.body);
    } catch (error) {
      return Promise.reject(new Error('Corps JSON invalide.'));
    }
  }

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Corps JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

// Lit le corps brut (utilisé pour les pièces jointes binaires).
function readRawBody(req, limit = MAX_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Fichier trop volumineux (limite 4,5 Mo).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

const DATA_KINDS = new Set(['users', 'messages', 'documents', 'tasks', 'folders']);

module.exports = { json, readJsonBody, readRawBody, getBaseUrl, DATA_KINDS };
