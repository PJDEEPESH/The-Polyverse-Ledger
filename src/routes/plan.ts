//src/routes/plan.ts
import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';
import { isTrialActive } from '../utils/isTrialActive.js';

// Type definitions for better type safety
interface PlanData {
  name: string;
  queryLimit: number;
  userLimit: number;
}

interface UserData {
  id: string;
  planId: string | null;
  orgId: string | null;
  trialStartDate: string | null;
  trialUsed: boolean;
  plan: PlanData[] | null;
}

interface OrgData {
  planId: string | null;
  plan: PlanData[] | null;
}

export async function planRoutes(fastify: FastifyInstance) {
  // // Get all plans
  // fastify.get('/api/v1/plans', async (request, reply) => {
  //   try {
  //     const { data: plans, error } = await supabase
  //       .from('Plan')
  //       .select('*')
  //       .order('createdAt', { ascending: false });

  //     if (error) throw error;
  //     return reply.send({ success: true, data: plans || [] });
  //   } catch (error) {
  //     console.error('Fetch plans error:', error);
  //     return reply.status(500).send({
  //       success: false,
  //       error: 'Failed to fetch plans',
  //       details: error instanceof Error ? error.message : String(error),
  //     });
  //   }
  // });

  // ✅ FIXED: Unified plan resolution with proper typing
 // src/routes/plan.ts - ENHANCED to include subscription status
fastify.get('/api/v1/plan/:walletAddress/:blockchainId', async (request, reply) => {
  try {
    const { walletAddress, blockchainId } = request.params as { 
      walletAddress: string; 
      blockchainId: string; 
    };

    console.log(`🔍 Plan request for: ${walletAddress}/${blockchainId}`);

    // ✅ FIXED: Only select columns that exist in your User table
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id, planId, orgId, trialStartDate, trialUsed')
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    console.log('🔍 User query result:', { user, userError });

    if (userError) {
      console.error('❌ Database error:', userError);
      return reply.status(500).send({
        success: false,
        error: 'Database error',
        message: userError.message
      });
    }

    if (!user) {
      console.log('⚠️ User not found, returning Free plan default');
      return reply.send({
        success: true,
        planName: 'Free',
        queryLimit: 100,
        userLimit: 1,
        planSource: 'free',
        trialStartDate: null,
        trialUsed: false,
        subscriptionActive: false,
        subscriptionStartDate: null,
        subscriptionEndDate: null,
      });
    }

    // Get plan data
    let effectivePlan = null;
    let planSource = 'free';

    if (user.planId) {
      console.log('🔍 Looking up plan for planId:', user.planId);
      const { data: planData, error: planError } = await supabase
        .from('Plan')
        .select('name, queryLimit, userLimit')
        .eq('id', user.planId)
        .maybeSingle();
      
      console.log('🔍 Plan lookup result:', { planData, planError });
      
      if (planData && !planError) {
        effectivePlan = planData;
        planSource = 'individual';
      }
    }

    if (!effectivePlan) {
      effectivePlan = {
        name: 'Free',
        queryLimit: 100,
        userLimit: 1
      };
      planSource = 'free';
    }

    // ✅ FIXED: Since subscription columns don't exist, assume active for paid plans
    let subscriptionActive = false;
    let subscriptionEndDate = null;

    if (planSource !== 'free') {
      // If user has a paid plan, assume it's active
      subscriptionActive = true;
      // Set a default end date (30 days from now)
      subscriptionEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    console.log('🎯 Final plan response:', {
      planName: effectivePlan.name,
      queryLimit: effectivePlan.queryLimit,
      planSource,
      subscriptionActive
    });

    return reply.send({
      success: true,
      planName: effectivePlan.name,
      queryLimit: effectivePlan.queryLimit,
      userLimit: effectivePlan.userLimit,
      planSource,
      trialStartDate: user.trialStartDate,
      trialUsed: user.trialUsed,
      subscriptionActive,
      subscriptionStartDate: null, // ✅ Set to null since column doesn't exist
      subscriptionEndDate,
    });

  } catch (error) {
    console.error('❌ Plan fetch error:', error);
    return reply.status(500).send({
      success: false,
      error: 'Failed to fetch plan',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


  // Credit score endpoint
  fastify.get('/api/v1/credit-score/:walletAddress/:blockchainId', async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as { 
        walletAddress: string;
        blockchainId: string;
      };

      if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.status(400).send({ error: 'Invalid wallet address' });
      }

      const { data: user, error } = await supabase
        .from('User')
        .select('creditScore, trialStartDate, trialUsed, planId, orgId')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .single();

      if (error) throw error;

      // Check if user has active plan or trial
      const hasActivePlan = user.planId || user.orgId;
      if (!hasActivePlan && !isTrialActive(user.trialStartDate)) {
        return reply.status(403).send({
          error: 'Free trial expired. Please upgrade your plan.',
          code: 'TRIAL_EXPIRED'
        });
      }

      return reply.send({ 
        success: true, 
        creditScore: user.creditScore || 0 
      });
    } catch (error) {
      console.error('Fetch credit score error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch credit score',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Backward compatibility endpoint
  fastify.get('/api/v1/credit-score/:walletAddress', async (request, reply) => {
    try {
      const { walletAddress } = request.params as { walletAddress: string };

      if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.status(400).send({ error: 'Invalid wallet address' });
      }

      const { data: user, error } = await supabase
        .from('User')
        .select('creditScore, trialStartDate, trialUsed, planId, orgId')
        .eq('walletAddress', walletAddress)
        .order('createdAt', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      const hasActivePlan = user.planId || user.orgId;
      if (!hasActivePlan && !isTrialActive(user.trialStartDate)) {
        return reply.status(403).send({
          error: 'Free trial expired. Please upgrade your plan.'
        });
      }

      return reply.send({ 
        success: true, 
        creditScore: user.creditScore || 0 
      });
    } catch (error) {
      console.error('Fetch credit score error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch credit score',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
