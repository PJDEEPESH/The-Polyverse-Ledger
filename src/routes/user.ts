// src/routes/user.ts - PRODUCTION VERSION WITH PROPER CROSS-CHAIN PLAN INHERITANCE
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID, generateAPIKey } from '../utils/ubid.js';
import { walletValidationHook } from '../middleware/validateWallet.js';
import { queryLimitHook } from '../middleware/queryLimit.js';
import { isTrialActive } from '../utils/isTrialActive.js';
import { checkUserPlanLimits, canAddWalletToUser } from '../utils/checkUserPlanLimits.js';
import { fetchWalletData, validateWalletAddress } from '../services/userWalletFetcher.js';

const createUserSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  metadataURI: z.string().min(1).max(500),
  blockchainId: z.string().min(1),
  chainName: z.string().min(1).max(100),
});

const addWalletSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  blockchainId: z.string().min(1),
  metadataURI: z.string().min(1).max(500),
  userId: z.string().min(1),
  chainName: z.string().min(1).max(100),
});

// ✅ Helper function to safely extract plan name
const extractPlanName = (planData: any): string => {
  if (!planData) return 'Free';
  
  // Handle array format (Supabase returns arrays sometimes)
  if (Array.isArray(planData)) {
    if (planData.length > 0 && planData[0]?.name) {
      return planData[0].name;
    }
    return 'Free';
  }
  
  // Handle object format
  if (typeof planData === 'object' && planData.name) {
    return planData.name;
  }
  
  // Handle direct string
  if (typeof planData === 'string') {
    return planData;
  }
  
  return 'Free';
};

export async function userRoutes(fastify: FastifyInstance) {
  // Health check
  fastify.get('/health', async (_, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Get all users
  fastify.get('/', async (_, reply) => {
    try {
      const { data: users, error } = await supabase
        .from('User')
        .select(`
          *,
          Plan!planId (name, queryLimit, userLimit)
        `)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      return reply.send({ success: true, data: users || [] });
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to fetch users',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Register new user (primary wallet)
  fastify.post('/register', async (request, reply) => {
    try {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        });
      }
      
      const { walletAddress, metadataURI, blockchainId, chainName } = parsed.data;

      // 1. Check for existing users
      const [primaryUser, crossChainUser] = await Promise.all([
        supabase
          .from('User')
          .select('id')
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle(),
        supabase
          .from('CrossChainIdentity')
          .select('id')
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle(),
      ]);
      
      if (primaryUser.error && primaryUser.error.code !== 'PGRST116') {
        throw new Error(`Database error: ${primaryUser.error.message}`);
      }
      
      if (crossChainUser.error && crossChainUser.error.code !== 'PGRST116') {
        throw new Error(`Database error: ${crossChainUser.error.message}`);
      }
      
      if (primaryUser.data || crossChainUser.data) {
        return reply.status(409).send({ 
          error: 'This wallet is already registered as a user or cross-chain identity' 
        });
      }

      // 2. Handle blockchain entry
      const { data: existingChain, error: chainQueryError } = await supabase
        .from('Blockchain')
        .select('*')
        .eq('id', blockchainId)
        .maybeSingle();
        
      if (chainQueryError && chainQueryError.code !== 'PGRST116') {
        throw new Error(`Database error: ${chainQueryError.message}`);
      }
      
      const now = new Date().toISOString();
      const ubid = existingChain?.ubid || generateUUID();
      const apiKey = existingChain?.apiKey || generateAPIKey();
      const networkType = existingChain?.networkType || 'custom';
      const chainProtocol = existingChain?.chainProtocol || 'custom';

      const { error: blockchainError } = await supabase
        .from('Blockchain')
        .upsert({
          id: blockchainId,
          name: chainName,
          ubid,
          apiKey,
          networkType,
          chainProtocol,
          bnsName: chainName,
          createdAt: existingChain?.createdAt || now,
          updatedAt: now,
        }, { onConflict: 'id' });
        
      if (blockchainError) {
        throw new Error(`Blockchain creation failed: ${blockchainError.message}`);
      }

      // 3. Get Free Plan
      const { data: freePlan, error: planError } = await supabase
        .from("Plan")
        .select("id")
        .eq("name", "Free")
        .single();
        
      if (planError || !freePlan) {
        throw new Error('Free plan not found in database');
      }

      // 4. Create user
      const userNow = new Date().toISOString();
      const userId = generateUUID();

      const userData = {
        id: userId,
        walletAddress,
        metadataURI,
        blockchainId,
        planId: freePlan.id,
        updatedAt: userNow,
        trialStartDate: userNow,
        trialUsed: false,
        createdAt: userNow,
        creditScore: 0,
      };

      const { data: user, error: userError } = await supabase
        .from('User')
        .insert(userData)
        .select(`*, Plan!planId (name, queryLimit, userLimit)`)
        .single();
        
      if (userError) {
        throw new Error(`User creation failed: ${userError.message}`);
      }

      return reply.send({
        success: true,
        data: user,
        message: 'User registered successfully',
      });
      
    } catch (error) {
      return reply.status(500).send({
        error: 'Registration failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  fastify.post('/add-wallet', async (request, reply) => {
    try {
      const parsed = addWalletSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const { walletAddress, blockchainId, metadataURI, userId, chainName } = parsed.data;
      if (!userId) return reply.status(400).send({ error: 'userId is required' });

      // ✅ Get primary user and their plan FIRST
      const { data: primaryUser, error: userError } = await supabase
        .from('User')
        .select('id, walletAddress, blockchainId, Plan(name)')
        .eq('id', userId)
        .single();

      if (userError || !primaryUser) {
        return reply.status(404).send({ 
          error: 'Primary user not found',
          code: 'USER_NOT_FOUND' 
        });
      }

      // ✅ Extract plan name safely
      const primaryPlan = extractPlanName(primaryUser.Plan);

      // 2. Plan/user wallet limit check
      const canAdd = await canAddWalletToUser(userId, walletAddress, blockchainId);
      if (!canAdd.canAdd) {
        return reply.status(403).send({
          error: canAdd.reason,
          code: 'WALLET_LIMIT_EXCEEDED',
          wouldCount: canAdd.wouldCount,
        });
      }

      // 3. Ensure wallet not taken by anyone
      const [existingInUser, existingInCrossChain] = await Promise.all([
        supabase
          .from('User')
          .select('id, walletAddress')
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle(),
        supabase
          .from('CrossChainIdentity')
          .select('id, walletAddress, userId')
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle(),
      ]);

      if (existingInUser.data) {
        if (existingInUser.data.id === userId) {
          return reply.status(409).send({
            error: 'This is your primary wallet. You cannot add it as an additional wallet.',
            code: 'CANNOT_ADD_PRIMARY_WALLET'
          });
        } else {
          return reply.status(409).send({
            error: 'This wallet is already registered as a primary wallet by another user',
            code: 'WALLET_EXISTS_PRIMARY'
          });
        }
      }

      if (existingInCrossChain.data) {
        if (existingInCrossChain.data.userId === userId) {
          return reply.status(409).send({
            error: 'You have already added this wallet to your account',
            code: 'WALLET_EXISTS_SAME_USER'
          });
        } else {
          return reply.status(409).send({
            error: 'This wallet is already registered by another user',
            code: 'WALLET_EXISTS_OTHER_USER'
          });
        }
      }

      // 4. Ensure blockchain exists
      const { data: blockchain } = await supabase
        .from('Blockchain')
        .select('id, name')
        .eq('id', blockchainId)
        .maybeSingle();

      if (!blockchain) {
        const { error: blockchainError } = await supabase
          .from('Blockchain')
          .upsert({
            id: blockchainId,
            name: chainName,
            ubid: generateUUID(),
            apiKey: generateAPIKey(),
            networkType: 'custom',
            chainProtocol: 'custom',
            bnsName: chainName, 
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, { onConflict: 'id' });

        if (blockchainError) {
          throw new Error('Failed to create blockchain entry');
        }
      }

      // ✅ Insert CrossChainIdentity with inherited plan information
      const now = new Date().toISOString();
      const { data: crossChainIdentity, error: crossChainError } = await supabase
        .from('CrossChainIdentity')
        .insert({
          id: generateUUID(),
          userId,
          blockchainId,
          walletAddress,
          proofHash: generateUUID(),
          // ✅ Add plan inheritance fields
          planName: primaryPlan,
          planSource: 'inherited',
          parentUserId: userId,
          metadataURI: metadataURI || '',
          chainName: chainName,
          creditScore: 0,
          createdAt: now,
          updatedAt: now,
        })
        .select(`
          *, 
          blockchain:Blockchain!blockchainId(name, ubid)
        `)
        .single();

      if (crossChainError) {
        throw crossChainError;
      }

      // ✅ Return enhanced response with plan inheritance info
      return reply.send({
        success: true,
        data: {
          ...crossChainIdentity,
          planInfo: {
            name: primaryPlan,
            source: 'inherited',
            inheritedFrom: userId,
            sharedLimits: true
          }
        },
        message: `Wallet added successfully with ${primaryPlan} plan inheritance`,
        countsTowardLimit: canAdd.wouldCount,
        planInheritance: {
          primaryUserPlan: primaryPlan,
          crossChainPlan: primaryPlan,
          planSource: 'inherited'
        }
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to add wallet',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get user's wallet count and plan limits
  fastify.get('/wallet-limits/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      const planInfo = await checkUserPlanLimits(userId);

      return reply.send({
        success: true,
        data: planInfo,
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to get wallet limits',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ✅ Enhanced /wallet/:walletAddress/:blockchainId endpoint with proper cross-chain support
  fastify.get('/wallet/:walletAddress/:blockchainId', {
    preHandler: [walletValidationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as any;
      
      // ✅ Check primary wallet
      const { data: primaryUser, error: primaryError } = await supabase
        .from('User')
        .select(`
          *,
          Plan!planId (name, "queryLimit", "userLimit", "txnLimit")
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (primaryError && primaryError.code !== 'PGRST116') {
        // Primary user query error
      }

      if (primaryUser) {
        const planName = extractPlanName(primaryUser.Plan);
        const planQueryLimit = planName === 'Free' ? 100 : 
                              planName === 'Basic' ? 1000 :
                              planName === 'Pro' ? 15000 : 1000000;

        // ✅ Fetch query usage
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        
        let queriesUsed = 0;
        let queriesLimit = primaryUser.queriesLimit || planQueryLimit;
        
        try {
          // First try QueryUsage table (monthly tracking)
          const { data: queryUsage } = await supabase
            .from('QueryUsage')
            .select('used')
            .eq('userId', primaryUser.id)
            .eq('month', currentMonth)
            .eq('year', currentYear)
            .maybeSingle();
          
          if (queryUsage) {
            queriesUsed = queryUsage.used;
          } else {
            // Fallback to User table columns
            queriesUsed = primaryUser.queriesUsed || primaryUser.queryCount || 0;
          }
        } catch (error) {
          queriesUsed = primaryUser.queriesUsed || primaryUser.queryCount || 0;
        }

        // ✅ Fetch transaction usage
        let transactionUsage = { 
          used: 0, 
          count: 0,
          limit: planName === 'Free' ? null : 
                 planName === 'Basic' ? 1000 :
                 planName === 'Pro' ? 5000 : null
        };
        
        try {
          const startDate = new Date(currentYear, currentMonth - 1, 1).toISOString();
          const endDate = new Date(currentYear, currentMonth, 1).toISOString();
          
          const { data: transactions } = await supabase
            .from('Transaction')
            .select('amount, status')
            .eq('userId', primaryUser.id)
            .eq('status', 'SUCCESS')
            .gte('createdAt', startDate)
            .lt('createdAt', endDate);

          if (transactions) {
            const totalAmount = transactions.reduce((sum, txn) => sum + (txn.amount || 0), 0);
            transactionUsage = {
              used: totalAmount,
              count: transactions.length,
              limit: transactionUsage.limit
            };
          }
        } catch (error) {
          // Transaction query failed, use defaults
        }
        
        return reply.send({
          success: true,
          data: {
            ...primaryUser,
            source: 'primary',
            planName: planName,
            queriesLimit: queriesLimit,
            queriesUsed: queriesUsed,
            queryResetDate: primaryUser.queryResetDate || primaryUser.lastQueryReset,
            transactionUsage: transactionUsage,
            Plan: { name: planName }
          }
        });
      }

      // ✅ Check CrossChainIdentity
      const { data: crossChainUser, error: crossChainError } = await supabase
        .from('CrossChainIdentity')
        .select(`
          *,
          User!userId(
            id,
            planId,
            "queriesUsed",
            "queriesLimit", 
            "queryResetDate",
            queryCount,
            lastQueryReset,
            Plan!planId(name, "queryLimit", "userLimit", "txnLimit")
          )
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (crossChainError && crossChainError.code !== 'PGRST116') {
        return reply.status(500).send({
          success: false,
          error: 'Database query error',
          details: crossChainError.message
        });
      }

      if (crossChainUser && crossChainUser.User) {
        const userData = Array.isArray(crossChainUser.User) ? crossChainUser.User[0] : crossChainUser.User;
        const planName = crossChainUser.planName || extractPlanName(userData.Plan);
        const planQueryLimit = planName === 'Free' ? 100 : 
                              planName === 'Basic' ? 1000 :
                              planName === 'Pro' ? 15000 : 1000000;

        // ✅ Cross-chain query usage (shared with parent user)
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        
        let queriesUsed = 0;
        let queriesLimit = userData.queriesLimit || planQueryLimit;
        
        try {
          // Try QueryUsage table first (shared with parent user)
          const { data: queryUsage } = await supabase
            .from('QueryUsage')
            .select('used')
            .eq('userId', userData.id) // Parent user's ID
            .eq('month', currentMonth)
            .eq('year', currentYear)
            .maybeSingle();
          
          if (queryUsage) {
            queriesUsed = queryUsage.used;
          } else {
            // Fallback to User table columns
            queriesUsed = userData.queriesUsed || userData.queryCount || 0;
          }
        } catch (error) {
          queriesUsed = userData.queriesUsed || userData.queryCount || 0;
        }

        // ✅ Cross-chain transaction usage (shared with parent user)
        let transactionUsage = { 
          used: 0, 
          count: 0,
          limit: planName === 'Free' ? null : 
                 planName === 'Basic' ? 1000 :
                 planName === 'Pro' ? 5000 : null
        };
        
        try {
          const startDate = new Date(currentYear, currentMonth - 1, 1).toISOString();
          const endDate = new Date(currentYear, currentMonth, 1).toISOString();
          
          const { data: transactions } = await supabase
            .from('Transaction')
            .select('amount, status')
            .eq('userId', userData.id) // Parent user's ID
            .eq('status', 'SUCCESS')
            .gte('createdAt', startDate)
            .lt('createdAt', endDate);

          if (transactions) {
            const totalAmount = transactions.reduce((sum, txn) => sum + (txn.amount || 0), 0);
            transactionUsage = {
              used: totalAmount,
              count: transactions.length,
              limit: transactionUsage.limit
            };
          }
        } catch (error) {
          // Transaction query failed, use defaults
        }
        
        return reply.send({
          success: true,
          data: {
            ...crossChainUser,
            source: 'crosschain',
            planName: planName,
            queriesLimit: queriesLimit,
            queriesUsed: queriesUsed,
            queryResetDate: userData.queryResetDate || userData.lastQueryReset,
            transactionUsage: transactionUsage,
            // Include main user info for plan limits (shared)
            mainUserId: userData.id,
            userId: userData.id,
            planId: userData.planId,
            Plan: { name: planName },
            parentUserId: userData.id
          }
        });
      }

      return reply.status(404).send({
        success: false,
        error: 'Wallet not found',
        code: 'WALLET_NOT_FOUND'
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  });

  // Update user plan
  fastify.patch('/plan/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const { planName } = request.body as { planName: string };

      // Get plan ID
      const { data: plan, error: planError } = await supabase
        .from('Plan')
        .select('id, userLimit')
        .eq('name', planName)
        .single();

      if (planError || !plan) {
        return reply.status(404).send({ error: 'Plan not found' });
      }

      // Check if current wallet count exceeds new plan limit
      const currentPlanInfo = await checkUserPlanLimits(userId);
      
      if (currentPlanInfo.usedWallets > plan.userLimit) {
        return reply.status(400).send({
          error: `Cannot downgrade to ${planName}. You have ${currentPlanInfo.usedWallets} wallets but ${planName} only allows ${plan.userLimit}`,
          code: 'WALLET_COUNT_EXCEEDS_PLAN',
        });
      }

      // Update user plan
      const { data: updatedUser, error } = await supabase
        .from('User')
        .update({
          planId: plan.id,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', userId)
        .select(`
          *,
          Plan!planId (name, queryLimit, userLimit, txnLimit)
        `)
        .single();

      if (error) throw error;

      return reply.send({
        success: true,
        data: updatedUser,
        message: `Plan updated to ${planName}`,
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to update plan',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ✅ Enhanced credit score route that supports CrossChainIdentity
  fastify.get('/credit-score/:walletAddress/:blockchainId', {
    preHandler: [async (request: any, reply: any) => {
      if (request.body) {
        request.body.incrementUsage = false;
      } else {
        request.body = { incrementUsage: false };
      }
      return queryLimitHook(request, reply);
    }],
  }, async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as { 
        walletAddress: string;
        blockchainId: string;
      };

      const queryContext = (request as any).queryContext;

      // ✅ Check both primary and crosschain users
      let user = null;
      let source = null;
      let crossChainIdentityId = null;

      // Check primary wallet first
      const { data: primaryUser, error: primaryError } = await supabase
        .from('User')
        .select(`
          id,
          creditScore,
          trialStartDate,
          trialUsed,
          planId
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (primaryError && primaryError.code !== 'PGRST116') {
        // Primary user query error
      }

      if (primaryUser) {
        user = primaryUser;
        source = 'primary';
      } else {
        // Check CrossChainIdentity
        const { data: crossChainUser, error: crossChainError } = await supabase
          .from('CrossChainIdentity')
          .select(`
            id,
            userId,
            creditScore,
            User!userId(
              id,
              "trialStartDate",
              "trialUsed",
              planId
            )
          `)
          .eq('walletAddress', walletAddress)
          .eq('blockchainId', blockchainId)
          .maybeSingle();

        if (crossChainError && crossChainError.code !== 'PGRST116') {
          // CrossChain user query error
        }

        if (crossChainUser && crossChainUser.User) {
          const userData = Array.isArray(crossChainUser.User) ? crossChainUser.User[0] : crossChainUser.User;
          user = {
            id: userData.id,
            creditScore: crossChainUser.creditScore, // Use CrossChain-specific credit score
            trialStartDate: userData.trialStartDate,
            trialUsed: userData.trialUsed,
            planId: userData.planId
          };
          source = 'crosschain';
          crossChainIdentityId = crossChainUser.id;
        }
      }

      if (!user) {
        return reply.status(404).send({ 
          success: false, 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Check if user has access (plan limits are shared for both primary and crosschain)
      const hasActivePlan = !!user.planId;
      const hasActiveTrial = isTrialActive(user.trialStartDate) && !user.trialUsed;

      if (!hasActivePlan && !hasActiveTrial) {
        return reply.status(403).send({
          error: 'Access denied. Please upgrade your plan or start free trial.',
          code: 'NO_ACTIVE_PLAN'
        });
      }

      return reply.send({ 
        success: true, 
        creditScore: user.creditScore || 0,
        source: source,
        userId: user.id,
        crossChainIdentityId: crossChainIdentityId,
        usage: queryContext
      });
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to fetch credit score',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ✅ GET /api/v1/user/exists/:walletAddress/:blockchainId - Check if wallet exists
  fastify.get('/exists/:walletAddress/:blockchainId', {
    preHandler: [queryLimitHook],
  }, async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as any;
      
      const walletUser = await findExistingWalletUser(walletAddress, blockchainId);
      
      if (walletUser.found) {
        return reply.send({
          exists: true,
          source: walletUser.source,
          userId: walletUser.userId,
          crossChainIdentityId: walletUser.crossChainIdentityId,
          message: `Wallet registered as ${walletUser.source} user`
        });
      } else {
        return reply.send({
          exists: false,
          error: walletUser.error,
          message: 'Wallet not registered in system'
        });
      }

    } catch (error: unknown) {
      return reply.status(500).send({
        exists: false,
        error: 'Failed to check wallet registration',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Helper function
  async function findExistingWalletUser(walletAddress: string, blockchainId: string): Promise<{
    found: boolean;
    userId?: string;
    planId?: string;
    source?: 'primary' | 'crosschain';
    crossChainIdentityId?: string | null;
    error?: string;
  }> {
    // Check primary wallet (User table)
    const { data: primaryUser } = await supabase
      .from('User')
      .select('id, planId')
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (primaryUser) {
      return {
        found: true,
        userId: primaryUser.id,
        planId: primaryUser.planId,
        source: 'primary',
        crossChainIdentityId: null
      };
    }

    // Check CrossChainIdentity table
    const { data: crossChainUser } = await supabase
      .from('CrossChainIdentity')
      .select(`
        id,
        userId,
        User!userId(id, planId)
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (crossChainUser && crossChainUser.User) {
      const userData = Array.isArray(crossChainUser.User) 
        ? crossChainUser.User[0] 
        : crossChainUser.User;

      return {
        found: true,
        userId: crossChainUser.userId,
        planId: userData.planId,
        source: 'crosschain',
        crossChainIdentityId: crossChainUser.id
      };
    }

    return {
      found: false,
      error: 'Wallet not registered. Please add this wallet through the user management system first.'
    };
  }

  // Get current user's plan details
  fastify.get('/plan/:walletAddress', async (request, reply) => {
    try {
      const { walletAddress } = request.params as { walletAddress: string };

      const { data: user, error: userError } = await supabase
        .from('User')
        .select(`
          planId,
          trialStartDate,
          trialUsed
        `)
        .eq('walletAddress', walletAddress)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (userError) throw userError;

      if (!user) {
        return reply.status(404).send({ success: false, message: 'User not found' });
      }

      let planName = 'Free';
      
      if (user.planId) {
        const { data: plan } = await supabase
          .from('Plan')
          .select('name')
          .eq('id', user.planId)
          .single();

        if (plan) {
          planName = plan.name;
        }
      }

      return reply.send({
        success: true,
        planName,
        trialStartDate: user.trialStartDate,
        trialUsed: user.trialUsed,
      });
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to fetch plan',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  fastify.get('/all-wallets', async (request, reply) => {
    try {
      // This endpoint should have Premium plan validation
      const [primaryUsers, crossChainUsers] = await Promise.all([
        supabase
          .from('User')
          .select(`
            *,
            Plan!planId (name, queryLimit, userLimit)
          `)
          .order('createdAt', { ascending: false }),
        
        supabase
          .from('CrossChainIdentity')
          .select(`
            *,
            User!userId (
              id,
              planId,
              Plan!planId (name, queryLimit, userLimit)
            ),
            Blockchain!blockchainId (name, ubid)
          `)
          .order('createdAt', { ascending: false })
      ]);

      const result = {
        primaryUsers: primaryUsers.data || [],
        crossChainUsers: crossChainUsers.data || [],
        totalPrimary: primaryUsers.data?.length || 0,
        totalCrossChain: crossChainUsers.data?.length || 0
      };

      return reply.send({ 
        success: true, 
        data: result 
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to fetch all wallets',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
