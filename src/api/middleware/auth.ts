import { FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig } from '../../config';
import { getLogger } from '../../utils/logger';

export async function apiKeyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = loadConfig();
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey || apiKey !== config.apiKey) {
    getLogger().warn({ ip: request.ip }, 'Unauthorized API request');
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing X-API-Key header' });
  }
}
