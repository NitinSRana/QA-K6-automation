const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SCRIPTS_DIR = path.join(process.cwd(), process.env.SCRIPTS_DIR || 'scripts/generated');

function ensureDir() {
  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

function saveScript(name, content, metadata = {}) {
  ensureDir();
  const id = uuidv4();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeName}_${id.slice(0, 8)}.js`;
  const filepath = path.join(SCRIPTS_DIR, filename);

  fs.writeFileSync(filepath, content, 'utf-8');

  const meta = {
    id,
    name,
    filename,
    filepath,
    createdAt: new Date().toISOString(),
    ...metadata,
  };

  const metaPath = filepath.replace('.js', '.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return meta;
}

function listScripts() {
  ensureDir();
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.meta.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getScript(id) {
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
  const script = getScript(id);
  if (!script) return false;
  if (fs.existsSync(script.filepath)) fs.unlinkSync(script.filepath);
  const metaPath = script.filepath.replace('.js', '.meta.json');
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  return true;
}

function updateScript(id, content) {
  const script = getScript(id);
  if (!script) return null;
  fs.writeFileSync(script.filepath, content, 'utf-8');
  return script;
}

module.exports = { saveScript, listScripts, getScript, deleteScript, updateScript };
