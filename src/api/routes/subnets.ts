import { FastifyInstance } from 'fastify';
import { addSubnet, getSubnet, listSubnets, removeSubnet, checkSubnetHealth } from '../../core/subnets';
import { logAction } from '../../core/audit';

export function registerSubnetRoutes(app: FastifyInstance): void {
  app.post('/subnets', async (request, reply) => {
    const { cidr, gateway } = request.body as any;
    if (!cidr) {
      return reply.code(400).send({ error: 'BadRequest', message: 'cidr is required' });
    }
    try {
      const subnet = addSubnet(cidr, gateway);
      logAction('subnet.created', { cidr, gateway });
      reply.code(201).send(subnet);
    } catch (err: any) {
      if (err.message?.includes('Invalid')) {
        return reply.code(400).send({ error: 'BadRequest', message: err.message });
      }
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.code(409).send({ error: 'Conflict', message: 'Subnet CIDR already exists' });
      }
      throw err;
    }
  });

  app.get('/subnets', async () => listSubnets());

  app.get('/subnets/:id', async (request, reply) => {
    const { id } = request.params as any;
    const subnet = getSubnet(id);
    if (!subnet) return reply.code(404).send({ error: 'NotFound', message: 'Subnet not found' });
    return subnet;
  });

  app.delete('/subnets/:id', async (request, reply) => {
    const { id } = request.params as any;
    const subnet = getSubnet(id);
    if (!subnet) return reply.code(404).send({ error: 'NotFound', message: 'Subnet not found' });
    removeSubnet(id);
    logAction('subnet.deleted', { cidr: subnet.cidr });
    reply.code(204).send();
  });

  app.post('/subnets/:id/health', async (request) => {
    const { id } = request.params as any;
    return await checkSubnetHealth(id);
  });
}
