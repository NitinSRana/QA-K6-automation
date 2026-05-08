const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Parse a file at a given path and return raw text representing test cases.
 * Supports .txt, .md, .csv, .xlsx, .xls, .json
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

  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
    return parseCsvOrExcelFromPath(filePath);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

/**
 * Parse a Buffer (from multer memoryStorage) given a file extension.
 */
function parseBuffer(buffer, ext) {
  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf-8');
  }

  if (ext === '.json') {
    const raw = JSON.parse(buffer.toString('utf-8'));
    return JSON.stringify(raw, null, 2);
  }

  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
    return parseCsvOrExcelFromBuffer(buffer);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

function parseCsvOrExcelFromPath(filePath) {
  const workbook = XLSX.readFile(filePath);
  return sheetsToText(workbook);
}

function parseCsvOrExcelFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return sheetsToText(workbook);
}

function sheetsToText(workbook) {
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

module.exports = { parseFile, parseBuffer };
