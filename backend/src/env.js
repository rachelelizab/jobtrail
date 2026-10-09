// Load backend/.env (Google keys etc.) if it exists. Must be imported before anything else.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
if (fs.existsSync(file)) process.loadEnvFile(file);
