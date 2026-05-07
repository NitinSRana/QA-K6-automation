/* ===== Global State ===== */
const state = {
  rawContent: '',
  testCases: [],
  currentScriptId: null,
  currentRunId: null,
  k6Available: true, // updated after /health check
  uploads: JSON.parse(localStorage.getItem('k6_uploads') || '[]'),
  stats: JSON.parse(localStorage.getItem('k6_stats') || '{"uploads":0,"testCases":0,"scripts":0,"runs":0}'),
};

/* ===== API Key Helpers ===== */
function getApiKey() {
  return localStorage.getItem('groq_api_key') || '';
}

function groqHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const key = getApiKey();
  if (key) h['X-Groq-Api-Key'] = key;
  return h;
}

function updateKeyBanner() {
  const hasKey = !!getApiKey() || false;
  document.getElementById('noKeyBanner')?.classList.toggle('hidden', hasKey);
  document.getElementById('keyMissingDot')?.classList.toggle('hidden', hasKey);
}
updateKeyBanner();

/* ===== Environment Detection ===== */
async function initEnvironment() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    state.k6Available = data.k6Available !== false;
  } catch {
    state.k6Available = true; // assume local if health check fails
  }

  if (!state.k6Available) {
    // Show download-run panel instead of execute panel in Script tab
    document.getElementById('executeActions')?.classList.add('hidden');
    document.getElementById('downloadRunPanel')?.classList.remove('hidden');
    // Show notice in Execute tab
    document.getElementById('noK6Notice')?.classList.remove('hidden');
    document.getElementById('logOutput').textContent = 'K6 execution is not available. Download your script and run it locally.';
  }
}
initEnvironment();

/* ===== Sidebar Navigation ===== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    switchTab(item.dataset.tab);
  });
});

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${name}`);
  });
  if (name === 'script') loadSavedScripts();
  if (name === 'history') loadRunHistory();
}

/* ===== Stats ===== */
function updateStats(patch = {}) {
  Object.assign(state.stats, patch);
  localStorage.setItem('k6_stats', JSON.stringify(state.stats));
  document.getElementById('statUploads').textContent = state.stats.uploads;
  document.getElementById('statTestCases').textContent = state.stats.testCases;
  document.getElementById('statScripts').textContent = state.stats.scripts;
  document.getElementById('statRuns').textContent = state.stats.runs;
}
updateStats(); // render on load

/* ===== Mode Tabs (File / Paste) ===== */
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    document.getElementById('modeFile').classList.toggle('hidden', mode !== 'file');
    document.getElementById('modePaste').classList.toggle('hidden', mode !== 'paste');
  });
});

/* ===== Upload Zone ===== */
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

document.getElementById('browseBtn').addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
});
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', e => {
  if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('dragover');
});
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
});
document.getElementById('changeFileBtn').addEventListener('click', e => {
  e.stopPropagation();
  showUploadState('idle');
  hide('uploadResult');
  fileInput.value = '';
});

function showUploadState(state) {
  ['uploadIdle', 'uploadProgress', 'uploadSuccess'].forEach(id => hide(id));
  if (state === 'idle') show('uploadIdle');
  if (state === 'progress') show('uploadProgress');
  if (state === 'success') show('uploadSuccess');
}

function fileTypeIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = { txt: '📄', md: '📄', csv: '📊', xlsx: '📊', xls: '📊', json: '📋' };
  return icons[ext] || '📄';
}

async function handleFileUpload(file) {
  showError('uploadError', '');
  showUploadState('progress');
  hide('uploadResult');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    state.rawContent = data.content;

    // Show success state inside zone
    document.getElementById('uploadedFileName').textContent = data.filename;
    document.getElementById('uploadedFileMeta').textContent =
      `${formatSize(data.size)} · ${data.lineCount} lines`;
    showUploadState('success');

    // Show file result card
    document.getElementById('fileTypeIcon').textContent = fileTypeIcon(data.filename);
    document.getElementById('uploadFilename').textContent = data.filename;
    document.getElementById('uploadSize').textContent = formatSize(data.size);
    document.getElementById('uploadLines').textContent = `${data.lineCount} lines`;
    document.getElementById('contentPreview').textContent =
      data.preview + (data.content.length > 500 ? '\n...' : '');
    document.getElementById('previewLineCount').textContent = `${data.lineCount} lines`;
    show('uploadResult');

    // Track upload
    updateStats({ uploads: state.stats.uploads + 1 });
    addRecentUpload({ filename: data.filename, size: data.size, content: data.content, time: Date.now() });

  } catch (err) {
    showUploadState('idle');
    showError('uploadError', err.message);
  }
}

document.getElementById('analyzeBtn').addEventListener('click', () => {
  if (state.rawContent) analyzeContent(state.rawContent);
});

/* ===== Recent Uploads ===== */
function addRecentUpload(entry) {
  state.uploads = [entry, ...state.uploads.filter(u => u.filename !== entry.filename)].slice(0, 8);
  localStorage.setItem('k6_uploads', JSON.stringify(state.uploads));
  renderRecentUploads();
}

function renderRecentUploads() {
  const list = document.getElementById('recentUploadsList');
  if (!state.uploads.length) {
    list.innerHTML = '<div class="empty-state-sm">No uploads yet</div>';
    return;
  }
  list.innerHTML = state.uploads.map((u, i) => `
    <div class="recent-upload-item" onclick="reAnalyze(${i})">
      <span class="recent-upload-icon">${fileTypeIcon(u.filename)}</span>
      <div class="recent-upload-info">
        <div class="recent-upload-name">${esc(u.filename)}</div>
        <div class="recent-upload-meta">${formatSize(u.size)} · ${timeAgo(u.time)}</div>
      </div>
      <button class="recent-upload-reanalyze" onclick="event.stopPropagation();reAnalyze(${i})">Analyze</button>
    </div>
  `).join('');
}
renderRecentUploads();

window.reAnalyze = function(idx) {
  const upload = state.uploads[idx];
  if (!upload) return;
  state.rawContent = upload.content;
  analyzeContent(upload.content);
};

document.getElementById('refreshUploadsBtn').addEventListener('click', renderRecentUploads);

/* ===== Paste Panel ===== */
const pasteArea = document.getElementById('pasteArea');
pasteArea.addEventListener('input', () => {
  document.getElementById('charCount').textContent = pasteArea.value.length;
});

document.getElementById('analyzePasteBtn').addEventListener('click', () => {
  const content = pasteArea.value.trim();
  if (!content) return showError('pasteError', 'Please enter some test cases first');
  showError('pasteError', '');
  state.rawContent = content;
  analyzeContent(content);
});

/* ===== Sample File Download ===== */
document.getElementById('downloadSampleBtn').addEventListener('click', e => {
  e.preventDefault();
  const sample = `Test Suite: E-Commerce API Load Tests

Test Case 1: User Authentication
- POST /api/auth/login with { "email": "user@example.com", "password": "password123" }
- Expect 200 OK with JWT token in response
- Assert: response time < 500ms, body contains "token"
- Load: 50 virtual users, ramp up 30s, run 2 minutes

Test Case 2: Get Product Catalog
- GET /api/products?page=1&limit=20
- Expect 200 OK with array of products
- Assert: response time < 800ms
- Load: 100 virtual users, 5 minutes

Test Case 3: Get Product Details
- GET /api/products/{id} where id is 1-100
- Expect 200 OK with product details
- Assert: response time < 300ms
- Load: 200 virtual users, 3 minutes

Test Case 4: Add to Cart
- POST /api/cart/items with { "productId": 42, "quantity": 1 }
- Requires Bearer token from login
- Expect 201 Created
- Load: 30 users, 2 minutes

Test Case 5: Health Check (smoke only)
- GET /health
- Expect 200 OK
- Assert: response time < 100ms
- Note: smoke test only, not for load testing
`;
  const blob = new Blob([sample], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'sample-test-cases.txt'; a.click();
  URL.revokeObjectURL(url);
});

/* ===== Analyze ===== */
async function analyzeContent(content) {
  switchTab('analyze');
  hide('testCasesContainer');
  hide('analyzeError');
  show('analyzingSpinner');
  setStatus('analyzeStatus', 'analyzing', '⟳ Analyzing...');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: groqHeaders(),
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    state.testCases = data.testCases;
    renderTestCases(data.testCases);
    setStatus('analyzeStatus', 'success', `✓ ${data.count} test cases found`);
    show('testCasesContainer');
    updateStats({ testCases: state.stats.testCases + data.count });
  } catch (err) {
    showError('analyzeError', err.message);
    setStatus('analyzeStatus', 'error', '✗ Failed');
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
          ${tc.inferred_fields?.length
            ? `<span class="badge badge-yellow" style="margin-left:8px">⚠ inferred: ${tc.inferred_fields.join(', ')}</span>`
            : ''}
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
    const res = await fetch('/api/analyze/generate', {
      method: 'POST',
      headers: groqHeaders(),
      body: JSON.stringify({ testCases: state.testCases, scriptName, baseUrl, scenarioType }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
              state.currentScriptId = evt.scriptId;
              document.getElementById('scriptFilename').textContent = `📄 ${evt.filename}`;
              document.getElementById('scriptId').textContent = `ID: ${evt.scriptId.slice(0, 8)}`;
              updateStats({ scripts: state.stats.scripts + 1 });
            }
            if (evt.message && evt.message.startsWith('Error')) {
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
  navigator.clipboard.writeText(document.getElementById('scriptEditor').value).then(() => {
    const btn = document.getElementById('copyScriptBtn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  });
});

document.getElementById('downloadScriptBtn').addEventListener('click', () => {
  const content = document.getElementById('scriptEditor').value;
  const name = (document.getElementById('scriptFilename').textContent.replace('📄 ', '') || 'k6_script.js');
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
      const btn = document.getElementById('saveScriptBtn');
      btn.textContent = '✓ Saved!';
      setTimeout(() => { btn.textContent = '💾 Save'; }, 2000);
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
            ${s.filename} · ${formatDate(s.createdAt)}
            ${s.testCaseCount ? ` · ${s.testCaseCount} test cases` : ''}
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

document.getElementById('downloadRunBtn')?.addEventListener('click', () => {
  if (state.currentScriptId) downloadScript(state.currentScriptId);
});

function downloadScript(scriptId) {
  const a = document.createElement('a');
  a.href = `/api/scripts/${scriptId}/download`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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
    updateStats({ runs: state.stats.runs + 1 });

    const es = new EventSource(`/api/execute/${run.runId}/stream`);
    es.addEventListener('log', e => appendLog(logEl, JSON.parse(e.data)));
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
    es.onerror = () => { es.close(); setStatus('runStatus', 'error', 'Connection error'); };
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
            Run ${r.id.slice(0, 8)} · ${formatDate(r.startedAt)}
            ${r.finishedAt ? ` · ${duration(r.startedAt, r.finishedAt)}` : ''}
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
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso) { return new Date(iso).toLocaleString(); }

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function duration(start, end) {
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`;
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

/* ===== Settings — API Key Management ===== */
(function initSettings() {
  const input = document.getElementById('groqKeyInput');
  const saveBtn = document.getElementById('saveKeyBtn');
  const clearBtn = document.getElementById('clearKeyBtn');
  const toggleBtn = document.getElementById('keyToggleBtn');
  const statusEl = document.getElementById('keyStatus');

  // Pre-fill input if key already saved
  const existing = getApiKey();
  if (existing) input.value = existing;

  function showKeyStatus(type, msg) {
    statusEl.className = `key-status key-status-${type}`;
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden');
    if (type === 'success') setTimeout(() => statusEl.classList.add('hidden'), 3000);
  }

  saveBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) return showKeyStatus('error', 'Please paste your Groq API key first.');
    if (!val.startsWith('gsk_')) return showKeyStatus('error', 'Key should start with "gsk_" — double-check you copied it correctly.');
    localStorage.setItem('groq_api_key', val);
    showKeyStatus('success', '✓ Key saved — AI features are now active.');
    updateKeyBanner();
  });

  clearBtn.addEventListener('click', () => {
    localStorage.removeItem('groq_api_key');
    input.value = '';
    showKeyStatus('info', 'Key cleared.');
    updateKeyBanner();
  });

  toggleBtn.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? '🙈' : '👁';
  });
})();

// Expose for inline onclick handlers
window.loadScript = loadScript;
window.runScript = runScript;
window.deleteScript = deleteScript;
window.reAnalyze = window.reAnalyze;
