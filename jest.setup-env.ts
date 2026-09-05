/**
 * Makes the workspace `.env` visible to Jest.
 *
 * Domain suites talk to a real PostgreSQL server, and the connection string
 * lives in `.env` like every other secret. Nest loads it at boot through
 * `@nestjs/config`; a test process has no boot, so it loads it here.
 *
 * Existing variables win, so CI can set `TEST_DATABASE_URL` without a local
 * `.env` quietly overriding it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(__dirname, '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    // Tolerate quoted values; anything outside the quotes is not ours.
    process.env[key] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
