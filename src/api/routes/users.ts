import { FastifyInstance } from 'fastify';
import {
  createUser, getUser, listUsers, updateUser, deleteUser,
} from '../../core/users';
import { refreshStickyBinding, getCurrentStickyAddress } from '../../core/ip-allocator';
import { logAction } from '../../core/audit';
import { getDb } from '../../database/connection';

export function registerUserRoutes(app: FastifyInstance): void {
  app.post('/users', async (request, reply) => {
    const { username, password, mode } = request.body as any;
    if (!username || !password) {
      return reply.code(400).send({ error: 'BadRequest', message: 'username and password are required' });
    }
    try {
      const user = createUser({ username, password, mode });
      logAction('user.created', { username, mode }, user.id);
      reply.code(201).send(user);
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.code(409).send({ error: 'Conflict', message: 'Username already exists' });
      }
      throw err;
    }
  });

  app.get('/users', async () => listUsers());

  app.get('/users/:id', async (request, reply) => {
    const { id } = request.params as any;
    const user = getUser(id);
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });
    return user;
  });

  app.patch('/users/:id', async (request, reply) => {
    const { id } = request.params as any;
    const input = request.body as any;
    try {
      const user = updateUser(id, { password: input.password, mode: input.mode, status: input.status });
      logAction('user.updated', input, id);
      return user;
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return reply.code(404).send({ error: 'NotFound', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as any;
    const user = getUser(id);
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });
    deleteUser(id);
    logAction('user.deleted', { username: user.username }, id);
    reply.code(204).send();
  });

  app.post('/users/:id/refresh', async (request, reply) => {
    const { id } = request.params as any;
    const user = getUser(id);
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });

    const db = getDb();
    const bindings = db.prepare(
      'SELECT subnet_id FROM user_subnet_bindings WHERE user_id = ?'
    ).all(id) as { subnet_id: string }[];
    for (const b of bindings) refreshStickyBinding(id, b.subnet_id);

    logAction('ip.refreshed', { subnetCount: bindings.length }, id);
    return { success: true, message: `Refreshed IPv6 address for ${bindings.length} subnet(s)` };
  });

  app.get('/users/:id/current-ip', async (request, reply) => {
    const { id } = request.params as any;
    const user = getUser(id);
    if (!user) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });
    return { userId: id, addresses: getCurrentStickyAddress(id) };
  });
}
