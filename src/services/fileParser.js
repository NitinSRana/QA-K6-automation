const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Parse uploaded file and return raw text content representing test cases.
 * Supports .txt, .csv, .xlsx, .xls, .json
 */
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.json') {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return JSON.stringify(raw, null, 2);
  }

  if (ext === '.csv') {
    return parseCsvOrExcel(filePath, true);
  }

  if (ext === '.xlsx' || ext === '.xls') {
    return parseCsvOrExcel(filePath, false);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

function parseCsvOrExcel(filePath, isCsv) {
  const workbook = isCsv
    ? XLSX.readFile(filePath, { type: 'file', raw: false })
    : XLSX.readFile(filePath);

  const lines = [];

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) return;

    lines.push(`=== Sheet: ${sheetName} ===`);

    rows.forEach((row, idx) => {
      const cells = Object.entries(row)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      if (cells) lines.push(`Row ${idx + 1}: ${cells}`);
    });
  });

  return lines.join('\n');
}

module.exports = { parseFile };
