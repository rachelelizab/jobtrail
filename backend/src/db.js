// SQLite access layer — uses node:sqlite, which ships with Node.js 22.13+ (no install needed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite still prints an "experimental" notice on some Node versions; hide just that one line.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
const { DatabaseSync } = await import('node:sqlite');
import { restore, attach, markDirty, backupStatus } from './backup.js';
export { backupStatus };

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_DIR = path.resolve(here, '../../database');
export const DB_FILE = process.env.DB_FILE || path.join(DB_DIR, 'jobtrail.db');
export const SCHEMA_FILE = path.join(DB_DIR, 'schema.sql');
export const SEED_FILE = path.join(DB_DIR, 'seed.sql');
export const GMAIL_FILE = path.join(DB_DIR, 'gmail.sql');

/** Create the database file from schema.sql (+ seed.sql). Deletes any existing file. */
export function createDatabase({ seed = true } = {}) {
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) fs.rmSync(f, { force: true });
  const d = new DatabaseSync(DB_FILE);
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  if (seed) d.exec(fs.readFileSync(SEED_FILE, 'utf8'));
  d.close();
}

// On Render the disk is wiped on every restart: first bring back the copy saved in Turso (if set up).
export const restoredFrom = await restore(DB_FILE);
const isNew = !fs.existsSync(DB_FILE);
if (isNew) createDatabase({ seed: true });

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

// Gmail-import tables + application.source column (safe to run on every start).
if (!db.prepare("SELECT 1 FROM pragma_table_info('application') WHERE name = 'source'").get()) {
  db.exec("ALTER TABLE application ADD COLUMN source TEXT NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual','Gmail'))");
}
// Owner of each application / recruiter (NULL = shared demo data shown when nobody is signed in)
for (const t of ['application', 'contact']) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name = 'user_id'`).get()) {
    db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER REFERENCES app_user(user_id) ON DELETE CASCADE`);
  }
}
// email_import gained new kinds ('test', 'offer') and an event_id column. SQLite cannot change a CHECK
// constraint in place, so an older table is renamed, re-created by gmail.sql, and its rows copied across.
const oldImport = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'email_import'").get();
const migrateImport = Boolean(oldImport && !oldImport.sql.includes("'offer'"));
if (migrateImport) {
  db.exec(`PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;
           DROP VIEW IF EXISTS v_followups_due; DROP VIEW IF EXISTS v_application_overview;
           ALTER TABLE email_import RENAME TO email_import_old;
           PRAGMA legacy_alter_table = OFF;`);
}
db.exec(fs.readFileSync(GMAIL_FILE, 'utf8'));
if (migrateImport) {
  const cols = 'message_id, user_id, received_at, sender, subject, snippet, platform, kind, company, role, location, job_url, status, app_id, processed_at';
  db.exec(`INSERT INTO email_import (${cols}) SELECT ${cols} FROM email_import_old; DROP TABLE email_import_old; PRAGMA foreign_keys = ON;`);
}

// Sample tests / interviews for the shared demo data (added once, so deleting them keeps them deleted).
db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
if (!db.prepare("SELECT 1 FROM app_meta WHERE key = 'sample_events'").get()) {
  const demo = id => db.prepare('SELECT 1 FROM application WHERE app_id = ? AND user_id IS NULL').get(id);
  if (demo(1) && demo(3) && demo(8)) {
    db.exec(`
      INSERT INTO interview_event (app_id, event_type, round_name, scheduled_at, has_time, due_by, mode, meeting_link, location, contact_id, source)
      VALUES (8, 'Test', 'Round 1 – SQL take-home test', NULL, 0, datetime(date('now','localtime','+2 day'), '+23 hours', '+59 minutes'),
              'Online', 'https://www.hackerrank.com/test/sample-demo', NULL, (SELECT contact_id FROM contact WHERE full_name = 'Neha Kulkarni'), 'Manual'),
             (1, 'Interview', 'Round 2 – Case study interview', datetime(date('now','localtime','+3 day'), '+15 hours', '+30 minutes'), 1, NULL,
              'Online', 'https://meet.google.com/abc-defg-hij', NULL, (SELECT contact_id FROM contact WHERE full_name = 'Priya Raman'), 'Manual'),
             (3, 'Interview', 'Round 1 – Technical', datetime(date('now','localtime','+6 day'), '+11 hours'), 1, NULL,
              'In person', NULL, 'HSR Layout, Sector 2, Bengaluru', (SELECT contact_id FROM contact WHERE full_name = 'Arjun Mehta'), 'Manual');`);
  }
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('sample_events', datetime('now'))").run();
}
export const createdNow = isNew;
attach(() => db);
markDirty();          // save the (possibly upgraded) database once at start

/** Read-only connection for the SQL console — any write attempt fails at the engine level. */
export const dbReadOnly = new DatabaseSync(DB_FILE, { readOnly: true });

// node:sqlite cannot bind undefined or booleans
const norm = params => params.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
const plain = row => (row ? { ...row } : row);

/** All rows. */
export const q = (sql, params = []) => db.prepare(sql).all(...norm(params)).map(plain);
/** First row or undefined. */
export const q1 = (sql, params = []) => plain(db.prepare(sql).get(...norm(params)));
/** INSERT / UPDATE / DELETE → { changes, lastInsertRowid } */
export const run = (sql, params = []) => {
  const r = db.prepare(sql).run(...norm(params));
  if (Number(r.changes)) markDirty();
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
};

/** Run fn() inside a transaction; rolls back if it throws. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    markDirty();
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
