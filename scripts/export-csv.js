// Dumps every business dataset to data/exports/*.csv — the same data the
// Google Sheet receives. Usage: npm run export
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../server/db');
const datasets = require('../server/sheets-datasets');

const OUT = path.join(DATA_DIR, 'exports');
fs.mkdirSync(OUT, { recursive: true });

const { toCSV } = require('../server/csv');

const data = datasets();
for (const [name, list] of Object.entries(data)) {
  fs.writeFileSync(path.join(OUT, `${name}.csv`), toCSV(list));
  console.log(`wrote ${name}.csv (${list.length} rows)`);
}
console.log(`\nAll exports in ${OUT}`);
