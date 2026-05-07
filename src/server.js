require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const uploadRoutes = require('./routes/upload');
const analyzeRoutes = require('./routes/analyze');
const scriptsRoutes = require('./routes/scripts');
const executeRoutes = require('./routes/execute');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure required directories exist
['uploads', 'scripts/generated'].forEach(dir => {
  const full = path.join(process.cwd(), dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/upload', uploadRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/execute', executeRoutes);

app.get('/health', (req, res) => {
  const { USE_K6_BINARY } = require('./services/k6Runner');
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    ai: process.env.GROQ_API_KEY ? 'groq' : 'not configured',
    k6: USE_K6_BINARY ? 'binary' : 'docker',
    influxdb: process.env.INFLUXDB_URL || 'not configured',
  });
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`AI K6 Platform running on http://localhost:${PORT}`);
  console.log(`Grafana dashboard: http://localhost:${process.env.GRAFANA_PORT || 3001}`);
});
