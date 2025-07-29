// src/routes/transaction.ts
import { FastifyInstance } from 'fastify';
import { transactionLimitHook } from '../middleware/transactionLimit.js';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID } from '../utils/ubid.js';
export async function transactionRoutes(fastify: FastifyInstance) {
  
  // Create transaction with limit checking
  fastify.post('/api/v1/transaction', {
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
    const transactionId = generateUUID(); // Make sure this function works
    console.log('Generated transaction ID:', transactionId); // Debug log

    // Create transaction with proper ID
    const { data: transaction, error } = await supabase
      .from('Transaction')
      .insert({
        id: transactionId, // ✅ Ensure this is not null
        userId: user.id,
        amount: body.amount,
        type: body.type,
        status: 'completed', // ✅ Changed from 'pending'
        hash: body.hash,
        riskScore: body.riskScore || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Database insert error:', error);
      throw error;
    }

    return reply.send({
      success: true,
      data: transaction
    });

  } catch (error) {
    console.error('Transaction creation error:', error);
    return reply.status(500).send({
      success: false,
      error: 'Failed to create transaction',
      details: error instanceof Error ? error.message : JSON.stringify(error)
    });
  }
});

  // Get transaction limits for user
fastify.get('/api/v1/transaction/limits/:walletAddress/:blockchainId', async (request, reply) => {
  try {
    const { walletAddress, blockchainId } = request.params as {
      walletAddress: string;
      blockchainId: string;
    };

    // DON'T use middleware here - calculate limits directly
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
        error: 'User not found' 
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
        txnLimit: 5000, // Your Free plan should have 5000, not null
        userLimit: 1
      };
    }

    // Calculate current volume
    const { data: transactions, error: txError } = await supabase
      .from('Transaction')
      .select('amount')
      .eq('userId', user.id)
      .gte('createdAt', `${currentYear}-${currentMonth.toString().padStart(2, '0')}-01`)
      .lt('createdAt', currentMonth === 12 ? `${currentYear + 1}-01-01` : `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-01`);

    if (txError) throw txError;

    const currentVolume = transactions?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;

    return reply.send({
      success: true,
      data: {
        currentVolume,
        limit: effectivePlan.txnLimit,
        remaining: effectivePlan.txnLimit ? Math.max(0, effectivePlan.txnLimit - currentVolume) : null,
        plan: effectivePlan.name,
        planSource,
      }
    });

  } catch (error) {
    console.error('Transaction limits fetch error:', error);
    return reply.status(500).send({
      success: false,
      error: 'Failed to fetch transaction limits',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

}
