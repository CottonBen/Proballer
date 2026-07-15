// Google Sheets sync — pushes ALL business data into one spreadsheet, one tab
// per dataset. Deliberately does NOT use anyone's Google password; it uses a
// Google Cloud *service account*, the supported way to let an app write to a
// sheet you own. Setup (≈2 minutes, see README "Connect Google Sheets"):
//   1. Create a service account + JSON key in Google Cloud, enable Sheets API.
//   2. Create a blank spreadsheet in the proballerscoaching@gmail.com account
//      and share it (Editor) with the service account's email address.
//   3. Run the server with:
//        GOOGLE_SERVICE_ACCOUNT=/path/to/key.json  GOOGLE_SHEET_ID=<sheet id>
// From then on every table syncs automatically after each booking and hourly.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { db } = require('./db');
const datasets = require('./sheets-datasets');

const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT || '';
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';

function configured() { return Boolean(KEY_PATH && SHEET_ID && fs.existsSync(KEY_PATH)); }

let cachedToken = null; // { token, expiresAt }
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!resp.ok) throw new Error(`Google token request failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

function toRows(list) {
  if (!list.length) return [['(no data yet)']];
  const headers = Object.keys(list[0]);
  return [headers, ...list.map(r => headers.map(h => r[h] == null ? '' : String(r[h])))];
}

async function api(token, path, method, body) {
  const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw new Error(`Sheets API ${path}: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function syncAll() {
  if (!configured()) return { synced: false, reason: 'not-configured' };
  const token = await getAccessToken();
  const data = datasets();

  // Make sure every tab exists.
  const meta = await api(token, '?fields=sheets.properties.title', 'GET');
  const existing = new Set(meta.sheets.map(s => s.properties.title));
  const missing = Object.keys(data).filter(t => !existing.has(t));
  if (missing.length) {
    await api(token, ':batchUpdate', 'POST', {
      requests: missing.map(title => ({ addSheet: { properties: { title } } })),
    });
  }

  // Clear + write each tab.
  for (const [tab, list] of Object.entries(data)) {
    await api(token, `/values/${encodeURIComponent(tab)}!A1:ZZ100000:clear`, 'POST', {});
    await api(token, `/values/${encodeURIComponent(tab)}!A1?valueInputOption=RAW`, 'PUT', {
      range: `${tab}!A1`, majorDimension: 'ROWS', values: toRows(list),
    });
  }
  const at = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('sheets_last_sync', ?)").run(at);
  return { synced: true, tabs: Object.keys(data), at };
}

// Debounced background sync — used after bookings so requests never wait on Google.
let syncTimer = null;
function scheduleSync() {
  if (!configured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncAll().catch(e => console.error('[sheets]', e.message)), 5000);
}

function status() {
  const last = db.prepare("SELECT value FROM meta WHERE key = 'sheets_last_sync'").get();
  return { configured: configured(), lastSync: last ? last.value : null };
}

module.exports = { configured, syncAll, scheduleSync, status };
