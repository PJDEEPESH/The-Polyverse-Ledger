// src/routes/transaction.ts
import { FastifyInstance } from 'fastify';
import { transactionLimitHook } from '../middleware/transactionLimit.js';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID } from '../utils/ubid.js';

export async function transactionRoutes(fastify: FastifyInstance) {
  
  // Create transaction with limit checking
  fastify.post('/', {
    preHandler: [transactionLimitHook]
  }, async (request, reply) => {
    try {
      const body = request.body as {
        walletAddress: string;
        blockchainId: string;
        amount: number;
        type: string;
        hash: string;
        riskScore?: number;
      };

      // Get user
      const { data: user, error: userError } = await supabase
        .from('User')
        .select('id')
        .eq('walletAddress', body.walletAddress)
        .eq('blockchainId', body.blockchainId)
        .single();

      if (userError || !user) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found' 
        });
      }

      // Generate proper UUID
      const transactionId = generateUUID();

      // Create transaction with proper ID
      const { data: transaction, error } = await supabase
        .from('Transaction')
        .insert({
          id: transactionId,
          userId: user.id,
          amount: body.amount,
          type: body.type,
          status: 'completed',
          hash: body.hash,
          riskScore: body.riskScore || 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return reply.send({
        success: true,
        data: transaction
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to create transaction',
        details: error instanceof Error ? error.message : JSON.stringify(error)
      });
    }
  });

  // Get transaction limits
  fastify.get('/limits/:walletAddress/:blockchainId', async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as {
        walletAddress: string;
        blockchainId: string;
      };

      const now = new Date();
      const currentMonth = now.getUTCMonth() + 1;
      const currentYear = now.getUTCFullYear();

      // Get user with plan info
      const { data: user, error: userError } = await supabase
        .from('User')
        .select(`
          id, planId, orgId, trialStartDate, trialUsed,
          Plan (id, name, txnLimit, userLimit)
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .single();

      if (userError || !user) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found',
          details: userError?.message
        });
      }

      // Get effective plan
      let effectivePlan = null;
      let planSource = 'free';

      if (user.planId && user.Plan) {
        const individualPlan = Array.isArray(user.Plan) ? user.Plan[0] : user.Plan;
        effectivePlan = individualPlan;
        planSource = 'individual';
      }

      if (!effectivePlan) {
        // Get Free plan from database
        const { data: freePlan } = await supabase
          .from('Plan')
          .select('id, name, txnLimit, userLimit')
          .eq('name', 'Free')
          .single();
        
        effectivePlan = freePlan || {
          name: 'Free',
          txnLimit: 5000,
          userLimit: 1
        };
      }

      // Calculate current volume for this month
      const startOfMonth = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-01T00:00:00.000Z`;
      const startOfNextMonth = currentMonth === 12 
        ? `${currentYear + 1}-01-01T00:00:00.000Z`
        : `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-01T00:00:00.000Z`;

      const { data: transactions, error: txError } = await supabase
        .from('Transaction')
        .select('amount')
        .eq('userId', user.id)
        .gte('createdAt', startOfMonth)
        .lt('createdAt', startOfNextMonth);

      if (txError) {
        throw txError;
      }

      const currentVolume = transactions?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;

      const response = {
        success: true,
        data: {
          currentVolume,
          limit: effectivePlan.txnLimit,
          remaining: effectivePlan.txnLimit ? Math.max(0, effectivePlan.txnLimit - currentVolume) : null,
          plan: effectivePlan.name,
          planSource,
          currency: 'USD',
          period: 'monthly',
          resetDate: startOfNextMonth
        }
      };

      return reply.send(response);

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch transaction limits',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Alternative endpoint with query parameters
  fastify.get('/limits', async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.query as {
        walletAddress: string;
        blockchainId: string;
      };

      if (!walletAddress || !blockchainId) {
        return reply.status(400).send({
          success: false,
          error: 'walletAddress and blockchainId are required'
        });
      }

      // Redirect to the main limits endpoint logic
      request.params = { walletAddress, blockchainId };
      return fastify.inject({
        method: 'GET',
        url: `/limits/${walletAddress}/${blockchainId}`,
        headers: request.headers
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch transaction limits'
      });
    }
  });

  // Get user transactions
  fastify.get('/user/:walletAddress/:blockchainId', async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as {
        walletAddress: string;
        blockchainId: string;
      };

      // Get user
      const { data: user, error: userError } = await supabase
        .from('User')
        .select('id')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .single();

      if (userError || !user) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found' 
        });
      }

      // Get transactions
      const { data: transactions, error } = await supabase
        .from('Transaction')
        .select('*')
        .eq('userId', user.id)
        .order('createdAt', { ascending: false })
        .limit(50);

      if (error) throw error;

      return reply.send({
        success: true,
        data: transactions || [],
        count: transactions?.length || 0
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch transactions'
      });
    }
  });

  // Get transaction by ID
  fastify.get('/:transactionId', async (request, reply) => {
    try {
      const { transactionId } = request.params as { transactionId: string };

      const { data: transaction, error } = await supabase
        .from('Transaction')
        .select('*')
        .eq('id', transactionId)
        .single();

      if (error || !transaction) {
        return reply.status(404).send({
          success: false,
          error: 'Transaction not found'
        });
      }

      return reply.send({
        success: true,
        data: transaction
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch transaction'
      });
    }
  });
}
