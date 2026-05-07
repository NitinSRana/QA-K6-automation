const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const K6_IMAGE = process.env.K6_DOCKER_IMAGE || 'grafana/k6:latest';
const INFLUXDB_URL = process.env.INFLUXDB_URL || 'http://influxdb:8086';
const INFLUXDB_DB = process.env.INFLUXDB_DB || 'k6';
const SCRIPTS_DIR = path.resolve(process.cwd(), process.env.SCRIPTS_DIR || 'scripts/generated');

// In-memory run registry
const runs = new Map();

/**
 * Start a K6 run for the given script file.
 * Returns a run object with an id. Streams output via SSE.
 */
function startRun(scriptMeta, envOverrides = {}) {
  const runId = uuidv4();
  const scriptPath = scriptMeta.filepath;

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const run = {
    id: runId,
    scriptId: scriptMeta.id,
    scriptName: scriptMeta.name,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    subscribers: new Set(),
  };

  runs.set(runId, run);

  // Build docker run args
  const scriptFilename = path.basename(scriptPath);
  const scriptDir = path.dirname(scriptPath);

  const envArgs = [];
  const allEnvs = {
    BASE_URL: envOverrides.baseUrl || '',
    K6_INFLUXDB_ADDR: INFLUXDB_URL,
    K6_INFLUXDB_DB: INFLUXDB_DB,
    ...envOverrides,
  };

  Object.entries(allEnvs).forEach(([k, v]) => {
    if (v) envArgs.push('-e', `${k}=${v}`);
  });

  const useInfluxDB = process.env.INFLUXDB_URL && process.env.INFLUXDB_URL !== '';
  const outputArgs = useInfluxDB
    ? ['--out', `influxdb=${INFLUXDB_URL}/${INFLUXDB_DB}`]
    : [];

  const dockerArgs = [
    'run', '--rm',
    '--network', 'host',
    '-v', `${scriptDir}:/scripts`,
    ...envArgs,
    K6_IMAGE,
    'run',
    ...outputArgs,
    `/scripts/${scriptFilename}`,
  ];

  logger.info(`Starting K6 run ${runId}: docker ${dockerArgs.join(' ')}`);

  const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  run.pid = proc.pid;

  const emit = (type, data) => {
    const entry = { type, data, time: new Date().toISOString() };
    run.logs.push(entry);
    run.subscribers.forEach(send => {
      try { send(entry); } catch {}
    });
  };

  proc.stdout.on('data', chunk => emit('stdout', chunk.toString()));
  proc.stderr.on('data', chunk => emit('stderr', chunk.toString()));

  proc.on('close', code => {
    run.status = code === 0 ? 'passed' : 'failed';
    run.exitCode = code;
    run.finishedAt = new Date().toISOString();
    emit('done', { exitCode: code, status: run.status });
    logger.info(`K6 run ${runId} finished with exit code ${code}`);
  });

  proc.on('error', err => {
    run.status = 'error';
    run.finishedAt = new Date().toISOString();
    emit('error', err.message);
    logger.error(`K6 run ${runId} error: ${err.message}`);
  });

  return run;
}

function getRun(runId) {
  return runs.get(runId) || null;
}

function listRuns() {
  return Array.from(runs.values())
    .map(({ subscribers, ...rest }) => rest)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

/**
 * Subscribe to live log events for a run.
 * Returns an unsubscribe function.
 */
function subscribe(runId, sendFn) {
  const run = runs.get(runId);
  if (!run) return null;

  run.subscribers.add(sendFn);

  // Replay buffered logs
  run.logs.forEach(entry => {
    try { sendFn(entry); } catch {}
  });

  return () => run.subscribers.delete(sendFn);
}

module.exports = { startRun, getRun, listRuns, subscribe };
