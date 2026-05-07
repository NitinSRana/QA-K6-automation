const fs = require('fs');

/**
 * Parse k6 JSON output file and return a structured summary.
 * k6 --out json writes one JSON object per line (NDJSON).
 */
function parseK6Results(jsonPath) {
  if (!fs.existsSync(jsonPath)) return null;

  const lines = fs.readFileSync(jsonPath, 'utf-8').trim().split('\n').filter(Boolean);
  const metrics = {};

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'Point' && obj.metric && obj.data) {
        const name = obj.metric;
        if (!metrics[name]) metrics[name] = [];
        metrics[name].push(obj.data.value);
      }
    } catch {}
  }

  const stat = (arr) => {
    if (!arr || !arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      count: arr.length,
      min: +sorted[0].toFixed(2),
      max: +sorted[sorted.length - 1].toFixed(2),
      avg: +(sum / arr.length).toFixed(2),
      p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(2),
    };
  };

  const dur = metrics['http_req_duration'];
  const reqs = metrics['http_reqs'];
  const failed = metrics['http_req_failed'];
  const vus = metrics['vus'];
  const sent = metrics['data_sent'];
  const recv = metrics['data_received'];

  return {
    http_req_duration: stat(dur),
    http_reqs: { total: reqs ? reqs.length : 0 },
    http_req_failed: {
      rate: failed ? +(failed.filter(v => v > 0).length / failed.length * 100).toFixed(2) : 0,
      count: failed ? failed.filter(v => v > 0).length : 0,
    },
    vus: { max: vus ? Math.max(...vus) : 0 },
    data_sent_kb: sent ? +(sent.reduce((a, b) => a + b, 0) / 1024).toFixed(1) : 0,
    data_received_kb: recv ? +(recv.reduce((a, b) => a + b, 0) / 1024).toFixed(1) : 0,
  };
}

module.exports = { parseK6Results };
