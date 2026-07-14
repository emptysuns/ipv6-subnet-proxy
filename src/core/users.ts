import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { getDb } from '../database/connection';
import { loadConfig } from '../config';
import { getLogger } from '../utils/logger';
import { getActiveSessions, forceDisconnect } from './sessions';

export interface User {
  id: string;
  username: string;
  mode: 'sticky' | 'random';
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  mode?: 'sticky' | 'random';
}

export interface UpdateUserInput {
  password?: string;
  mode?: 'sticky' | 'random';
  status?: 'active' | 'disabled';
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    mode: row.mode,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createUser(input: CreateUserInput): User {
  const db = getDb();
  const config = loadConfig();
  const log = getLogger();

  const id = uuidv4();
  const now = new Date().toISOString();
  const hashedPassword = bcrypt.hashSync(input.password, config.bcryptRounds);
  const mode = input.mode || 'random';

  db.prepare(`
    INSERT INTO users (id, username, password, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(id, input.username, hashedPassword, mode, now, now);

  log.info({ userId: id, username: input.username }, 'User created');
  return { id, username: input.username, mode, status: 'active', created_at: now, updated_at: now };
}

export function verifyCredentials(username: string, password: string): User | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, username, password, mode, status, created_at, updated_at FROM users WHERE username = ?'
  ).get(username) as any;

  if (!row || row.status === 'disabled') return null;
  if (!bcrypt.compareSync(password, row.password)) return null;

  return rowToUser(row);
}

export function getUser(id: string): User | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, username, mode, status, created_at, updated_at FROM users WHERE id = ?'
  ).get(id) as any;
  return row ? rowToUser(row) : null;
}

export function listUsers(): User[] {
  const db = getDb();
  return (db.prepare(
    'SELECT id, username, mode, status, created_at, updated_at FROM users ORDER BY created_at DESC'
  ).all() as any[]).map(rowToUser);
}

export function updateUser(id: string, input: UpdateUserInput): User {
  const db = getDb();
  const log = getLogger();
  const now = new Date().toISOString();

  const user = getUser(id);
  if (!user) throw new Error(`User ${id} not found`);

  if (input.password !== undefined) {
    const config = loadConfig();
    const hashedPassword = bcrypt.hashSync(input.password, config.bcryptRounds);
    db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?')
      .run(hashedPassword, now, id);
    log.info({ userId: id }, 'Password updated');
  }
  if (input.mode !== undefined) {
    db.prepare('UPDATE users SET mode = ?, updated_at = ? WHERE id = ?')
      .run(input.mode, now, id);
    log.info({ userId: id, mode: input.mode }, 'User mode updated');
  }
  if (input.status !== undefined) {
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
      .run(input.status, now, id);
    log.info({ userId: id, status: input.status }, 'User status updated');
  }

  return getUser(id)!;
}

export function enableUser(id: string): User {
  return updateUser(id, { status: 'active' });
}

export function disableUser(id: string): User {
  return updateUser(id, { status: 'disabled' });
}

export function deleteUser(id: string): void {
  const db = getDb();
  const log = getLogger();

  // Disconnect all active sessions for this user
  const sessions = getActiveSessions().filter(s => s.userId === id);
  for (const s of sessions) {
    forceDisconnect(s.id);
  }
  log.info({ userId: id, disconnectedSessions: sessions.length }, 'Disconnected active sessions for deleted user');

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  log.info({ userId: id }, 'User deleted');
}
