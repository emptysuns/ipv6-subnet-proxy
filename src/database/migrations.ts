import Database from 'better-sqlite3';
import { getLogger } from '../utils/logger';

export function runMigrations(db: Database.Database): void {
  const log = getLogger();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      mode       TEXT NOT NULL DEFAULT 'sticky',
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subnets (
      id         TEXT PRIMARY KEY,
      cidr       TEXT NOT NULL UNIQUE,
      gateway    TEXT,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_subnet_bindings (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      subnet_id TEXT NOT NULL,
      UNIQUE(user_id, subnet_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (subnet_id) REFERENCES subnets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sticky_bindings (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      subnet_id  TEXT NOT NULL,
      ipv6_addr  TEXT NOT NULL,
      bound_at   TEXT NOT NULL,
      UNIQUE(user_id, subnet_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (subnet_id) REFERENCES subnets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS traffic_stats (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      date      TEXT NOT NULL,
      bytes_in  INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      actor      TEXT,
      action     TEXT NOT NULL,
      detail     TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL UNIQUE,
      max_connections INTEGER,
      max_bandwidth   INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_traffic_stats_date ON traffic_stats(date);
    CREATE INDEX IF NOT EXISTS idx_sticky_bindings_user ON sticky_bindings(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_subnet_bindings_user ON user_subnet_bindings(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_subnet_bindings_subnet ON user_subnet_bindings(subnet_id);
  `);

  log.info('Database migrations completed successfully');
}
