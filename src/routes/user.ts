// src/routes/user.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabaseClient.js';

const createUserSchema = z.object({
  blockchainId: z.string().uuid(),
  walletAddress: z.string()
});

export async function userRoutes(fastify: FastifyInstance) {
  // Create User
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['blockchainId', 'walletAddress'],
        properties: {
          blockchainId: { type: 'string' },
          walletAddress: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { blockchainId, walletAddress } = createUserSchema.parse(request.body);

    const { data, error } = await supabase
      .from('users')
      .insert([{ blockchain_id: blockchainId, wallet_address: walletAddress }])
      .select()
      .single();

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return reply.code(201).send(data);
  });

  // Get User by ID
  fastify.get('/:id', {
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

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        *,
        transactions (*),
        invoices (*)
      `)
      .eq('id', id)
      .single();

    if (error || !user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return user;
  });
}
