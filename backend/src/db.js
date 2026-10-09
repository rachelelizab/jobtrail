// SQLite access layer — uses node:sqlite, which ships with Node.js 22.13+ (no install needed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite still prints an "experimental" notice on some Node versions; hide just that one line.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
const { DatabaseSync } = await import('node:sqlite');

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

const isNew = !fs.existsSync(DB_FILE);
if (isNew) createDatabase({ seed: true });

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

// Gmail-import tables + application.source column (safe to run on every start).
if (!db.prepare("SELECT 1 FROM pragma_table_info('application') WHERE name = 'source'").get()) {
  db.exec("ALTER TABLE application ADD COLUMN source TEXT NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual','Gmail'))");
}
db.exec(fs.readFileSync(GMAIL_FILE, 'utf8'));
export const createdNow = isNew;

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
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
};

/** Run fn() inside a transaction; rolls back if it throws. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
