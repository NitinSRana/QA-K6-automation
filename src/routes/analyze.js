const express = require('express');
const { analyzeTestCases, generateK6ScriptStream } = require('../services/aiService');
const { saveScript } = require('../services/scriptStore');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/analyze — extract test cases from raw content
router.post('/', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  try {
    const testCases = await analyzeTestCases(content);
    res.json({ testCases, count: testCases.length });
  } catch (err) {
    logger.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze/generate — generate K6 script (streaming SSE)
router.post('/generate', async (req, res) => {
  const { testCases, scriptName, baseUrl, scenarioType } = req.body;

  if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
    return res.status(400).json({ error: 'testCases array is required' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('start', { message: 'Generating K6 script...' });

    let fullScript = '';

    fullScript = await generateK6ScriptStream(
      testCases,
      { scriptName: scriptName || 'ai_generated', baseUrl, scenarioType },
      chunk => {
        sendEvent('chunk', { text: chunk });
      }
    );

    const meta = saveScript(scriptName || 'ai_generated', fullScript, {
      testCaseCount: testCases.length,
      baseUrl,
      scenarioType,
    });

    sendEvent('done', { scriptId: meta.id, filename: meta.filename, meta });
    res.end();
  } catch (err) {
    logger.error('Generate error:', err.message);
    sendEvent('error', { message: err.message });
    res.end();
  }
});

module.exports = router;
