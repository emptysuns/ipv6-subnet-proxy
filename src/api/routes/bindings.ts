import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../database/connection';
import { getUser } from '../../core/users';
import { getSubnet } from '../../core/subnets';
import { logAction } from '../../core/audit';
import { refreshStickyBinding } from '../../core/ip-allocator';

export function registerBindingRoutes(app: FastifyInstance): void {
  app.post('/users/:id/bindings', async (request, reply) => {
    const { id: userId } = request.params as any;
    const { subnet_id } = request.body as any;

    if (!subnet_id) {
      return reply.code(400).send({ error: 'BadRequest', message: 'subnet_id is required' });
    }
    if (!getUser(userId)) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });
    if (!getSubnet(subnet_id)) return reply.code(404).send({ error: 'NotFound', message: 'Subnet not found' });

    const db = getDb();
    try {
      const id = uuidv4();
      db.prepare('INSERT INTO user_subnet_bindings (id, user_id, subnet_id) VALUES (?, ?, ?)')
        .run(id, userId, subnet_id);
      logAction('binding.created', { userId, subnetId: subnet_id }, userId);
      reply.code(201).send({ id, user_id: userId, subnet_id });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.code(409).send({ error: 'Conflict', message: 'Binding already exists' });
      }
      throw err;
    }
  });

  app.get('/users/:id/bindings', async (request, reply) => {
    const { id: userId } = request.params as any;
    if (!getUser(userId)) return reply.code(404).send({ error: 'NotFound', message: 'User not found' });

    const db = getDb();
    return db.prepare(
      `SELECT usb.id, usb.user_id, usb.subnet_id, s.cidr
       FROM user_subnet_bindings usb JOIN subnets s ON usb.subnet_id = s.id WHERE usb.user_id = ?`
    ).all(userId);
  });

  app.delete('/users/:id/bindings/:bindingId', async (request, reply) => {
    const { id: userId, bindingId } = request.params as any;
    const db = getDb();
    const binding = db.prepare(
      'SELECT id, subnet_id FROM user_subnet_bindings WHERE id = ? AND user_id = ?'
    ).get(bindingId, userId) as any;

    if (!binding) return reply.code(404).send({ error: 'NotFound', message: 'Binding not found' });

    db.prepare('DELETE FROM user_subnet_bindings WHERE id = ?').run(bindingId);
    refreshStickyBinding(userId, binding.subnet_id);
    logAction('binding.deleted', { bindingId }, userId);
    reply.code(204).send();
  });
}
