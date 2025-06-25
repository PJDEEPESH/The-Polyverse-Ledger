import { FastifyInstance } from 'fastify';
import { InvoiceService } from '../services/invoice.js';
import { z } from 'zod';

const createInvoiceSchema = z.object({
  userId: z.string().uuid(),
  blockchainId: z.string().uuid(),
  amount: z.number().positive(),
  dueDate: z.string().transform(str => new Date(str))
});

export async function invoiceRoutes(fastify: FastifyInstance) {
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'blockchainId', 'amount', 'dueDate'],
        properties: {
          userId: { type: 'string' },
          blockchainId: { type: 'string' },
          amount: { type: 'number' },
          dueDate: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const data = createInvoiceSchema.parse(request.body);
    const invoice = await InvoiceService.create(data);
    return reply.code(201).send(invoice);
  });

  fastify.post('/:id/tokenize', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tokenizedInvoice = await InvoiceService.tokenize(id);
    return tokenizedInvoice;
  });
}