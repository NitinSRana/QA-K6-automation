const express = require('express');
const { listScripts, getScript, deleteScript, updateScript } = require('../services/scriptStore');

const router = express.Router();

// GET /api/scripts
router.get('/', (req, res) => {
  res.json(listScripts());
});

// GET /api/scripts/:id
router.get('/:id', (req, res) => {
  const script = getScript(req.params.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  res.json(script);
});

// PUT /api/scripts/:id
router.put('/:id', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const script = updateScript(req.params.id, content);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  res.json({ success: true, script });
});

// DELETE /api/scripts/:id
router.delete('/:id', (req, res) => {
  const deleted = deleteScript(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Script not found' });
  res.json({ success: true });
});

module.exports = router;
