// CSV serialization that is safe against spreadsheet formula injection.
// A cell beginning with = + - @ (or tab / CR) is treated as a formula by
// Excel / LibreOffice / Google Sheets, so we neutralize it with a leading
// apostrophe and always quote such cells.
function escapeCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(list) {
  const headers = list.length ? Object.keys(list[0]) : ['empty'];
  return [headers.join(','), ...list.map(r => headers.map(h => escapeCell(r[h])).join(','))].join('\n');
}

module.exports = { escapeCell, toCSV };
