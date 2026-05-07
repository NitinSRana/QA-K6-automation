const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile, parseBuffer } = require('../services/fileParser');
const logger = require('../utils/logger');

const router = express.Router();

const ALLOWED_EXTS = ['.txt', '.csv', '.xlsx', '.xls', '.json', '.md'];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTS.includes(ext)) return cb(null, true);
  cb(new Error(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_EXTS.join(', ')}`));
};

let upload;

if (process.env.VERCEL) {
  // Vercel: no writable filesystem — keep file in memory
  upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });
} else {
  const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  upload = multer({
    storage: multer.diskStorage({
      destination: UPLOADS_DIR,
      filename: (req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter,
  });
}

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    logger.info(`Parsing uploaded file: ${req.file.originalname}`);
    const ext = path.extname(req.file.originalname).toLowerCase();

    const content = req.file.buffer
      ? parseBuffer(req.file.buffer, ext)
      : parseFile(req.file.path);

    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      path: req.file.path || null,
      content,
      preview: content.slice(0, 500),
      lineCount: content.split('\n').length,
    });
  } catch (err) {
    logger.error('File parse error:', err.message);
    res.status(422).json({ error: err.message });
  }
});

module.exports = router;
