import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/connection';
import { getLogger } from '../utils/logger';

export interface RateLimitRules {
  max_connections: number | null;
  max_bandwidth: number | null;
}

export class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxBandwidthBytesPerSec: number) {
    this.maxTokens = maxBandwidthBytesPerSec;
    this.tokens = maxBandwidthBytesPerSec;
    this.refillRate = maxBandwidthBytesPerSec / 1000;
    this.lastRefill = Date.now();
  }

  consume(bytes: number): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    }
    this.lastRefill = now;

    if (this.tokens >= bytes) {
      this.tokens -= bytes;
      return true;
    }
    return false;
  }
}

export function getRateLimitRules(userId: string): RateLimitRules {
  const db = getDb();
  const row = db.prepare(
    'SELECT max_connections, max_bandwidth FROM rate_limits WHERE user_id = ?'
  ).get(userId) as any;

  return {
    max_connections: row?.max_connections ?? null,
    max_bandwidth: row?.max_bandwidth ?? null,
  };
}

export function setRateLimitRules(userId: string, rules: RateLimitRules): RateLimitRules {
  const db = getDb();
  const log = getLogger();
  const existing = db.prepare('SELECT id FROM rate_limits WHERE user_id = ?').get(userId) as any;

  if (existing) {
    db.prepare('UPDATE rate_limits SET max_connections = ?, max_bandwidth = ? WHERE user_id = ?')
      .run(rules.max_connections, rules.max_bandwidth, userId);
  } else {
    db.prepare(
      'INSERT INTO rate_limits (id, user_id, max_connections, max_bandwidth) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), userId, rules.max_connections, rules.max_bandwidth);
  }

  log.info({ userId, ...rules }, 'Rate limit rules updated');
  return rules;
}

export { getConnectionCount as getCurrentConnections } from './sessions';

// --- Per-user shared TokenBucket to enforce bandwidth across all connections ---

const userBuckets = new Map<string, TokenBucket>();

export function getOrCreateTokenBucket(userId: string, maxBandwidthBytesPerSec: number): TokenBucket {
  const existing = userBuckets.get(userId);
  if (existing) return existing;

  const bucket = new TokenBucket(maxBandwidthBytesPerSec);
  userBuckets.set(userId, bucket);
  return bucket;
}

/**
 * Remove a user's token bucket (e.g., when user is deleted or has no active connections).
 */
export function removeTokenBucket(userId: string): void {
  userBuckets.delete(userId);
}
