// Dumps every business dataset to data/exports/*.csv — the same data the
// Google Sheet receives. Usage: npm run export
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../server/db');
const datasets = require('../server/sheets-datasets');

const OUT = path.join(DATA_DIR, 'exports');
fs.mkdirSync(OUT, { recursive: true });

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const data = datasets();
for (const [name, list] of Object.entries(data)) {
  const headers = list.length ? Object.keys(list[0]) : ['empty'];
  const csv = [headers.join(','), ...list.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  fs.writeFileSync(path.join(OUT, `${name}.csv`), csv);
  console.log(`wrote ${name}.csv (${list.length} rows)`);
}
console.log(`\nAll exports in ${OUT}`);
