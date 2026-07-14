import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/connection';
import { getLogger } from '../utils/logger';

export interface AuditEntry {
  id: string;
  user_id: string | null;
  actor: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export interface AuditQuery {
  user_id?: string;
  action?: string;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}

export function logAction(
  action: string,
  detail?: Record<string, any>,
  userId?: string,
  actor?: string
): void {
  const db = getDb();
  const detailStr = detail ? JSON.stringify(detail) : null;
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO audit_logs (id, user_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), userId || null, actor || 'system', action, detailStr, now);
}

export function queryAuditLogs(query: AuditQuery): AuditEntry[] {
  const db = getDb();
  let sql = 'SELECT id, user_id, actor, action, detail, created_at FROM audit_logs WHERE 1=1';
  const params: any[] = [];

  if (query.user_id) { sql += ' AND user_id = ?'; params.push(query.user_id); }
  if (query.action) { sql += ' AND action = ?'; params.push(query.action); }
  if (query.start) { sql += ' AND created_at >= ?'; params.push(query.start); }
  if (query.end) { sql += ' AND created_at <= ?'; params.push(query.end); }

  sql += ' ORDER BY created_at DESC';

  if (query.limit) { sql += ' LIMIT ?'; params.push(query.limit); }
  if (query.offset) { sql += ' OFFSET ?'; params.push(query.offset); }

  return db.prepare(sql).all(...params) as AuditEntry[];
}
