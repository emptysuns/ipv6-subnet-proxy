import { FastifyInstance } from 'fastify';
import { getDb } from '../../database/connection';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => {
    return { status: 'ok', uptime: process.uptime() };
  });

  app.get('/health/ready', async () => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      return { status: 'ready', database: 'connected' };
    } catch (err: any) {
      return { status: 'not ready', database: err.message };
    }
  });
}
