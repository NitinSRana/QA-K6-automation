/**
 * End-to-end test runner (no API key required):
 *  1. Save a K6 script directly to the script store
 *  2. Execute via POST /api/execute
 *  3. Stream live logs via SSE
 *  4. Fetch and display parsed results summary
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';

// ── helpers ──────────────────────────────────────────────────────────────────

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    }).on('error', reject);
  });
}

function streamGet(url, onEvent) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { onEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      });
      res.on('end', resolve);
    }).on('error', reject);
  });
}

function log(msg)  { process.stdout.write(msg + '\n'); }
function step(n, msg) { log(`\n\x1b[1m\x1b[36m[Step ${n}]\x1b[0m ${msg}`); }
function ok(msg)   { log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function info(msg) { log(`  \x1b[90m${msg}\x1b[0m`); }
function warn(msg) { log(`  \x1b[33m⚠\x1b[0m ${msg}`); }

// ── K6 script targeting the platform's own endpoints ─────────────────────────

const K6_SCRIPT = `
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom metrics
const healthDuration  = new Trend('health_duration',  true);
const scriptsDuration = new Trend('scripts_duration', true);
const runsDuration    = new Trend('runs_duration',    true);
const errorRate       = new Rate('error_rate');
const requestCount    = new Counter('total_requests');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    warmup: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s',  target: 3  },
        { duration: '15s', target: 10 },
        { duration: '10s', target: 10 },
        { duration: '5s',  target: 0  },
      ],
    },
  },
  thresholds: {
    http_req_duration:        ['p(95)<500'],
    http_req_failed:          ['rate<0.01'],
    'health_duration':        ['p(95)<200'],
    'scripts_duration':       ['p(95)<400'],
  },
};

export default function () {
  group('Health Check', () => {
    const res = http.get(\`\${BASE_URL}/health\`);
    healthDuration.add(res.timings.duration);
    requestCount.add(1);
    const ok = check(res, {
      'status is 200':          r => r.status === 200,
      'has status field':       r => JSON.parse(r.body).status === 'ok',
      'has k6 field':           r => JSON.parse(r.body).k6 !== undefined,
      'response time < 200ms':  r => r.timings.duration < 200,
    });
    errorRate.add(!ok);
  });

  sleep(0.2);

  group('List Scripts', () => {
    const res = http.get(\`\${BASE_URL}/api/scripts\`);
    scriptsDuration.add(res.timings.duration);
    requestCount.add(1);
    const ok = check(res, {
      'status is 200':          r => r.status === 200,
      'response is array':      r => Array.isArray(JSON.parse(r.body)),
      'response time < 400ms':  r => r.timings.duration < 400,
    });
    errorRate.add(!ok);
  });

  sleep(0.2);

  group('List Runs', () => {
    const res = http.get(\`\${BASE_URL}/api/execute\`);
    runsDuration.add(res.timings.duration);
    requestCount.add(1);
    const ok = check(res, {
      'status is 200':          r => r.status === 200,
      'response is array':      r => Array.isArray(JSON.parse(r.body)),
      'response time < 400ms':  r => r.timings.duration < 400,
    });
    errorRate.add(!ok);
  });

  sleep(0.3);
}

export function handleSummary(data) {
  // Print custom ASCII table, then let k6 print its own default summary
  console.log(textSummary(data));
  return {};
}

function textSummary(data) {
  const d = data.metrics.http_req_duration;
  if (!d) return '';
  const vals = d.values;
  return [
    '',
    '╔══════════════════════════════════════════╗',
    '║         K6 Platform Self-Test Results    ║',
    '╠══════════════════════════════════════════╣',
    \`║  Total requests : \${String(data.metrics.http_reqs?.values?.count || 0).padStart(22)} ║\`,
    \`║  Avg duration   : \${String((vals.avg || 0).toFixed(2) + ' ms').padStart(22)} ║\`,
    \`║  P90 duration   : \${String((vals['p(90)'] || 0).toFixed(2) + ' ms').padStart(22)} ║\`,
    \`║  P95 duration   : \${String((vals['p(95)'] || 0).toFixed(2) + ' ms').padStart(22)} ║\`,
    \`║  P99 duration   : \${String((vals['p(99)'] || 0).toFixed(2) + ' ms').padStart(22)} ║\`,
    \`║  Max duration   : \${String((vals.max || 0).toFixed(2) + ' ms').padStart(22)} ║\`,
    \`║  Error rate     : \${String(((data.metrics.http_req_failed?.values?.rate || 0)*100).toFixed(2) + '%').padStart(22)} ║\`,
    \`║  Max VUs        : \${String(data.metrics.vus_max?.values?.max || 0).padStart(22)} ║\`,
    '╚══════════════════════════════════════════╝',
  ].join('\\n');
}
`.trim();

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('\n\x1b[1m\x1b[35m══════════════════════════════════════════════════\x1b[0m');
  log('\x1b[1m\x1b[35m   AI K6 Platform — End-to-End Test Run\x1b[0m');
  log('\x1b[1m\x1b[35m══════════════════════════════════════════════════\x1b[0m');
  log('\x1b[90m  Target: localhost:3000 (platform self-test)\x1b[0m');
  log('\x1b[90m  Load:   10 VUs · 35s total (5s ramp-up + 15s sustain + 10s hold + 5s down)\x1b[0m');

  // ── Step 1: server check
  step(1, 'Verify platform is running');
  const health = await get(`${BASE}/health`);
  if (health.status !== 200) throw new Error('Platform not reachable at ' + BASE);
  ok(`Platform online`);
  ok(`K6 mode:  ${health.body.k6}`);
  ok(`InfluxDB: ${health.body.influxdb}`);

  // ── Step 2: save script directly via PUT (simulate AI output)
  step(2, 'Saving K6 test script to platform store');

  // Use the upload → scripts store flow
  const saveRes = await post(`${BASE}/api/scripts/direct`, {
    name: 'platform_self_test',
    content: K6_SCRIPT,
    testCaseCount: 3,
  }).catch(() => null);

  const { saveScript } = require('../src/services/scriptStore');
  const meta = saveScript('platform_self_test', K6_SCRIPT, { testCaseCount: 3, baseUrl: BASE });
  ok(`Script saved: ${meta.filename}`);
  ok(`Script ID:    ${meta.id.slice(0, 8)}`);
  info(`Lines: ${K6_SCRIPT.split('\n').length}`);

  // ── Step 3: execute
  step(3, 'Starting K6 load test execution');
  const execRes = await post(`${BASE}/api/execute`, {
    scriptId: meta.id,
    baseUrl: BASE,
  });
  if (execRes.status !== 200) throw new Error('Execute failed: ' + JSON.stringify(execRes.body));

  const { runId, dashboardUrl, mode } = execRes.body;
  ok(`Run ID:       ${runId.slice(0, 8)}`);
  ok(`Runner mode:  ${mode}`);
  if (dashboardUrl) ok(`Live dashboard: \x1b[4m\x1b[36m${dashboardUrl}\x1b[0m  (open in browser during run)`);

  // ── Step 4: stream live output
  step(4, 'Streaming live K6 output');
  log('\x1b[90m──────────────────────────────────────────────────\x1b[0m');

  let finalStatus = 'unknown';
  await streamGet(`${BASE}/api/execute/${runId}/stream`, entry => {
    if (entry.type === 'stdout' || entry.type === 'stderr') {
      process.stdout.write(entry.data);
    }
    if (entry.type === 'done') {
      finalStatus = entry.data.status;
    }
    if (entry.type === 'error') {
      log(`\x1b[31mError: ${entry.data}\x1b[0m`);
    }
  });

  log('\x1b[90m──────────────────────────────────────────────────\x1b[0m');

  // ── Step 5: results summary
  step(5, 'Fetching parsed results summary');
  await new Promise(r => setTimeout(r, 1500));
  const results = await get(`${BASE}/api/execute/${runId}/results`);
  const s = results.body.summary;

  const passed = finalStatus === 'passed';
  log(passed
    ? '\n\x1b[1m\x1b[32m  ✓ ALL CHECKS PASSED\x1b[0m'
    : '\n\x1b[1m\x1b[31m  ✗ SOME CHECKS FAILED\x1b[0m');

  if (s && s.http_req_duration) {
    log('\n\x1b[1m  📊 Results Summary\x1b[0m');
    log('  ┌──────────────────────────────────────┐');
    log(`  │ Total requests     ${String(s.http_reqs.total).padStart(18)} │`);
    log(`  │ Errors             ${String(s.http_req_failed.count + ' (' + s.http_req_failed.rate + '%)').padStart(18)} │`);
    log(`  │ Avg response time  ${String(s.http_req_duration.avg + ' ms').padStart(18)} │`);
    log(`  │ P90 response time  ${String(s.http_req_duration.p90 + ' ms').padStart(18)} │`);
    log(`  │ P95 response time  ${String(s.http_req_duration.p95 + ' ms').padStart(18)} │`);
    log(`  │ P99 response time  ${String(s.http_req_duration.p99 + ' ms').padStart(18)} │`);
    log(`  │ Max response time  ${String(s.http_req_duration.max + ' ms').padStart(18)} │`);
    log(`  │ Min response time  ${String(s.http_req_duration.min + ' ms').padStart(18)} │`);
    log(`  │ Max VUs            ${String(s.vus.max).padStart(18)} │`);
    log(`  │ Data sent          ${String(s.data_sent_kb + ' KB').padStart(18)} │`);
    log(`  │ Data received      ${String(s.data_received_kb + ' KB').padStart(18)} │`);
    log('  └──────────────────────────────────────┘');
  }

  log(`\n\x1b[90m  Run ID:   ${runId}`);
  log(`  Script:   ${meta.filename}`);
  log(`  Status:   ${finalStatus}`);
  log(`  Report:   scripts/results/${runId}_report.html\x1b[0m`);
  log('\n\x1b[1m\x1b[35m  E2E run complete ✓\x1b[0m\n');
}

main().catch(e => {
  process.stderr.write('\x1b[31m✗ ' + e.message + '\x1b[0m\n');
  process.exit(1);
});
