// Runs every suite in this directory sequentially (each E2E suite boots its
// own scratch server on its own port and wipes its own tests/*-data dir).
//   npm test              -> all suites
//   npm test fm           -> only suites whose filename contains "fm"
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const filter = process.argv[2] || '';
const suites = fs.readdirSync(__dirname)
  .filter((f) => f.startsWith('test-') && f.endsWith('.js') && f.includes(filter))
  .sort();
let failed = 0;
for (const f of suites) {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
