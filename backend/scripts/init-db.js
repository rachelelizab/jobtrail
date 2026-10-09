// Rebuild the SQLite database from database/schema.sql (+ seed.sql).
//   npm run db:reset          -> fresh database with sample data
//   npm run db:reset:empty    -> fresh, empty database
// The backend also does this automatically the first time it starts.
import { createDatabase, DB_FILE } from '../src/db.js';

const seed = !process.argv.includes('--no-seed');
createDatabase({ seed });
console.log(`✔ ${DB_FILE} rebuilt${seed ? ' with sample data' : ' (empty)'}.`);
process.exit(0);
