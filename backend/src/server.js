import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { createdNow, DB_FILE, q1, restoredFrom } from './db.js';
import applications from './routes/applications.js';
import misc from './routes/misc.js';
import gmail, { startAutoSync } from './routes/gmail.js';
import events from './routes/events.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api', misc);
app.use('/api', gmail);
app.use('/api', events);
app.use('/api', applications);
app.use('/api', (_req, res) => res.status(404).json({ error: 'No such API route.' }));

// In production, serve the built React app (frontend/dist) from this same server.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Turn database errors into readable messages for the UI.
// Express 5 forwards errors thrown in route handlers here automatically.
app.use((err, _req, res, _next) => {
  const msg = String(err.message || err);
  const friendly = [
    [/CHECK constraint failed/i, 'A value is not allowed by a CHECK constraint: '],
    [/UNIQUE constraint failed/i, 'That already exists: '],
    [/FOREIGN KEY constraint failed/i, 'A referenced record does not exist (foreign key): '],
    [/NOT NULL constraint failed/i, 'A required value is missing: '],
    [/append-only/i, ''],
  ].find(([re]) => re.test(msg));
  const status = err.status || (friendly ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: friendly ? friendly[1] + msg : msg });
});

const port = Number(process.env.PORT || 5050);
startAutoSync();
app.listen(port, () => {
  const { n } = q1('SELECT COUNT(*) AS n FROM application');
  console.log(`JobTrail API on http://localhost:${port}/api`);
  if (restoredFrom !== 'off') console.log(`Turso copy: ${{ restored: 'loaded the saved database', empty: 'no saved copy yet — saving this one', failed: 'COULD NOT LOAD — saving is off for this run' }[restoredFrom]}`);
  console.log(`SQLite database: ${DB_FILE}${createdNow ? ' (just created with sample data)' : ''} — ${n} applications`);
});
