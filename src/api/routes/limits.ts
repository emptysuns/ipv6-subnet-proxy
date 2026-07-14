import { FastifyInstance } from 'fastify';
import { getRateLimitRules, setRateLimitRules, getCurrentConnections } from '../../core/rate-limiter';
import { getUser } from '../../core/users';
import { logAction } from '../../core/audit';

export function registerLimitRoutes(app: FastifyInstance): void {
  app.get('/users/:id/limits', async (request, reply) => {
    const { id } = request.params as any;
    if (!getUser(id)) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });
    const rules = getRateLimitRules(id);
    return { ...rules, current_connections: getCurrentConnections(id) };
  });

  app.put('/users/:id/limits', async (request, reply) => {
    const { id } = request.params as any;
    const { max_connections, max_bandwidth } = request.body as any;
    if (!getUser(id)) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });
    const rules = setRateLimitRules(id, {
      max_connections: max_connections ?? null,
      max_bandwidth: max_bandwidth ?? null,
    });
    logAction('rate_limits.updated', { max_connections, max_bandwidth }, id);
    return rules;
  });
}
