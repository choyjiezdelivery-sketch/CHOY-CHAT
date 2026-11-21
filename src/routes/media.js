'use strict';

/**
 * Media upload endpoint.
 *
 *   POST /api/media/upload   multipart/form-data, field name "file"
 *
 * Returns { url, mediaType, size, mime, storage }. When Supabase Storage is
 * configured the file is pushed there and the public Supabase URL is returned;
 * otherwise the file stays on local disk and is served from /uploads.
 */

const express = require('express');
const fs = require('fs');
const { requireAuth } = require('../auth');
const {
  upload,
  kindForMime,
  supabaseConfigured,
  pushToSupabase,
  publicUrlFor,
} = require('../uploads');

const router = express.Router();

router.post('/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

  const mediaType = kindForMime(req.file.mimetype);
  let url = publicUrlFor(req.file);
  let storage = 'local';

  if (supabaseConfigured()) {
    try {
      const remote = await pushToSupabase(req.file);
      if (remote) {
        url = remote;
        storage = 'supabase';
        // Keep the local copy as a fallback only if the bucket is private.
        if (process.env.UPLOAD_KEEP_LOCAL !== 'true') {
          fs.unlink(req.file.path, () => {});
        }
      }
    } catch (err) {
      // A Supabase failure must not lose the upload — fall back to local disk.
      console.error('Supabase upload failed, keeping local copy:', err.message);
      storage = 'local';
    }
  }

  res.status(201).json({
    url,
    mediaType,
    storage,
    size: req.file.size,
    mime: req.file.mimetype,
    filename: req.file.filename,
  });
});

module.exports = router;
