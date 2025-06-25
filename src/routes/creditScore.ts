import { FastifyInstance } from 'fastify';
import { CreditScoreService } from '../services/creditScore.js';

export async function creditScoreRoutes(fastify: FastifyInstance) {
  fastify.get('/:userId', {
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const score = await CreditScoreService.calculateScore(userId);
    return { userId, score };
  });
}