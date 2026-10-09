// Keeps the SQLite database safe on hosts that wipe their disk on every restart (Render free plan).
// The live database is still the local SQLite file; a copy of it is stored in a free Turso database:
//   - on start: the saved copy is downloaded before the app opens the database
//   - after any change: a fresh copy is uploaded a few seconds later (and at least once a minute)
//   - on shutdown (Render sends SIGTERM): any unsaved change is uploaded first
// Switched on by TURSO_DATABASE_URL + TURSO_AUTH_TOKEN; without them nothing here runs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.TURSO_DATABASE_URL || '';
const TOKEN = process.env.TURSO_AUTH_TOKEN || '';
export const backupEnabled = Boolean(URL);

const CHUNK = 512 * 1024;            // stored in 512 KB pieces, so no single request is large
let client = null;
let savingAllowed = true;            // false if the saved copy could not be read: never overwrite it with an empty one
let lastSavedAt = null, lastError = null, dirty = false, timer = null, saving = null, getDb = null;

async function turso() {
  if (!client) {
    const { createClient } = await import('@libsql/client');
    // libsql://<db>.turso.io → https:// (plain HTTPS requests)
    client = createClient({ url: URL.replace(/^libsql:\/\//, 'https://'), authToken: TOKEN || undefined });
    await client.execute(`CREATE TABLE IF NOT EXISTS jobtrail_snapshot (
      seq INTEGER PRIMARY KEY, saved_at TEXT NOT NULL, total_bytes INTEGER NOT NULL, data BLOB NOT NULL)`);
  }
  return client;
}

/** Before the database is opened: write the saved copy to `file`. Returns 'off' | 'empty' | 'restored' | 'failed'. */
export async function restore(file) {
  if (!backupEnabled) return 'off';
  try {
    const r = await (await turso()).execute('SELECT seq, saved_at, total_bytes, data FROM jobtrail_snapshot ORDER BY seq');
    if (!r.rows.length) return 'empty';
    const bytes = Buffer.concat(r.rows.map(x => Buffer.from(x.data)));
    if (bytes.length !== Number(r.rows[0].total_bytes)) throw new Error('the saved copy is incomplete');
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    lastSavedAt = r.rows[0].saved_at;
    return 'restored';
  } catch (e) {
    savingAllowed = false;
    lastError = e.message;
    console.error('⚠ Could not load the saved database from Turso, so saving is switched off for this run:', e.message);
    return 'failed';
  }
}

/** Called once the database is open. */
export function attach(fnGetDb) {
  getDb = fnGetDb;
  if (backupEnabled) setInterval(() => { if (dirty) save().catch(() => {}); }, 60_000).unref();
}

/** Something changed: upload a copy in a few seconds. */
export function markDirty() {
  if (!backupEnabled || !savingAllowed) return;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => save().catch(() => {}), 3000);
  timer.unref?.();
}

/** Upload a consistent copy now (VACUUM INTO makes a clean single-file copy of the live database). */
export async function save() {
  if (!backupEnabled || !savingAllowed || !getDb) return;
  if (saving) await saving.catch(() => {});
  if (!dirty && lastSavedAt) return;
  saving = (async () => {
    dirty = false;
    const tmp = path.join(os.tmpdir(), `jobtrail-copy-${process.pid}.db`);
    fs.rmSync(tmp, { force: true });
    getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const bytes = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
    const at = new Date().toISOString();
    const stmts = [{ sql: 'DELETE FROM jobtrail_snapshot' }];
    for (let i = 0, seq = 0; i < bytes.length; i += CHUNK, seq++) {
      stmts.push({ sql: 'INSERT INTO jobtrail_snapshot (seq, saved_at, total_bytes, data) VALUES (?,?,?,?)',
                   args: [seq, at, bytes.length, new Uint8Array(bytes.subarray(i, i + CHUNK))] });
    }
    await (await turso()).batch(stmts, 'write');       // one transaction: the old copy is replaced only if the new one is complete
    lastSavedAt = at;
    lastError = null;
  })();
  try { await saving; }
  catch (e) { dirty = true; lastError = e.message; console.error('Saving to Turso failed (will retry):', e.message); throw e; }
  finally { saving = null; }
}

export const backupStatus = () => ({ enabled: backupEnabled, saving: backupEnabled && savingAllowed, last_saved_at: lastSavedAt, last_error: lastError });

// Render stops the app with SIGTERM (deploys, sleeping): save first.
if (backupEnabled) {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      try { if (dirty) await save(); } catch { /* already logged */ }
      process.exit(0);
    });
  }
}
