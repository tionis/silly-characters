import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { logger } from "../lib/logger";

const dbPath = resolve(process.cwd(), "data", "characters.db");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

function addColumnIfMissing(tableName: string, columnDef: string): void {
  try {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("duplicate column name")) {
      return;
    }
    throw error;
  }
}

function initializeSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS nextcloud_connections (
      user_id TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'app_password',
      app_password_enc TEXT NOT NULL DEFAULT '',
      access_token_enc TEXT,
      refresh_token_enc TEXT,
      token_expires_at INTEGER,
      nextcloud_user_id TEXT,
      scope TEXT,
      remote_folder TEXT NOT NULL,
      last_sync_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cards_cache (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      name TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      etag TEXT,
      content_length INTEGER,
      last_modified TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, remote_path),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cards_cache_user_id ON cards_cache(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_cache_updated_at ON cards_cache(updated_at);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
  `);

  addColumnIfMissing("nextcloud_connections", "auth_type TEXT NOT NULL DEFAULT 'app_password'");
  addColumnIfMissing("nextcloud_connections", "access_token_enc TEXT");
  addColumnIfMissing("nextcloud_connections", "refresh_token_enc TEXT");
  addColumnIfMissing("nextcloud_connections", "token_expires_at INTEGER");
  addColumnIfMissing("nextcloud_connections", "nextcloud_user_id TEXT");
  addColumnIfMissing("nextcloud_connections", "scope TEXT");

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nextcloud_connections_auth_type
    ON nextcloud_connections(auth_type)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_nextcloud_connections_nextcloud_user
    ON nextcloud_connections(nextcloud_user_id)
  `);
}

initializeSchema();
logger.info("SQLite initialized", { dbPath });

export { db };
