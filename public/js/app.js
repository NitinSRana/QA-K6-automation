/* ===== Global State ===== */
const state = {
  rawContent: '',
  testCases: [],
  currentScriptId: null,
  currentRunId: null,
};

/* ===== Tab Navigation ===== */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'script') loadSavedScripts();
    if (tab.dataset.tab === 'history') loadRunHistory();
  });
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${name}`);
  });
  if (name === 'script') loadSavedScripts();
  if (name === 'history') loadRunHistory();
}

/* ===== Upload ===== */
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
});

async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  showError('uploadError', '');

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    state.rawContent = data.content;

    document.getElementById('uploadFilename').textContent = `📄 ${data.filename}`;
    document.getElementById('uploadSize').textContent = formatSize(data.size);
    document.getElementById('uploadLines').textContent = `${data.lineCount} lines`;
    document.getElementById('contentPreview').textContent = data.preview + (data.content.length > 500 ? '\n...' : '');

    show('uploadResult');
  } catch (err) {
    showError('uploadError', err.message);
  }
}

document.getElementById('analyzeBtn').addEventListener('click', () => {
  if (state.rawContent) analyzeContent(state.rawContent);
});

document.getElementById('analyzePasteBtn').addEventListener('click', () => {
  const content = document.getElementById('pasteArea').value.trim();
  if (!content) return showError('uploadError', 'Please paste some test cases first');
  state.rawContent = content;
  analyzeContent(content);
});

/* ===== Analyze ===== */
async function analyzeContent(content) {
  switchTab('analyze');
  hide('testCasesContainer');
  hide('analyzeError');
  show('analyzingSpinner');
  setStatus('analyzeStatus', 'analyzing', 'Analyzing...');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    state.testCases = data.testCases;
    renderTestCases(data.testCases);
    setStatus('analyzeStatus', 'success', `${data.count} test cases found`);
    show('testCasesContainer');
  } catch (err) {
    showError('analyzeError', err.message);
    setStatus('analyzeStatus', 'error', 'Failed');
  } finally {
    hide('analyzingSpinner');
  }
}

function renderTestCases(testCases) {
  const suitable = testCases.filter(tc => tc.suitable_for_load_test);
  document.getElementById('tcCount').textContent = `${testCases.length} test cases`;
  document.getElementById('tcLoadCount').textContent = `${suitable.length} load-test ready`;

  const list = document.getElementById('testCasesList');
  list.className = 'tc-list';
  list.innerHTML = testCases.map(tc => `
    <div class="tc-card ${tc.suitable_for_load_test ? 'suitable' : 'not-suitable'}">
      <div class="tc-header">
        <div>
          <span class="tc-title">${esc(tc.name || tc.id)}</span>
          ${tc.inferred_fields?.length ? `<span class="badge badge-yellow" style="margin-left:8px">⚠ inferred: ${tc.inferred_fields.join(', ')}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <span class="method-badge method-${tc.method}">${tc.method}</span>
          ${tc.suitable_for_load_test
            ? '<span class="badge badge-green">✓ Load Test</span>'
            : '<span class="badge badge-gray">Functional</span>'}
        </div>
      </div>
      ${tc.description ? `<p class="tc-desc">${esc(tc.description)}</p>` : ''}
      <div class="tc-details">
        <div class="tc-detail">
          <span class="label">URL</span>
          <span class="value">${esc(tc.url || '-')}</span>
        </div>
        <div class="tc-detail">
          <span class="label">Expected Status</span>
          <span class="value">${tc.expected_status || 200}</span>
        </div>
        <div class="tc-detail">
          <span class="label">Virtual Users</span>
          <span class="value">${tc.load_profile?.vus || 10}</span>
        </div>
        <div class="tc-detail">
          <span class="label">Duration</span>
          <span class="value">${tc.load_profile?.duration || '30s'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ===== Generate K6 Script ===== */
document.getElementById('generateBtn').addEventListener('click', generateScript);

async function generateScript() {
  if (!state.testCases.length) return;

  const scriptName = document.getElementById('scriptName').value || 'ai_generated_test';
  const baseUrl = document.getElementById('baseUrl').value;
  const scenarioType = document.getElementById('scenarioType').value;

  switchTab('script');
  hide('scriptContainer');
  show('generatingSpinner');

  const editor = document.getElementById('scriptEditor');
  editor.value = '';

  try {
    const es = new EventSource('/api/analyze/generate?' + new URLSearchParams({}).toString());

    // Use fetch + streaming manually since EventSource doesn't support POST
    const res = await fetch('/api/analyze/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCases: state.testCases, scriptName, baseUrl, scenarioType }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let scriptMeta = null;

    show('scriptContainer');
    hide('generatingSpinner');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.text) {
              editor.value += evt.text;
              editor.scrollTop = editor.scrollHeight;
            }
            if (evt.scriptId) {
              scriptMeta = evt;
              state.currentScriptId = evt.scriptId;
              document.getElementById('scriptFilename').textContent = `📄 ${evt.filename}`;
              document.getElementById('scriptId').textContent = `ID: ${evt.scriptId.slice(0, 8)}`;
            }
            if (evt.message && evt.message !== 'Generating K6 script...') {
              // error event
              editor.value = `// Error: ${evt.message}`;
            }
          } catch {}
        }
      }
    }

    hide('generatingSpinner');
    show('scriptContainer');
    loadSavedScripts();
  } catch (err) {
    hide('generatingSpinner');
    show('scriptContainer');
    editor.value = `// Generation failed: ${err.message}`;
  }
}

/* ===== Script Management ===== */
document.getElementById('copyScriptBtn').addEventListener('click', () => {
  const content = document.getElementById('scriptEditor').value;
  navigator.clipboard.writeText(content).then(() => {
    document.getElementById('copyScriptBtn').textContent = '✓ Copied!';
    setTimeout(() => document.getElementById('copyScriptBtn').textContent = '📋 Copy', 2000);
  });
});

document.getElementById('downloadScriptBtn').addEventListener('click', () => {
  const content = document.getElementById('scriptEditor').value;
  const name = document.getElementById('scriptFilename').textContent.replace('📄 ', '') || 'k6_script.js';
  const blob = new Blob([content], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('saveScriptBtn').addEventListener('click', async () => {
  if (!state.currentScriptId) return;
  const content = document.getElementById('scriptEditor').value;
  try {
    const res = await fetch(`/api/scripts/${state.currentScriptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      document.getElementById('saveScriptBtn').textContent = '✓ Saved!';
      setTimeout(() => document.getElementById('saveScriptBtn').textContent = '💾 Save Changes', 2000);
    }
  } catch {}
});

async function loadSavedScripts() {
  try {
    const res = await fetch('/api/scripts');
    const scripts = await res.json();
    const list = document.getElementById('savedScriptsList');

    if (!scripts.length) {
      list.innerHTML = '<p class="empty-state">No scripts yet. Generate one from the Analyze tab.</p>';
      return;
    }

    list.innerHTML = scripts.map(s => `
      <div class="script-item">
        <div class="script-item-info">
          <div class="script-item-name">${esc(s.name)}</div>
          <div class="script-item-meta">
            ${s.filename} &nbsp;·&nbsp; ${formatDate(s.createdAt)}
            ${s.testCaseCount ? `&nbsp;·&nbsp; ${s.testCaseCount} test cases` : ''}
          </div>
        </div>
        <div class="script-item-actions">
          <button class="btn btn-sm" onclick="loadScript('${s.id}')">✏ Edit</button>
          <button class="btn btn-sm btn-primary" onclick="runScript('${s.id}')">🚀 Run</button>
          <button class="btn btn-sm" onclick="deleteScript('${s.id}')">🗑</button>
        </div>
      </div>
    `).join('');
  } catch {}
}

async function loadScript(id) {
  const res = await fetch(`/api/scripts/${id}`);
  const script = await res.json();
  state.currentScriptId = id;
  document.getElementById('scriptEditor').value = script.content;
  document.getElementById('scriptFilename').textContent = `📄 ${script.filename}`;
  document.getElementById('scriptId').textContent = `ID: ${id.slice(0, 8)}`;
  show('scriptContainer');
}

async function deleteScript(id) {
  if (!confirm('Delete this script?')) return;
  await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
  loadSavedScripts();
  if (state.currentScriptId === id) {
    state.currentScriptId = null;
    document.getElementById('scriptEditor').value = '';
  }
}

async function runScript(id) {
  await loadScript(id);
  executeScript(id);
}

/* ===== Execute ===== */
document.getElementById('executeBtn').addEventListener('click', () => {
  if (state.currentScriptId) executeScript(state.currentScriptId);
});

async function executeScript(scriptId) {
  const baseUrl = document.getElementById('executeBaseUrl').value;
  switchTab('execute');

  const logEl = document.getElementById('logOutput');
  logEl.innerHTML = '';
  hide('runResult');
  setStatus('runStatus', 'running', '● Running');
  show('runMeta');

  try {
    const res = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptId, baseUrl }),
    });
    const run = await res.json();
    if (!res.ok) throw new Error(run.error || 'Failed to start run');

    state.currentRunId = run.runId;
    document.getElementById('runScriptName').textContent = `📄 ${run.scriptName}`;
    document.getElementById('runId').textContent = `Run: ${run.runId.slice(0, 8)}`;
    document.getElementById('runStartedAt').textContent = formatDate(run.startedAt);

    const es = new EventSource(`/api/execute/${run.runId}/stream`);

    es.addEventListener('log', e => {
      const entry = JSON.parse(e.data);
      appendLog(logEl, entry);
    });

    es.addEventListener('done', e => {
      es.close();
      const data = JSON.parse(e.data);
      const passed = data.status === 'passed';
      setStatus('runStatus', passed ? 'passed' : 'failed', passed ? '✓ Passed' : '✗ Failed');
      show('runResult');
      document.getElementById('runResultBadge').innerHTML = passed
        ? '<span class="badge badge-green" style="font-size:14px">✓ All checks passed</span>'
        : '<span class="badge badge-red" style="font-size:14px">✗ Test failed</span>';
    });

    es.onerror = () => {
      es.close();
      setStatus('runStatus', 'error', 'Connection error');
    };
  } catch (err) {
    logEl.textContent = `Error: ${err.message}`;
    setStatus('runStatus', 'error', 'Error');
  }
}

function appendLog(el, entry) {
  const span = document.createElement('span');
  span.className = `log-${entry.type}`;
  span.textContent = entry.data;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

/* ===== Run History ===== */
async function loadRunHistory() {
  try {
    const res = await fetch('/api/execute');
    const runs = await res.json();
    const el = document.getElementById('runHistory');

    if (!runs.length) {
      el.innerHTML = '<p class="empty-state">No runs yet.</p>';
      return;
    }

    el.innerHTML = runs.map(r => `
      <div class="run-item">
        <div class="run-item-info">
          <div class="run-item-name">${esc(r.scriptName)}</div>
          <div class="run-item-meta">
            Run ${r.id.slice(0, 8)} &nbsp;·&nbsp; ${formatDate(r.startedAt)}
            ${r.finishedAt ? ` &nbsp;·&nbsp; ${duration(r.startedAt, r.finishedAt)}` : ''}
          </div>
        </div>
        <span class="status-badge status-${r.status}">${r.status}</span>
      </div>
    `).join('');
  } catch {}
}

/* ===== Helpers ===== */
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function formatDate(iso) {
  return new Date(iso).toLocaleString();
}
function duration(start, end) {
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
function setStatus(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-badge status-${type}`;
  el.textContent = text;
}
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
  else { el.textContent = ''; el.classList.add('hidden'); }
}

// Expose for inline onclick handlers
window.loadScript = loadScript;
window.runScript = runScript;
window.deleteScript = deleteScript;
