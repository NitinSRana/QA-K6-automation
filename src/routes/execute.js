const express = require('express');
const { startRun, getRun, listRuns, subscribe } = require('../services/k6Runner');
const { getScript } = require('../services/scriptStore');
const { parseK6Results } = require('../services/resultsParser');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/execute — start a K6 run
router.post('/', (req, res) => {
  const { scriptId, baseUrl, envOverrides } = req.body;
  if (!scriptId) return res.status(400).json({ error: 'scriptId is required' });

  const script = getScript(scriptId);
  if (!script) return res.status(404).json({ error: 'Script not found' });

  try {
    const run = startRun(script, { baseUrl, ...envOverrides });
    res.json({
      runId: run.id,
      status: run.status,
      scriptName: run.scriptName,
      startedAt: run.startedAt,
      dashboardUrl: run.dashboardUrl,
      mode: run.mode,
    });
  } catch (err) {
    logger.error('Execute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/execute — list all runs
router.get('/', (req, res) => {
  res.json(listRuns());
});

// GET /api/execute/:runId — get run details
router.get('/:runId', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const { subscribers, ...safe } = run;
  res.json(safe);
});

// GET /api/execute/:runId/results — parsed metrics summary
router.get('/:runId/results', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status === 'running') return res.status(202).json({ message: 'Run still in progress' });
  const summary = run.jsonOut ? parseK6Results(run.jsonOut) : null;
  res.json({ runId: run.id, status: run.status, dashboardUrl: run.dashboardUrl, summary });
});

// GET /api/execute/:runId/stream — SSE log stream
router.get('/:runId/stream', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (entry) => {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  };

  const unsubscribe = subscribe(req.params.runId, sendEvent);

  // If run already done, send close
  if (run.status !== 'running') {
    res.write(`event: done\ndata: ${JSON.stringify({ status: run.status })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    if (unsubscribe) unsubscribe();
  });
});

module.exports = router;
