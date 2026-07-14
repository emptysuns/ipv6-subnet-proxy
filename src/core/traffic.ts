import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/connection';

export interface TrafficRow {
  id: string;
  user_id: string;
  date: string;
  bytes_in: number;
  bytes_out: number;
}

export interface TrafficQuery {
  user_id?: string;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}

export function recordBytes(userId: string, bytesIn: number, bytesOut: number): void {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const existing = db.prepare(
    'SELECT id FROM traffic_stats WHERE user_id = ? AND date = ?'
  ).get(userId, today) as any;

  if (existing) {
    db.prepare(
      'UPDATE traffic_stats SET bytes_in = bytes_in + ?, bytes_out = bytes_out + ? WHERE id = ?'
    ).run(bytesIn, bytesOut, existing.id);
  } else {
    db.prepare(
      'INSERT INTO traffic_stats (id, user_id, date, bytes_in, bytes_out) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, today, bytesIn, bytesOut);
  }
}

export function getTrafficStats(query: TrafficQuery): TrafficRow[] {
  const db = getDb();
  let sql = 'SELECT id, user_id, date, bytes_in, bytes_out FROM traffic_stats WHERE 1=1';
  const params: any[] = [];

  if (query.user_id) { sql += ' AND user_id = ?'; params.push(query.user_id); }
  if (query.start) { sql += ' AND date >= ?'; params.push(query.start); }
  if (query.end) { sql += ' AND date <= ?'; params.push(query.end); }

  sql += ' ORDER BY date DESC';

  if (query.limit) { sql += ' LIMIT ?'; params.push(query.limit); }
  if (query.offset) { sql += ' OFFSET ?'; params.push(query.offset); }

  return db.prepare(sql).all(...params) as TrafficRow[];
}
