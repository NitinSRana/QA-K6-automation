const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const IS_VERCEL = !!process.env.VERCEL;
const SCRIPTS_DIR = IS_VERCEL ? null : path.join(process.cwd(), process.env.SCRIPTS_DIR || 'scripts/generated');

// In-memory store used on Vercel (or as a fallback)
const memStore = new Map();

function ensureDir() {
  if (!IS_VERCEL && SCRIPTS_DIR && !fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }
}

function saveScript(name, content, metadata = {}) {
  const id = uuidv4();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeName}_${id.slice(0, 8)}.js`;

  const meta = {
    id,
    name,
    filename,
    filepath: IS_VERCEL ? null : path.join(SCRIPTS_DIR, filename),
    createdAt: new Date().toISOString(),
    ...metadata,
  };

  if (IS_VERCEL) {
    memStore.set(id, { ...meta, content });
  } else {
    ensureDir();
    fs.writeFileSync(meta.filepath, content, 'utf-8');
    fs.writeFileSync(meta.filepath.replace('.js', '.meta.json'), JSON.stringify(meta, null, 2));
  }

  return meta;
}

function listScripts() {
  if (IS_VERCEL) {
    return Array.from(memStore.values())
      .map(({ content, ...meta }) => meta)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  ensureDir();
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.meta.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf-8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getScript(id) {
  if (IS_VERCEL) {
    const entry = memStore.get(id);
    return entry || null;
  }

  ensureDir();
  const metas = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.meta.json'));
  for (const mf of metas) {
    const meta = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, mf), 'utf-8'));
    if (meta.id === id) {
      const content = fs.readFileSync(meta.filepath, 'utf-8');
      return { ...meta, content };
    }
  }
  return null;
}

function deleteScript(id) {
  if (IS_VERCEL) {
    return memStore.delete(id);
  }

  const script = getScript(id);
  if (!script) return false;
  if (fs.existsSync(script.filepath)) fs.unlinkSync(script.filepath);
  const metaPath = script.filepath.replace('.js', '.meta.json');
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  return true;
}

function updateScript(id, content) {
  if (IS_VERCEL) {
    const entry = memStore.get(id);
    if (!entry) return null;
    memStore.set(id, { ...entry, content });
    return entry;
  }

  const script = getScript(id);
  if (!script) return null;
  fs.writeFileSync(script.filepath, content, 'utf-8');
  return script;
}

module.exports = { saveScript, listScripts, getScript, deleteScript, updateScript };
