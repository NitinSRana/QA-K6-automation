const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const K6_IMAGE = process.env.K6_DOCKER_IMAGE || 'grafana/k6:latest';
const INFLUXDB_URL = process.env.INFLUXDB_URL || '';
const INFLUXDB_DB = process.env.INFLUXDB_DB || 'k6';
const SCRIPTS_DIR = path.resolve(process.cwd(), process.env.SCRIPTS_DIR || 'scripts/generated');

// Detect whether a local k6 binary is available.
// Prefer it over Docker to avoid DinD volume-path issues.
function hasK6Binary() {
  try {
    execSync('k6 version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const USE_K6_BINARY = hasK6Binary();
logger.info(`K6 runner mode: ${USE_K6_BINARY ? 'local binary' : 'docker container'}`);

// In-memory run registry (resets on server restart — use a DB for persistence)
const runs = new Map();

/**
 * Build the spawn command + args for k6.
 * Returns { cmd, args, env }.
 */
function buildCommand(scriptPath, envOverrides = {}) {
  const outputArgs = INFLUXDB_URL
    ? ['--out', `influxdb=${INFLUXDB_URL}/${INFLUXDB_DB}`]
    : [];

  const extraEnv = {
    ...(envOverrides.baseUrl ? { BASE_URL: envOverrides.baseUrl } : {}),
    ...(INFLUXDB_URL ? { K6_INFLUXDB_ADDR: INFLUXDB_URL, K6_INFLUXDB_DB: INFLUXDB_DB } : {}),
  };

  if (USE_K6_BINARY) {
    return {
      cmd: 'k6',
      args: ['run', ...outputArgs, scriptPath],
      env: { ...process.env, ...extraEnv },
    };
  }

  // Docker fallback — only works when running directly on the host (not inside a container),
  // because Docker resolves volume paths relative to the host filesystem.
  const scriptFilename = path.basename(scriptPath);
  const scriptDir = path.dirname(scriptPath);

  const envArgs = Object.entries(extraEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

  return {
    cmd: 'docker',
    args: [
      'run', '--rm',
      '--network', 'host',
      '-v', `${scriptDir}:/scripts`,
      ...envArgs,
      K6_IMAGE,
      'run',
      ...outputArgs,
      `/scripts/${scriptFilename}`,
    ],
    env: process.env,
  };
}

/**
 * Start a K6 run for the given script metadata.
 * Returns the run object immediately; output is streamed asynchronously.
 */
function startRun(scriptMeta, envOverrides = {}) {
  const runId = uuidv4();
  const scriptPath = scriptMeta.filepath;

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script file not found: ${scriptPath}`);
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
    mode: USE_K6_BINARY ? 'binary' : 'docker',
  };

  runs.set(runId, run);

  const { cmd, args, env } = buildCommand(scriptPath, envOverrides);
  logger.info(`Starting K6 run ${runId} [${run.mode}]: ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
  run.pid = proc.pid;

  const emit = (type, data) => {
    const entry = { type, data, time: new Date().toISOString() };
    run.logs.push(entry);
    run.subscribers.forEach(fn => { try { fn(entry); } catch {} });
  };

  proc.stdout.on('data', chunk => emit('stdout', chunk.toString()));
  proc.stderr.on('data', chunk => emit('stderr', chunk.toString()));

  proc.on('close', code => {
    run.status = code === 0 ? 'passed' : 'failed';
    run.exitCode = code;
    run.finishedAt = new Date().toISOString();
    emit('done', { exitCode: code, status: run.status });
    logger.info(`K6 run ${runId} finished — exit code ${code} (${run.status})`);
  });

  proc.on('error', err => {
    run.status = 'error';
    run.finishedAt = new Date().toISOString();
    emit('error', `Failed to start K6: ${err.message}`);
    logger.error(`K6 run ${runId} spawn error: ${err.message}`);
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
 * Subscribe a callback to live log events for a run.
 * Replays buffered logs immediately, then delivers new ones.
 * Returns an unsubscribe function.
 */
function subscribe(runId, sendFn) {
  const run = runs.get(runId);
  if (!run) return null;

  // Replay buffered log entries first
  run.logs.forEach(entry => { try { sendFn(entry); } catch {} });
  run.subscribers.add(sendFn);

  return () => run.subscribers.delete(sendFn);
}

module.exports = { startRun, getRun, listRuns, subscribe, USE_K6_BINARY };
