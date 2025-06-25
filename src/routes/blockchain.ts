import { FastifyInstance } from 'fastify';
import { BlockchainService } from '../services/blockchain.js';
import { z } from 'zod';
import User from '../models/User.js';
const registerBlockchainSchema = z.object({
  name: z.string().min(1)
});

export async function blockchainRoutes(fastify: FastifyInstance) {
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { name } = registerBlockchainSchema.parse(request.body);
    const blockchain = await BlockchainService.register(name);
    return reply.code(201).send(blockchain);
  });

  fastify.get('/verify', {
    schema: {
      querystring: {
        type: 'object',
        required: ['apiKey'],
        properties: {
          apiKey: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { apiKey } = request.query as { apiKey: string };
    const isValid = await BlockchainService.verifyApiKey(apiKey);
    return { valid: isValid };
  });
}