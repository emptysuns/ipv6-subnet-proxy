import { FastifyInstance } from 'fastify';
import { queryAuditLogs, AuditQuery } from '../../core/audit';

export function registerAuditRoutes(app: FastifyInstance): void {
  app.get('/audit-logs', async (request) => {
    const q = (request.query || {}) as any;
    const params: AuditQuery = {};
    if (q.user_id) params.user_id = q.user_id;
    if (q.action) params.action = q.action;
    if (q.start) params.start = q.start;
    if (q.end) params.end = q.end;
    if (q.limit) params.limit = parseInt(q.limit, 10);
    if (q.offset) params.offset = parseInt(q.offset, 10);
    return queryAuditLogs(params);
  });
}
