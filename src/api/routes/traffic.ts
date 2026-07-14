import { FastifyInstance } from 'fastify';
import { getTrafficStats, TrafficQuery } from '../../core/traffic';

export function registerTrafficRoutes(app: FastifyInstance): void {
  app.get('/traffic', async (request) => {
    const q = (request.query || {}) as any;
    const params: TrafficQuery = {};
    if (q.user_id) params.user_id = q.user_id;
    if (q.start) params.start = q.start;
    if (q.end) params.end = q.end;
    if (q.limit) params.limit = parseInt(q.limit, 10);
    if (q.offset) params.offset = parseInt(q.offset, 10);
    return getTrafficStats(params);
  });
}
