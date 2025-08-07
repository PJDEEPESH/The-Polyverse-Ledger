// src/routes/crossChainIdentity.ts - PRODUCTION VERSION WITHOUT DEBUG CODE
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticationHook } from '../middleware/authentication.js';
import { queryLimitHook } from '../middleware/queryLimit.js';
import { transactionLimitHook } from '../middleware/transactionLimit.js';
import { sanitizeObject } from '../utils/sanitization.js';
import { generateUUID } from '../utils/ubid.js';
import { supabase } from '../lib/supabaseClient.js';
import { CreditScoreService } from '../services/creditScore.js';
import { isTrialActive } from '../utils/isTrialActive.js';

// ✅ Validation Schemas
const createIdentitySchema = z.object({
  userId: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  blockchainId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  proofHash: z.string().optional().default(() => generateUUID()),
});

const userIdSchema = z.object({
  userId: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
});

const repairSchema = z.object({
  userId: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
});

interface PlanData {
  name: string;
  userLimit: number;
  queryLimit: number;
  txnLimit: number | null;
  canViewOthers: boolean;
}

// ✅ Helper Functions
const getPlanData = async (planId: string | null): Promise<PlanData> => {
  if (!planId) {
    return getDefaultPlanLimits('Free');
  }

  try {
    const { data: planData, error: planError } = await supabase
      .from('Plan')
      .select('name, "userLimit", "queryLimit", "txnLimit", "canViewOthers"')
      .eq('id', planId)
      .maybeSingle();

    if (planError) {
      return getDefaultPlanLimits('Free');
    }

    if (!planData) {
      return getDefaultPlanLimits('Free');
    }
    
    const result: PlanData = {
      name: planData.name || 'Free',
      userLimit: planData.userLimit || 1,
      queryLimit: planData.queryLimit || 100,
      txnLimit: planData.txnLimit,
      canViewOthers: planData.canViewOthers || false
    };
    
    return result;
  } catch (error) {
    return getDefaultPlanLimits('Free');
  }
};

const getDefaultPlanLimits = (planName: string = 'Free'): PlanData => {
  const limits: Record<string, PlanData> = {
    'Free': { 
      name: 'Free',
      userLimit: 1, 
      queryLimit: 100, 
      txnLimit: null, 
      canViewOthers: false 
    },
    'Basic': { 
      name: 'Basic',
      userLimit: 3, 
      queryLimit: 1000, 
      txnLimit: 1000, 
      canViewOthers: true 
    },
    'Pro': { 
      name: 'Pro',
      userLimit: 5, 
      queryLimit: 15000, 
      txnLimit: 5000, 
      canViewOthers: true 
    },
    'Premium': { 
      name: 'Premium',
      userLimit: 10, 
      queryLimit: 1000000, 
      txnLimit: null, 
      canViewOthers: true 
    }
  };
  
  return limits[planName] || limits['Free'];
};

export async function crossChainIdentityRoutes(fastify: FastifyInstance) {
  
  // ✅ POST - Create CrossChain Identity
  fastify.post('/', {
    preHandler: [authenticationHook, transactionLimitHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = createIdentitySchema.parse(sanitizeObject(request.body));
      
      const userId = request.authenticatedUser?.id || parsed.userId;
      
      if (!userId) {
        return reply.status(400).send({ 
          success: false, 
          error: 'User ID not available from authentication context',
          code: 'MISSING_USER_ID'
        });
      }
      
      const { data: existingUser, error: userError } = await supabase
        .from('User')
        .select('id, planId, walletAddress, blockchainId, Plan(name)')
        .eq('id', userId)
        .maybeSingle();

      if (!existingUser) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          details: `No user found with ID: ${userId}`
        });
      }

      const planData = await getPlanData(existingUser.planId);
      const planLimits = getDefaultPlanLimits(planData.name);
      const walletLimit = planData.userLimit || planLimits.userLimit;

      const planDataFromUser: any = existingUser.Plan;
      let primaryPlan = 'Free';

      if (planDataFromUser) {
        if (Array.isArray(planDataFromUser)) {
          if (planDataFromUser.length > 0 && planDataFromUser[0] && typeof planDataFromUser[0] === 'object' && 'name' in planDataFromUser[0]) {
            primaryPlan = planDataFromUser[0].name || 'Free';
          }
        } else if (typeof planDataFromUser === 'object' && 'name' in planDataFromUser && planDataFromUser.name) {
          primaryPlan = planDataFromUser.name;
        }
      }

      if (primaryPlan === 'Free' && planData.name && planData.name !== 'Free') {
        primaryPlan = planData.name;
      }

      const { data: existingIdentities } = await supabase
        .from('CrossChainIdentity')
        .select('walletAddress, blockchainId')
        .eq('userId', userId);

      const currentWallets = new Set([
        `${existingUser.walletAddress}|${existingUser.blockchainId}`,
        ...(existingIdentities?.map(i => `${i.walletAddress}|${i.blockchainId}`) || [])
      ]);

      const walletCount = currentWallets.size;

      if (walletCount >= walletLimit) {
        return reply.status(403).send({
          success: false,
          error: `${primaryPlan} plan allows maximum ${walletLimit} wallet(s)`,
          code: 'WALLET_LIMIT_EXCEEDED',
          currentCount: walletCount,
          limit: walletLimit,
          planName: primaryPlan
        });
      }

      const [existingIdentity, existingPrimary] = await Promise.all([
        supabase.from('CrossChainIdentity')
          .select('id, userId')
          .eq('walletAddress', parsed.walletAddress)
          .eq('blockchainId', parsed.blockchainId)
          .maybeSingle(),
        supabase.from('User')
          .select('id')
          .eq('walletAddress', parsed.walletAddress)
          .eq('blockchainId', parsed.blockchainId)
          .maybeSingle()
      ]);

      if (existingIdentity.data || existingPrimary.data) {
        return reply.status(409).send({ 
          success: false, 
          error: 'Wallet already registered',
          code: 'WALLET_ALREADY_REGISTERED',
          details: {
            existsAsCrossChain: !!existingIdentity.data,
            existsAsPrimary: !!existingPrimary.data,
            existingUserId: existingIdentity.data?.userId || existingPrimary.data?.id
          }
        });
      }

      const identityId = generateUUID();
      const { data: newIdentity, error: createError } = await supabase
        .from('CrossChainIdentity')
        .insert({
          id: identityId,
          userId: userId,
          walletAddress: parsed.walletAddress,
          blockchainId: parsed.blockchainId,
          proofHash: parsed.proofHash,
          planName: primaryPlan,
          planSource: 'inherited',
          parentUserId: userId,
          creditScore: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (createError) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to create cross-chain identity',
          code: 'CREATE_FAILED',
          details: createError.message
        });
      }

      let calculatedScore = 0;
      try {
        calculatedScore = await CreditScoreService.calculateCrossChainScore(identityId);
      } catch (scoreError) {
        // Score calculation failed but continue
      }

      return reply.status(201).send({ 
        success: true, 
        data: { 
          identity: { 
            ...newIdentity, 
            creditScore: calculatedScore 
          },
          planInfo: {
            name: primaryPlan,
            source: 'inherited',
            inheritedFrom: userId,
            walletLimit: walletLimit,
            currentWallets: walletCount + 1,
            remainingWallets: walletLimit - walletCount - 1,
            features: {
              userLimit: planData.userLimit || planLimits.userLimit,
              queryLimit: planData.queryLimit || planLimits.queryLimit,
              txnLimit: planData.txnLimit || planLimits.txnLimit,
              canViewOthers: planData.canViewOthers ?? planLimits.canViewOthers
            }
          },
          message: `Cross-chain identity created successfully with ${primaryPlan} plan inheritance and score ${calculatedScore}`
        }
      });

    } catch (err: any) {
      return reply.status(400).send({ 
        success: false, 
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.message
      });
    }
  });

  // ✅ PUT - Repair CrossChain Identity
  fastify.put('/repair/:identityId', {
    preHandler: [authenticationHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { identityId } = request.params as any;
      const parsed = repairSchema.parse(sanitizeObject(request.body));
      
      const { data: user } = await supabase
        .from('User')
        .select('id, planId')
        .eq('id', parsed.userId)
        .maybeSingle();
        
      if (!user) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }
      
      const { data: existingIdentity } = await supabase
        .from('CrossChainIdentity')
        .select('id, userId, walletAddress, blockchainId')
        .eq('id', identityId)
        .maybeSingle();
        
      if (!existingIdentity) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Cross-chain identity not found',
          code: 'IDENTITY_NOT_FOUND'
        });
      }
      
      const { data: updatedIdentity, error: updateError } = await supabase
        .from('CrossChainIdentity')
        .update({ 
          userId: parsed.userId,
          updatedAt: new Date().toISOString()
        })
        .eq('id', identityId)
        .select('*')
        .single();
      
      if (updateError) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to repair cross-chain identity',
          code: 'REPAIR_FAILED',
          details: updateError.message
        });
      }
      
      return reply.send({
        success: true,
        message: 'Cross-chain identity repaired successfully',
        data: {
          identityId,
          userId: parsed.userId,
          walletAddress: existingIdentity.walletAddress,
          blockchainId: existingIdentity.blockchainId,
          repaired: true,
          repairedAt: new Date().toISOString()
        }
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to repair cross-chain identity',
        code: 'REPAIR_ERROR'
      });
    }
  });

  // ✅ DELETE - Delete CrossChain Identity
  fastify.delete('/:identityId', {
    preHandler: [authenticationHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { identityId } = request.params as any;
      
      const { data: existingIdentity } = await supabase
        .from('CrossChainIdentity')
        .select('id, userId, walletAddress, blockchainId')
        .eq('id', identityId)
        .maybeSingle();
        
      if (!existingIdentity) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Cross-chain identity not found',
          code: 'IDENTITY_NOT_FOUND'
        });
      }
      
      const { error: deleteError } = await supabase
        .from('CrossChainIdentity')
        .delete()
        .eq('id', identityId);

      if (deleteError) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to delete cross-chain identity',
          code: 'DELETE_FAILED',
          details: deleteError.message
        });
      }
      
      return reply.send({
        success: true,
        message: 'Cross-chain identity deleted successfully',
        data: {
          identityId,
          userId: existingIdentity.userId,
          walletAddress: existingIdentity.walletAddress,
          blockchainId: existingIdentity.blockchainId,
          deletedAt: new Date().toISOString()
        }
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message || 'Failed to delete cross-chain identity',
        code: 'DELETE_ERROR'
      });
    }
  });

  // ✅ GET - Query Usage Endpoint
  fastify.get('/query/usage/:walletAddress/:blockchainId', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { walletAddress, blockchainId } = request.params as any;
      
      const { data: primaryUser, error: primaryError } = await supabase
        .from('User')
        .select('id, "queriesUsed", "queriesLimit", planId, "queryResetDate"')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (primaryUser) {
        const planData = await getPlanData(primaryUser.planId);
        const planLimits = getDefaultPlanLimits(planData.name);
        
        const queriesLimit = primaryUser.queriesLimit || planData.queryLimit || planLimits.queryLimit;
        const queriesUsed = primaryUser.queriesUsed || 0;

        return reply.send({
          success: true,
          data: {
            userId: primaryUser.id,
            queriesUsed,
            queriesLimit,
            queryResetDate: primaryUser.queryResetDate,
            planName: planData.name,
            planFeatures: {
              userLimit: planData.userLimit || planLimits.userLimit,
              txnLimit: planData.txnLimit || planLimits.txnLimit,
              canViewOthers: planData.canViewOthers ?? planLimits.canViewOthers
            },
            usagePercentage: queriesLimit > 0 ? Math.round((queriesUsed / queriesLimit) * 100) : 0,
            source: 'primary'
          }
        });
      }

      const { data: crossChain, error: crossChainError } = await supabase
        .from('CrossChainIdentity')
        .select('id, userId')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (crossChain && crossChain.userId) {
        const { data: userData, error: userDataError } = await supabase
          .from('User')
          .select('"queriesUsed", "queriesLimit", planId, "queryResetDate"')
          .eq('id', crossChain.userId)
          .maybeSingle();

        if (userData) {
          const planData = await getPlanData(userData.planId);
          const planLimits = getDefaultPlanLimits(planData.name);
          
          const queriesLimit = userData.queriesLimit || planData.queryLimit || planLimits.queryLimit;
          const queriesUsed = userData.queriesUsed || 0;

          return reply.send({
            success: true,
            data: {
              userId: crossChain.userId,
              crossChainIdentityId: crossChain.id,
              queriesUsed,
              queriesLimit,
              queryResetDate: userData.queryResetDate,
              planName: planData.name,
              planFeatures: {
                userLimit: planData.userLimit || planLimits.userLimit,
                txnLimit: planData.txnLimit || planLimits.txnLimit,
                canViewOthers: planData.canViewOthers ?? planLimits.canViewOthers
              },
              usagePercentage: queriesLimit > 0 ? Math.round((queriesUsed / queriesLimit) * 100) : 0,
              source: 'crosschain',
              inheritedFrom: 'primary'
            }
          });
        }
      }

      return reply.status(404).send({ 
        success: false, 
        error: 'User not found',
        code: 'USER_NOT_FOUND',
        details: 'Wallet not registered as primary or cross-chain identity'
      });
    } catch (error: any) {
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch usage data',
        code: 'QUERY_USAGE_ERROR',
        details: error.message
      });
    }
  });

  // ✅ GET - Dynamic Credit Score Endpoint
  fastify.get('/credit-score/wallet/:walletAddress/:blockchainId', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { walletAddress, blockchainId } = request.params as any;
      
      const { data: primaryUser, error: primaryError } = await supabase
        .from('User')
        .select('id, creditScore, planId, trialStartDate, trialUsed')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (primaryError && primaryError.code !== 'PGRST116') {
        throw new Error(`Database error: ${primaryError.message}`);
      }

      if (primaryUser) {
        const hasActivePlan = !!primaryUser.planId;
        const hasActiveTrial = isTrialActive(primaryUser.trialStartDate) && !primaryUser.trialUsed;

        if (!hasActivePlan && !hasActiveTrial) {
          return reply.status(403).send({
            success: false,
            error: 'Access denied. Please upgrade your plan or start free trial.',
            code: 'NO_ACTIVE_PLAN'
          });
        }

        const score = await CreditScoreService.calculateScore(primaryUser.id);
        const planData = await getPlanData(primaryUser.planId);
        
        const storedScore = primaryUser.creditScore !== null && primaryUser.creditScore !== undefined ? primaryUser.creditScore : 0;
        
        return reply.send({
          success: true,
          userId: primaryUser.id,
          creditScore: score,
          storedScore: storedScore,
          planName: planData.name,
          source: 'primary',
          walletAddress: walletAddress,
          blockchainId: blockchainId
        });
      }

      const { data: crossChain, error: crossChainError } = await supabase
        .from('CrossChainIdentity')
        .select(`
          id, 
          userId, 
          creditScore,
          User!userId(
            id,
            planId,
            trialStartDate,
            trialUsed
          )
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (crossChainError && crossChainError.code !== 'PGRST116') {
        throw new Error(`Database error: ${crossChainError.message}`);
      }

      if (crossChain && crossChain.User) {
        const userData = Array.isArray(crossChain.User) ? crossChain.User[0] : crossChain.User;
        
        const hasActivePlan = !!userData.planId;
        const hasActiveTrial = isTrialActive(userData.trialStartDate) && !userData.trialUsed;

        if (!hasActivePlan && !hasActiveTrial) {
          return reply.status(403).send({
            success: false,
            error: 'Access denied. Please upgrade your plan or start free trial.',
            code: 'NO_ACTIVE_PLAN'
          });
        }

        const score = await CreditScoreService.calculateCrossChainScore(crossChain.id);
        
        let planName = 'Free';
        if (userData.planId) {
          const planData = await getPlanData(userData.planId);
          planName = planData.name;
        }
        
        const storedScore = crossChain.creditScore !== null && crossChain.creditScore !== undefined ? crossChain.creditScore : 0;
        
        return reply.send({
          success: true,
          userId: crossChain.userId,
          crossChainIdentityId: crossChain.id,
          creditScore: score,
          storedScore: storedScore,
          planName: planName,
          source: 'crosschain',
          walletAddress: walletAddress,
          blockchainId: blockchainId
        });
      }

      return reply.status(404).send({ 
        success: false, 
        error: 'Wallet not found',
        code: 'WALLET_NOT_FOUND'
      });
    } catch (error: any) {
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch credit score',
        code: 'CREDIT_SCORE_ERROR',
        details: error.message
      });
    }
  });

  // ✅ GET - Test Score Endpoint
  fastify.get('/test-score/:identityId', {}, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { identityId } = request.params as any;
      
      const { data: identity } = await supabase
        .from('CrossChainIdentity')
        .select('id, userId, creditScore, walletAddress, blockchainId, createdAt')
        .eq('id', identityId)
        .maybeSingle();
      
      if (!identity) {
        return reply.status(404).send({
          success: false,
          error: 'Cross-chain identity not found',
          code: 'IDENTITY_NOT_FOUND'
        });
      }
      
      const calculatedScore = await CreditScoreService.calculateCrossChainScore(identityId);
      
      let userInfo = null;
      let planInfo = null;
      if (identity.userId) {
        const { data: user } = await supabase
          .from('User')
          .select('id, walletAddress, blockchainId, planId')
          .eq('id', identity.userId)
          .maybeSingle();
        
        if (user) {
          const planData = await getPlanData(user.planId);
          const planLimits = getDefaultPlanLimits(planData.name);
          
          userInfo = { ...user };
          planInfo = {
            name: planData.name,
            features: {
              userLimit: planData.userLimit || planLimits.userLimit,
              queryLimit: planData.queryLimit || planLimits.queryLimit,
              txnLimit: planData.txnLimit || planLimits.txnLimit,
              canViewOthers: planData.canViewOthers ?? planLimits.canViewOthers
            }
          };
        }
      }
      
      return reply.send({
        success: true,
        identityId,
        calculatedScore,
        storedScore: identity.creditScore,
        walletAddress: identity.walletAddress,
        blockchainId: identity.blockchainId,
        userId: identity.userId,
        hasUserId: !!identity.userId,
        userInfo,
        planInfo,
        createdAt: identity.createdAt,
        message: 'Score calculation test completed'
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        code: 'TEST_SCORE_ERROR'
      });
    }
  });

  // ✅ GET - User's identities with plan info
  fastify.get('/user/:userId', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = userIdSchema.parse(sanitizeObject(request.params));
      
      const { data: existingUser } = await supabase
        .from('User')
        .select('id, planId, walletAddress, blockchainId')
        .eq('id', userId)
        .maybeSingle();

      if (!existingUser) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      const planData = await getPlanData(existingUser.planId);
      const planLimits = getDefaultPlanLimits(planData.name);

      const { data: identities } = await supabase
        .from('CrossChainIdentity')
        .select('*')
        .eq('userId', userId)
        .order('createdAt', { ascending: false });

      const totalWallets = 1 + (identities?.length || 0);
      const walletLimit = planData.userLimit || planLimits.userLimit;

      return reply.send({ 
        success: true, 
        data: { 
          identities: identities || [],
          count: identities?.length || 0,
          user: {
            id: existingUser.id,
            primaryWallet: {
              address: existingUser.walletAddress,
              blockchainId: existingUser.blockchainId
            }
          },
          planInfo: {
            name: planData.name,
            limits: {
              userLimit: walletLimit,
              queryLimit: planData.queryLimit || planLimits.queryLimit,
              txnLimit: planData.txnLimit || planLimits.txnLimit,
              canViewOthers: planData.canViewOthers ?? planLimits.canViewOthers
            },
            usage: {
              walletsUsed: totalWallets,
              walletsRemaining: Math.max(0, walletLimit - totalWallets),
              canAddMore: totalWallets < walletLimit
            }
          }
        }
      });
    } catch (err: any) {
      return reply.status(400).send({ 
        success: false, 
        error: 'Invalid user ID',
        code: 'INVALID_USER_ID'
      });
    }
  });

  // ✅ GET - Verify wallet
  fastify.get('/verify/:walletAddress/:blockchainId', {
    preHandler: [],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { walletAddress, blockchainId } = request.params as any;
      
      const [crossChainResult, primaryResult] = await Promise.all([
        supabase.from('CrossChainIdentity')
          .select('*')
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle(),
        supabase.from('User')
          .select('*')
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle()
      ]);

      let creditScore = 0;
      let source = null;
      let isRegistered = false;
      let userId = null;
      let crossChainIdentityId = null;
      let planInfo = null;

      if (primaryResult.data) {
        isRegistered = true;
        source = 'primary';
        userId = primaryResult.data.id;
        
        try {
          creditScore = await CreditScoreService.calculateScore(primaryResult.data.id);
        } catch (err) {
          // Score calculation failed
        }
        
        const planData = await getPlanData(primaryResult.data.planId);
        
        planInfo = {
          name: planData.name,
          features: {
            userLimit: planData.userLimit,
            queryLimit: planData.queryLimit,
            txnLimit: planData.txnLimit,
            canViewOthers: planData.canViewOthers
          }
        };
      } else if (crossChainResult.data) {
        isRegistered = true;
        source = 'crosschain';
        userId = crossChainResult.data.userId;
        crossChainIdentityId = crossChainResult.data.id;
        
        try {
          creditScore = await CreditScoreService.calculateCrossChainScore(crossChainResult.data.id);
        } catch (err) {
          // Score calculation failed
        }
        
        if (userId) {
          const { data: parentUser, error: parentError } = await supabase
            .from('User')
            .select('planId')
            .eq('id', userId)
            .maybeSingle();
          
          if (parentUser) {
            const planData = await getPlanData(parentUser.planId);
            
            planInfo = {
              name: planData.name,
              inherited: true,
              features: {
                userLimit: planData.userLimit,
                queryLimit: planData.queryLimit,
                txnLimit: planData.txnLimit,
                canViewOthers: planData.canViewOthers
              }
            };
          } else {
            planInfo = {
              name: 'Free',
              inherited: true,
              features: getDefaultPlanLimits('Free')
            };
          }
        }
      }

      const response = { 
        success: true, 
        data: { 
          isRegistered, 
          source, 
          creditScore, 
          walletAddress, 
          blockchainId,
          userId,
          crossChainIdentityId,
          hasUserId: !!userId,
          planInfo,
          timestamp: new Date().toISOString()
        }
      };
      
      return reply.send(response);
    } catch (error: any) {
      return reply.status(500).send({ 
        success: false, 
        error: 'Verification failed',
        code: 'VERIFICATION_ERROR',
        details: error.message
      });
    }
  });

  // ✅ POST - Initialize credit score
  fastify.post('/:identityId/init-credit-score', {
    preHandler: [authenticationHook, transactionLimitHook],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { identityId } = request.params as any;
      const { userId } = request.body as any;

      const { data: identity } = await supabase
        .from('CrossChainIdentity')
        .select('*')
        .eq('id', identityId)
        .eq('userId', userId)
        .maybeSingle();

      if (!identity) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Identity not found or access denied',
          code: 'IDENTITY_NOT_FOUND'
        });
      }

      const calculatedScore = await CreditScoreService.calculateCrossChainScore(identityId);

      await supabase
        .from('CrossChainIdentity')
        .update({ 
          creditScore: calculatedScore,
          updatedAt: new Date().toISOString()
        })
        .eq('id', identityId);

      return reply.send({
        success: true,
        data: { 
          identityId, 
          creditScore: calculatedScore, 
          calculated: true,
          updatedAt: new Date().toISOString()
        }
      });
    } catch (error: any) {
      return reply.status(500).send({ 
        success: false, 
        error: 'Failed to calculate credit score',
        code: 'SCORE_INIT_ERROR'
      });
    }
  });

  // ✅ GET - Health check endpoint
  fastify.get('/health', {}, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [identityResult, userResult, planResult] = await Promise.all([
        supabase.from('CrossChainIdentity').select('id', { count: 'exact' }),
        supabase.from('User').select('id', { count: 'exact' }),
        supabase.from('Plan').select('name', { count: 'exact' })
      ]);

      let planDistribution = {};
      try {
        const { data: planStats } = await supabase
          .from('User')
          .select('planId, Plan(name)')
          .not('planId', 'is', null);
        
        if (planStats) {
          planDistribution = planStats.reduce((acc: any, user: any) => {
            const planName = user.Plan?.name || 'Unknown';
            acc[planName] = (acc[planName] || 0) + 1;
            return acc;
          }, {});
        }
      } catch (err) {
        // Plan distribution fetch failed
      }

      return reply.send({
        success: true,
        data: {
          crossChainIdentities: identityResult.data?.length || 0,
          users: userResult.data?.length || 0,
          plans: planResult.data?.length || 0,
          planDistribution,
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        }
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        code: 'HEALTH_CHECK_ERROR'
      });
    }
  });

  // ✅ GET - Plan limits endpoint
  fastify.get('/plan-limits/:planName?', {}, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { planName } = request.params as any;
      
      if (planName) {
        const limits = getDefaultPlanLimits(planName);
        
        return reply.send({
          success: true,
          data: {
            planName,
            limits
          }
        });
      } else {
        const allPlans = ['Free', 'Basic', 'Pro', 'Premium'];
        const planLimits = allPlans.reduce((acc, plan) => {
          acc[plan] = getDefaultPlanLimits(plan);
          return acc;
        }, {} as any);
        
        return reply.send({
          success: true,
          data: {
            plans: planLimits
          }
        });
      }
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        code: 'PLAN_LIMITS_ERROR'
      });
    }
  });
}
