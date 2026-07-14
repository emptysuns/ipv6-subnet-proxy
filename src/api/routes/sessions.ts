import { FastifyInstance } from 'fastify';
import { getActiveSessions, forceDisconnect } from '../../core/sessions';

export function registerSessionRoutes(app: FastifyInstance): void {
  app.get('/sessions', async (request) => {
    const sessions = getActiveSessions();
    const { user_id } = (request.query || {}) as any;
    const filtered = user_id ? sessions.filter(s => s.userId === user_id) : sessions;
    return filtered.map(s => ({
      id: s.id, userId: s.userId, ipv6Addr: s.ipv6Addr, connectedAt: s.connectedAt,
    }));
  });

  app.delete('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as any;
    const ok = forceDisconnect(sessionId);
    if (!ok) return reply.code(404).send({ error: 'NotFound', message: 'Session not found' });
    return { success: true };
  });
}
