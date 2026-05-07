const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile } = require('../services/fileParser');
const logger = require('../utils/logger');

const router = express.Router();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.csv', '.xlsx', '.xls', '.json', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
  },
});

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    logger.info(`Parsing uploaded file: ${req.file.originalname}`);
    const content = parseFile(req.file.path);

    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
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
