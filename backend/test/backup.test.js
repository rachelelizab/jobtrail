// The Turso copy survives a wiped disk (what Render's free plan does on every restart).
// A local file stands in for Turso here: the official client treats file: URLs like a remote database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrail-backup-'));
const local = path.join(dir, 'local.db');
const env = (extra = {}) => ({ ...process.env, DB_FILE: local, TURSO_DATABASE_URL: `file:${path.join(dir, 'turso.db')}`, ...extra });
const wipe = () => { for (const f of [local, `${local}-wal`, `${local}-shm`]) fs.rmSync(f, { force: true }); };
const node = (code, extra) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: backend, env: env(extra), encoding: 'utf8' }).trim();

test('a change is saved to Turso and comes back after the disk is wiped', () => {
  const out = node(`
    const db = await import('./src/db.js');
    const { save } = await import('./src/backup.js');
    db.run("UPDATE company SET city = 'Mysuru' WHERE company_id = 1");
    await save();
    console.log(db.restoredFrom);`);
  assert.equal(out.split('\n').pop(), 'empty', 'first start: nothing saved yet');
  wipe();
  const back = node(`
    const db = await import('./src/db.js');
    console.log(db.restoredFrom, db.q1('SELECT city FROM company WHERE company_id = 1').city);
    process.exit(0);`);
  assert.equal(back.split('\n').pop(), 'restored Mysuru');
});

test('a change made just before Render stops the app (SIGTERM) is saved too', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const db = await import('./src/db.js');
    db.run("UPDATE company SET city = 'Hubballi' WHERE company_id = 2");
    console.log('changed');
    setInterval(() => {}, 1000);`], { cwd: backend, env: env() });
  await new Promise(res => child.stdout.on('data', d => { if (String(d).includes('changed')) res(); }));
  child.kill('SIGTERM');
  await new Promise(res => child.on('exit', res));
  wipe();
  assert.equal(node(`const db = await import('./src/db.js'); console.log(db.q1('SELECT city FROM company WHERE company_id = 2').city); process.exit(0);`).split('\n').pop(), 'Hubballi');
});

test('if Turso cannot be reached at start, the saved copy is never overwritten', () => {
  wipe();
  const out = node(`
    const db = await import('./src/db.js');
    const { save, backupStatus } = await import('./src/backup.js');
    db.run("UPDATE company SET city = 'WRONG' WHERE company_id = 1");
    await save();
    console.log(db.restoredFrom, backupStatus().saving);
    process.exit(0);`, { TURSO_DATABASE_URL: 'https://127.0.0.1:9', TURSO_AUTH_TOKEN: 'x' });
  assert.equal(out.split('\n').pop(), 'failed false');
  wipe();
  assert.equal(node(`const db = await import('./src/db.js'); console.log(db.q1('SELECT city FROM company WHERE company_id = 1').city); process.exit(0);`).split('\n').pop(), 'Mysuru');
});
