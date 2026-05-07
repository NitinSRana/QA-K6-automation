const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const IS_VERCEL = !!process.env.VERCEL;

if (IS_VERCEL) {
  // Vercel serverless: no subprocess spawning available
  logger.info('K6 runner mode: unavailable (Vercel serverless environment)');
  module.exports = {
    startRun: () => { throw new Error('K6 execution is not available on Vercel. Download the script and run it locally.'); },
    getRun: () => null,
    listRuns: () => [],
    subscribe: () => null,
    USE_K6_BINARY: false,
  };
} else {
  const { spawn, execSync } = require('child_process');

  const K6_IMAGE = process.env.K6_DOCKER_IMAGE || 'grafana/k6:latest';
  const INFLUXDB_URL = process.env.INFLUXDB_URL || '';
  const INFLUXDB_DB = process.env.INFLUXDB_DB || 'k6';

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

  const runs = new Map();

  const RESULTS_DIR = path.join(process.cwd(), 'scripts', 'results');
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  function buildCommand(scriptPath, envOverrides = {}, runId) {
    const outputArgs = [];

    if (INFLUXDB_URL) {
      outputArgs.push('--out', `influxdb=${INFLUXDB_URL}/${INFLUXDB_DB}`);
    }

    const jsonOut = path.join(RESULTS_DIR, `${runId}.json`);
    outputArgs.push('--out', `json=${jsonOut}`);

    const extraEnv = {
      ...(envOverrides.baseUrl ? { BASE_URL: envOverrides.baseUrl } : {}),
      ...(INFLUXDB_URL ? { K6_INFLUXDB_ADDR: INFLUXDB_URL, K6_INFLUXDB_DB: INFLUXDB_DB } : {}),
    };

    if (USE_K6_BINARY) {
      return {
        cmd: 'k6',
        args: ['run', ...outputArgs, scriptPath],
        env: { ...process.env, ...extraEnv },
        jsonOut,
      };
    }

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
      jsonOut,
    };
  }

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

    const { cmd, args, env, jsonOut } = buildCommand(scriptPath, envOverrides, runId);
    run.jsonOut = jsonOut;
    run.dashboardUrl = null;
    run.reportPath = path.join(RESULTS_DIR, `${runId}_report.html`);
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

  function subscribe(runId, sendFn) {
    const run = runs.get(runId);
    if (!run) return null;
    run.logs.forEach(entry => { try { sendFn(entry); } catch {} });
    run.subscribers.add(sendFn);
    return () => run.subscribers.delete(sendFn);
  }

  module.exports = { startRun, getRun, listRuns, subscribe, USE_K6_BINARY };
}
