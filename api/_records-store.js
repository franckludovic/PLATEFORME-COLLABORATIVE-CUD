// api/_records-store.js
// Couche de stockage partagée pour toutes les fonctions serverless.
//
//  - En production Vercel : utilise Vercel Blob (BLOB_READ_WRITE_TOKEN).
//  - En développement local : utilise /tmp (le serveur local server.js
//    continue de fonctionner en parallèle, sans Blob).
//
// Préfixe "_" => Vercel ne transforme PAS ce fichier en route HTTP.

const fs = require('fs');
const path = require('path');

const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function objectKey(kind) {
  return `cud-collab/data/${kind}.json`;
}

function localPath(kind) {
  return path.join('/tmp', `cud-collab-${kind}.json`);
}

async function blobModule() {
  // Import dynamique : ne casse pas si le paquet n'est pas installé en local.
  return import('@vercel/blob');
}

async function readRecords(kind) {
  if (hasBlob) {
    // Une erreur de lecture doit remonter : la traiter comme un stockage vide
    // ferait écraser les données existantes à l'écriture suivante.
    const { list } = await blobModule();
    const { blobs } = await list({ prefix: objectKey(kind), limit: 1 });
    if (!blobs.length) return {};
    const response = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Lecture du stockage impossible (HTTP ${response.status}).`);
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  try {
    const file = localPath(kind);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

async function writeRecords(kind, value) {
  const payload = value && typeof value === 'object' ? value : {};

  if (hasBlob) {
    const { put } = await blobModule();
    await put(objectKey(kind), JSON.stringify(payload), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60
    });
    return;
  }

  fs.writeFileSync(localPath(kind), JSON.stringify(payload), 'utf8');
}

module.exports = { hasBlob, readRecords, writeRecords, blobModule };
