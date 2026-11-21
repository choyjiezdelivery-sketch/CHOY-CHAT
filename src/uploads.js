'use strict';

/**
 * Media uploads.
 *
 * Files are written to UPLOAD_DIR (default: <repo>/uploads) and served back
 * from /uploads/<filename>. Two storage drivers are supported:
 *
 *   local     (default) — files on disk, served by express.static
 *   supabase            — files pushed to a Supabase Storage bucket
 *
 * The Supabase driver is only used when SUPABASE_URL, SUPABASE_SERVICE_KEY and
 * SUPABASE_BUCKET are all set; otherwise the app falls back to local disk so it
 * always runs out of the box.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 25 * 1024 * 1024; // 25 MB

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac'],
};

const ALL_MIMES = new Set([...ALLOWED.image, ...ALLOWED.video, ...ALLOWED.audio]);

function kindForMime(mime) {
  if (ALLOWED.image.includes(mime)) return 'image';
  if (ALLOWED.video.includes(mime)) return 'video';
  if (ALLOWED.audio.includes(mime)) return 'audio';
  return 'none';
}

function safeExt(originalName, mime) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext;
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/ogg': '.ogv',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/webm': '.weba',
    'audio/aac': '.aac',
  };
  return map[mime] || '';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const stamp = Date.now().toString(36);
    const rand = crypto.randomBytes(6).toString('hex');
    cb(null, `${stamp}-${rand}${safeExt(file.originalname, file.mimetype)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALL_MIMES.has(file.mimetype)) {
      const err = new Error(`Unsupported file type: ${file.mimetype}`);
      err.status = 415;
      return cb(err);
    }
    cb(null, true);
  },
});

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
}

function supabaseConfigured() {
  return !!(process.env.SUPABASE_URL && serviceKey() && process.env.SUPABASE_BUCKET);
}

/**
 * Push a locally-stored file to Supabase Storage and return its public URL.
 * Returns null when Supabase is not configured (caller keeps the local URL).
 */
async function pushToSupabase(file) {
  if (!supabaseConfigured()) return null;

  const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const bucket = process.env.SUPABASE_BUCKET;
  const key = serviceKey();
  const objectPath = `choy-chat/${file.filename}`;
  const body = fs.readFileSync(file.path);

  const res = await fetch(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': file.mimetype,
      'x-upsert': 'true',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase upload failed (${res.status}): ${text.slice(0, 200)}`);
  }

  // Public bucket URL. If the bucket is private, the app still works because
  // the local copy is kept and served from /uploads.
  return `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/** Build the URL the client should use for an uploaded file. */
function publicUrlFor(file) {
  return `/uploads/${file.filename}`;
}

module.exports = {
  upload,
  UPLOAD_DIR,
  MAX_BYTES,
  ALLOWED,
  kindForMime,
  supabaseConfigured,
  serviceKey,
  pushToSupabase,
  publicUrlFor,
};
