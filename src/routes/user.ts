// src/routes/user.ts - SIMPLIFIED WITHOUT ORGANIZATION
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID, generateAPIKey } from '../utils/ubid.js';
import { walletValidationHook } from '../middleware/validateWallet.js';
import { queryLimitHook } from '../middleware/queryLimit.js';
import { isTrialActive } from '../utils/isTrialActive.js';
import { checkUserPlanLimits, canAddWalletToUser } from '../utils/checkUserPlanLimits.js';

const createUserSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  metadataURI: z.string().min(1).max(500),
  blockchainId: z.string().min(1),
});

const addWalletSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  blockchainId: z.string().min(1),
  metadataURI: z.string().min(1).max(500),
  userId: z.string().min(1),
});

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
      console.error('Fetch all users error:', error);
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
      const { walletAddress, metadataURI, blockchainId } = parsed.data;

      // 1. Prevent if this wallet is already primary OR crosschain on this or another user
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
      if (primaryUser.data || crossChainUser.data) {
        return reply.status(409).send({ error: 'This wallet is already registered as a user or cross-chain identity' });
      }

      // 2. Check or create blockchain
      const { data: existingChain } = await supabase
        .from('Blockchain')
        .select('*')
        .eq('id', blockchainId)
        .maybeSingle();
      const now = new Date().toISOString();
      const ubid = existingChain?.ubid || generateUUID();
      const apiKey = existingChain?.apiKey || generateAPIKey();
      const networkType = existingChain?.networkType || 'custom';
      const chainProtocol = existingChain?.chainProtocol || 'custom';
      const bnsName = existingChain?.bnsName || null;

      const { error: blockchainError } = await supabase
        .from('Blockchain')
        .upsert({
          id: blockchainId,
          name: `Chain ${blockchainId}`,
          ubid,
          apiKey,
          networkType,
          chainProtocol,
          bnsName,
          createdAt: existingChain?.createdAt || now,
          updatedAt: now,
        }, { onConflict: 'id' });
      if (blockchainError) throw blockchainError;

      // 3. Get Free Plan for default
      const { data: freePlan, error: planError } = await supabase
        .from("Plan").select("id").eq("name", "Free").single();
      if (planError || !freePlan) throw new Error('❌ Free plan not found in Supabase');

      // 4. (Should never exist) Check if user exists (shouldn't happen, defense in depth)
      const { data: existingUser } = await supabase
        .from('User')
        .select('*')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

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

      // CREATE user!
      const { data: user, error } = await supabase
        .from('User')
        .upsert(userData)
        .select(`*, Plan!planId (name, queryLimit, userLimit)`)
        .single();
      if (error) throw error;

      return reply.send({
        success: true,
        data: user,
        message: 'User registered',
      });
    } catch (error) {
      console.error('Registration error:', error);
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

      const { walletAddress, blockchainId, metadataURI, userId } = parsed.data;
      if (!userId) return reply.status(400).send({ error: 'userId is required' });

      // 1. Plan/user wallet limit check
      const canAdd = await canAddWalletToUser(userId, walletAddress, blockchainId);
      if (!canAdd.canAdd) {
        return reply.status(403).send({
          error: canAdd.reason,
          code: 'WALLET_LIMIT_EXCEEDED',
          wouldCount: canAdd.wouldCount,
        });
      }

      // 2. Ensure wallet not taken by anyone (again, belt and suspenders)
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

      // 3. Ensure blockchain exists
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
            name: `Chain ${blockchainId}`,
            ubid: generateUUID(),
            apiKey: generateAPIKey(),
            networkType: 'custom',
            chainProtocol: 'custom',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, { onConflict: 'id' });
        if (blockchainError) {
          console.error('Failed to create blockchain:', blockchainError);
          throw new Error('Failed to create blockchain entry');
        }
      }

      // 4. Insert CrossChainIdentity
      const now = new Date().toISOString();
      const { data: crossChainIdentity, error: crossChainError } = await supabase
        .from('CrossChainIdentity')
        .insert({
          id: generateUUID(),
          userId,
          blockchainId,
          walletAddress,
          proofHash: generateUUID(), // TODO: Use a real proof one day!
          createdAt: now,
          updatedAt: now,
        })
        .select(`*, blockchain:Blockchain!blockchainId(name, ubid)`)
        .single();
      if (crossChainError) {
        console.error('CrossChain identity creation error:', crossChainError);
        throw crossChainError;
      }
      return reply.send({
        success: true,
        data: crossChainIdentity,
        message: 'Wallet added successfully',
        countsTowardLimit: canAdd.wouldCount,
      });
    } catch (error) {
      console.error('Add wallet error:', error);
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
      console.error('Get wallet limits error:', error);
      return reply.status(500).send({
        error: 'Failed to get wallet limits',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get user by wallet and chain
  // fastify.get('/wallet/:walletAddress/:blockchainId', async (request, reply) => {
  //   try {
  //     const { walletAddress, blockchainId } = request.params as {
  //       walletAddress: string;
  //       blockchainId: string;
  //     };

  //     if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
  //       return reply.status(400).send({ error: 'Invalid wallet address' });
  //     }

  //     const { data: user, error: userError } = await supabase
  //       .from('User')
  //       .select('*')
  //       .eq('walletAddress', walletAddress)
  //       .eq('blockchainId', blockchainId)
  //       .maybeSingle();

  //     if (userError) throw userError;

  //     if (!user) {
  //       return reply.status(404).send({
  //         success: false,
  //         error: 'User not found',
  //       });
  //     }

  //     // Get plan data
  //     let planData = null;
  //     if (user.planId) {
  //       const { data: plan, error: planError } = await supabase
  //         .from('Plan')
  //         .select('name, queryLimit, userLimit, txnLimit')
  //         .eq('id', user.planId)
  //         .single();

  //       if (!planError) {
  //         planData = plan;
  //       }
  //     }

  //     // Get query usage
  //     let queriesUsed = 0;
  //     const { data: usage, error: usageError } = await supabase
  //       .from('QueryUsage')
  //       .select('used')
  //       .eq('userId', user.id)
  //       .maybeSingle();

  //     if (!usageError && usage) {
  //       queriesUsed = usage.used;
  //     }

  //     const userWithLimits = {
  //       ...user,
  //       Plan: planData,
  //       queriesLimit: planData?.queryLimit || 100,
  //       queriesUsed,
  //       userLimit: planData?.userLimit || 1,
  //       planName: planData?.name || 'Free',
  //     };

  //     return reply.send({ success: true, data: userWithLimits });

  //   } catch (error) {
  //     console.error('Fetch error:', error);
  //     return reply.status(500).send({
  //       error: 'Failed to fetch user',
  //       details: error instanceof Error ? error.message : String(error),
  //     });
  //   }
  // });

// ✅ CORRECTED: Enhanced /wallet/:walletAddress/:blockchainId endpoint
fastify.get('/wallet/:walletAddress/:blockchainId', {
  preHandler: [walletValidationHook, queryLimitHook],
}, async (request, reply) => {
  try {
    const { walletAddress, blockchainId } = request.params as any;
    
    console.log(`🔍 Looking for user by wallet: ${walletAddress} on chain: ${blockchainId}`);
    
    // Check primary wallet (User table) with plan info
    const { data: primaryUser, error: primaryError } = await supabase
      .from('User')
      .select(`
        *,
        Plan!planId (name, queryLimit, userLimit, txnLimit)
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (primaryError) {
      console.error('Primary user query error:', primaryError);
    }

    if (primaryUser) {
      // Get query usage for primary user
      const { data: usage } = await supabase
        .from('QueryUsage')
        .select('used')
        .eq('userId', primaryUser.id)
        .maybeSingle();

      const planData = primaryUser.Plan?.[0];
      
      return reply.send({
        success: true,
        data: {
          ...primaryUser,
          source: 'primary',
          planName: planData?.name || 'Free',
          queriesLimit: planData?.queryLimit || 100,
          queriesUsed: usage?.used || 0,
          userLimit: planData?.userLimit || 1,
          txnLimit: planData?.txnLimit || 10
        }
      });
    }

    // Check CrossChainIdentity table with user and plan info
    const { data: crossChainUser, error: crossChainError } = await supabase
      .from('CrossChainIdentity')
      .select(`
        *,
        User!userId(
          id,
          planId,
          Plan!planId(name, queryLimit, userLimit, txnLimit)
        )
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (crossChainError) {
      console.error('CrossChain user query error:', crossChainError);
    }

    if (crossChainUser && crossChainUser.User) {
      const userData = Array.isArray(crossChainUser.User) ? crossChainUser.User[0] : crossChainUser.User;
      const planData = userData.Plan?.[0];
      
      // Get query usage for the main user (shared across all wallets)
      const { data: usage } = await supabase
        .from('QueryUsage')
        .select('used')
        .eq('userId', userData.id)
        .maybeSingle();

      return reply.send({
        success: true,
        data: {
          ...crossChainUser,
          source: 'crosschain',
          planName: planData?.name || 'Free',
          queriesLimit: planData?.queryLimit || 100,
          queriesUsed: usage?.used || 0,
          userLimit: planData?.userLimit || 1,
          txnLimit: planData?.txnLimit || 10,
          // Include main user info for plan limits (shared)
          mainUserId: userData.id,
          planId: userData.planId
        }
      });
    }

    return reply.status(404).send({
      success: false,
      error: 'Wallet not found',
      code: 'WALLET_NOT_FOUND'
    });

  } catch (error) {
    console.error('Error finding user by wallet:', error);
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
      console.error('Update plan error:', error);
      return reply.status(500).send({
        error: 'Failed to update plan',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

 // ✅ CORRECTED: Enhanced credit score route that supports CrossChainIdentity
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

    // ✅ FIXED: Check both primary and crosschain users
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

    if (primaryError) {
      console.error('Primary user query error:', primaryError);
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
            trialStartDate,
            trialUsed,
            planId
          )
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (crossChainError) {
        console.error('CrossChain user query error:', crossChainError);
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
    console.error('Fetch credit score error:', error);
    return reply.status(500).send({
      error: 'Failed to fetch credit score',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

 // ✅ NEW: Enhanced exists route that checks both tables
fastify.get('/exists/:walletAddress/:blockchainId', {
  preHandler: [walletValidationHook]
}, async (request, reply) => {
  try {
    const { walletAddress, blockchainId } = request.params as {
      walletAddress: string;
      blockchainId: string;
    };

    if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return reply.status(400).send({ error: 'Invalid wallet address' });
    }

    // Check both primary and crosschain
    const [primaryUser, crossChainUser] = await Promise.all([
      supabase
        .from('User')
        .select('id, walletAddress, metadataURI, createdAt, planId')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle(),
      
      supabase
        .from('CrossChainIdentity')
        .select(`
          id, 
          walletAddress, 
          createdAt,
          User!userId(id, planId, metadataURI)
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle()
    ]);

    let user = null;
    let source = null;

    if (primaryUser.data) {
      user = primaryUser.data;
      source = 'primary';
    } else if (crossChainUser.data) {
      const userData = Array.isArray(crossChainUser.data.User) ? crossChainUser.data.User[0] : crossChainUser.data.User;
      user = {
        ...crossChainUser.data,
        planId: userData?.planId,
        metadataURI: userData?.metadataURI
      };
      source = 'crosschain';
    }

    return reply.send({
      success: true,
      exists: !!user,
      source: source,
      data: user || null,
    });

  } catch (error) {
    console.error('Check error:', error);
    return reply.status(500).send({
      error: 'Failed to check user',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

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
      console.error('Plan fetch error:', error);
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
    console.error('Fetch all wallets error:', error);
    return reply.status(500).send({
      error: 'Failed to fetch all wallets',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
}
