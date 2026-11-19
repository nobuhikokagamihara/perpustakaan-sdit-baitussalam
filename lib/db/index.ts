import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './schema';
import { seedDatabase, seedReadingSchedules, seedClassRostersAndAttendance } from './seed';

declare global {
  var _libraryDb: Database.Database | undefined;
}

export function getDbPath(): string {
  const custom = process.env.LIBRARY_DB_PATH;
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
  }
  const isServerless =
    process.env.VERCEL === '1' ||
    process.env.NETLIFY === 'true' ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    return path.join(os.tmpdir(), 'lentera-pustaka', 'library.db');
  }
  return path.join(process.cwd(), 'data', 'library.db');
}

export function getDb(): Database.Database {
  if (!global._libraryDb) {
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    runMigrations(db);
    seedDatabase(db);
    seedReadingSchedules(db);
    seedClassRostersAndAttendance(db);

    global._libraryDb = db;
  }
  return global._libraryDb;
}

export function closeDb(): void {
  if (global._libraryDb) {
    global._libraryDb.close();
    global._libraryDb = undefined;
  }
}

export function getSettingsMap(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM library_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}
