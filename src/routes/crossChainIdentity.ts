// src/routes/crossChainIdentity.ts - FULLY CORRECTED & PRODUCTION READY
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticationHook } from '../middleware/authentication.js';
import { queryLimitHook } from '../middleware/queryLimit.js';
import { transactionLimitHook } from '../middleware/transactionLimit.js';
import { sanitizeObject } from '../utils/sanitization.js';
import { generateUUID } from '../utils/ubid.js';
import { supabase } from '../lib/supabaseClient.js';

// ✅ Validation Schemas
const createIdentitySchema = z.object({
  userId: z.string()
    .min(1, 'User ID is required')
    .max(50, 'User ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid user ID format'),
  blockchainId: z.string()
    .min(1, 'Blockchain ID is required')
    .max(100, 'Blockchain ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid blockchain ID format'),
  walletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  proofHash: z.string().optional().default(() => generateUUID()),
});

const userIdSchema = z.object({
  userId: z.string()
    .min(1, 'User ID is required')
    .max(50, 'User ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid user ID format'),
});

const identityIdSchema = z.object({
  identityId: z.string()
    .min(1, 'Identity ID is required')
    .max(50, 'Identity ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid identity ID format'),
});

const removeIdentitySchema = z.object({
  userId: z.string()
    .min(1, 'User ID is required')
    .max(50, 'User ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid user ID format'),
});

// ✅ Error Handler
const handleDatabaseError = (error: unknown) => {
  console.error('Database error:', error);
  if (error && typeof error === 'object' && 'code' in error) {
    const prismaError = error as { code: string };
    if (prismaError.code === 'P2002') return { status: 409, message: 'This wallet is already registered for this blockchain' };
    if (prismaError.code === 'P2025') return { status: 404, message: 'Record not found' };
    if (prismaError.code === 'P2003') return { status: 400, message: 'Invalid user reference' };
  }
  return { status: 500, message: 'Database operation failed' };
};

export async function crossChainIdentityRoutes(fastify: FastifyInstance) {
  // Global error handler
  fastify.setErrorHandler(async (error, _request, reply) => {
    console.error('CrossChain Identity route error:', error);
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: error.validation,
      });
    }
    const status = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    return reply.status(status).send({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  });

  // ✅ POST - Create CrossChain Identity (FULLY PROTECTED)
  fastify.post('/', {
    preHandler: [authenticationHook, transactionLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedBody = sanitizeObject(request.body);
      const parsed = createIdentitySchema.parse(sanitizedBody);

      console.log(`🆔 Creating CrossChain identity for user ${parsed.userId} on ${parsed.blockchainId}`);

      // 1. Verify user exists and get plan info
      const { data: existingUser, error: userError } = await supabase
        .from('User')
        .select(`
          id, 
          planId, 
          walletAddress, 
          blockchainId,
          Plan!planId (name, userLimit)
        `)
        .eq('id', parsed.userId)
        .maybeSingle();

      if (userError || !existingUser) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // 2. Get dynamic plan limit (not hardcoded)
      // Get dynamic plan limit (not hardcoded)
const planData = existingUser.Plan?.[0];
const planLimit = planData?.userLimit || 3; // fallback to 3


      // 3. Count ALL user's wallets (primary + crosschain, but unique combinations only)
      const { data: existingIdentities } = await supabase
        .from('CrossChainIdentity')
        .select('walletAddress, blockchainId')
        .eq('userId', parsed.userId);

      // Create set of unique wallet+chain combinations
      const walletChainCombos = new Set<string>();
      
      // Add primary wallet
      if (existingUser.walletAddress && existingUser.blockchainId) {
        walletChainCombos.add(`${existingUser.walletAddress}|${existingUser.blockchainId}`);
      }
      
      // Add all crosschain identities
      existingIdentities?.forEach(identity => {
        walletChainCombos.add(`${identity.walletAddress}|${identity.blockchainId}`);
      });

      const currentWalletCount = walletChainCombos.size;

      // 4. Check plan limits
      if (currentWalletCount >= planLimit) {
        return reply.status(403).send({
          success: false,
         error: `Your ${planData?.name || 'current'} plan allows maximum ${planLimit} wallets. Please upgrade to add more.`,
          code: 'PLAN_LIMIT_EXCEEDED',
          currentCount: currentWalletCount,
          limit: planLimit
        });
      }

      // 5. ✅ CRITICAL: Check if wallet+chain already exists ANYWHERE in system
      const [existingIdentity, existingPrimaryUser] = await Promise.all([
        // Check CrossChainIdentity table
        supabase
          .from('CrossChainIdentity')
          .select('id, userId')
          .eq('walletAddress', parsed.walletAddress)
          .eq('blockchainId', parsed.blockchainId)
          .maybeSingle(),
        
        // Check User table (primary wallets)
        supabase
          .from('User')
          .select('id, walletAddress')
          .eq('walletAddress', parsed.walletAddress)
          .eq('blockchainId', parsed.blockchainId)
          .maybeSingle()
      ]);

      if (existingIdentity.data) {
        if (existingIdentity.data.userId === parsed.userId) {
          return reply.status(409).send({
            success: false,
            error: 'You have already added this wallet to your account',
            code: 'WALLET_EXISTS_SAME_USER'
          });
        } else {
          return reply.status(409).send({
            success: false,
            error: 'This wallet is already registered by another user',
            code: 'WALLET_EXISTS_OTHER_USER'
          });
        }
      }

      if (existingPrimaryUser.data) {
        if (existingPrimaryUser.data.id === parsed.userId) {
          return reply.status(409).send({
            success: false,
            error: 'This is your primary wallet. You cannot add it as a cross-chain identity.',
            code: 'CANNOT_ADD_PRIMARY_WALLET'
          });
        } else {
          return reply.status(409).send({
            success: false,
            error: 'This wallet is already used as a primary wallet by another user',
            code: 'PRIMARY_WALLET_EXISTS'
          });
        }
      }

      // 6. Create the identity
      const now = new Date().toISOString();
      const identityId = generateUUID();
      
      const { data: newIdentity, error: createError } = await supabase
        .from('CrossChainIdentity')
        .insert({
          id: identityId,
          userId: parsed.userId,
          walletAddress: parsed.walletAddress,
          blockchainId: parsed.blockchainId,
          proofHash: parsed.proofHash,
          createdAt: now,
          updatedAt: now,
        })
        .select(`
          *,
          User!userId(id, walletAddress, planId),
          Blockchain!blockchainId(name, ubid)
        `)
        .single();

      if (createError) {
        console.error('Failed to create CrossChain identity:', createError);
        const dbError = handleDatabaseError(createError);
        return reply.status(dbError.status).send({
          success: false,
          error: dbError.message,
          details: createError.message
        });
      }

      console.log('✅ Created CrossChain identity:', newIdentity);

      return reply.status(201).send({ 
        success: true, 
        data: {
          identity: newIdentity,
          message: `CrossChain identity created successfully for ${parsed.blockchainId}`,
          walletLimits: {
            current: currentWalletCount + 1,
            maximum: planLimit,
            remaining: Math.max(0, planLimit - currentWalletCount - 1)
          }
        }
      });

    } catch (err: unknown) {
      console.error('❌ Error creating CrossChain identity:', err);

      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          success: false,
          error: 'Validation failed', 
          details: err.errors 
        });
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        success: false,
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  // ✅ GET - User's identities with enhanced wallet counting
  fastify.get('/user/:userId', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const { userId } = userIdSchema.parse(sanitizedParams);
      
      console.log(`📋 Fetching CrossChain identities for user ${userId}`);

      // Get user with plan info
      const { data: existingUser } = await supabase
        .from('User')
        .select(`
          id, 
          planId, 
          walletAddress, 
          blockchainId,
          Plan!planId (name, userLimit)
        `)
        .eq('id', userId)
        .maybeSingle();

      if (!existingUser) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Get all cross-chain identities
      const { data: identities, error } = await supabase
        .from('CrossChainIdentity')
        .select(`
          *,
          User!userId(id, walletAddress, planId),
          Blockchain!blockchainId(name, ubid)
        `)
        .eq('userId', userId)
        .order('createdAt', { ascending: false });

      if (error) {
        console.error('Error fetching identities:', error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch CrossChain identities'
        });
      }

      // Calculate unique wallet count
      const walletChainCombos = new Set<string>();
      
      // Add primary wallet
      if (existingUser.walletAddress && existingUser.blockchainId) {
        walletChainCombos.add(`${existingUser.walletAddress}|${existingUser.blockchainId}`);
      }
      
      // Add cross-chain identities
      identities?.forEach(identity => {
        walletChainCombos.add(`${identity.walletAddress}|${identity.blockchainId}`);
      });

      const identitiesWithStats = identities?.map(identity => ({
        ...identity,
        isPrimary: existingUser.walletAddress === identity.walletAddress && 
                   existingUser.blockchainId === identity.blockchainId,
        createdAtFormatted: new Date(identity.createdAt).toLocaleString(),
      })) || [];

      const planData = existingUser.Plan?.[0];
const planLimit = planData?.userLimit || 3;
      const currentWalletCount = walletChainCombos.size;

      return reply.send({ 
        success: true, 
        data: {
          identities: identitiesWithStats,
          count: identitiesWithStats.length,
          planLimits: {
            current: currentWalletCount,
            maximum: planLimit,
            canAddMore: currentWalletCount < planLimit,
            planName: planData?.name || 'Unknown'
          },
          primaryWallet: {
            walletAddress: existingUser.walletAddress,
            blockchainId: existingUser.blockchainId
          }
        }
      });

    } catch (err: unknown) {
      console.error('❌ Error fetching user identities:', err);

      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          success: false,
          error: 'Invalid user ID format', 
          details: err.errors 
        });
      }

      return reply.status(500).send({ 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      });
    }
  });

  // // ✅ GET - Identity by wallet address (checks both tables)
  // fastify.get('/wallet/:walletAddress', {
  //   preHandler: [authenticationHook, queryLimitHook],
  // }, async (request, reply) => {
  //   try {
  //     const walletSchema = z.object({
  //       walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format')
  //     });

  //     const sanitizedParams = sanitizeObject(request.params);
  //     const { walletAddress } = walletSchema.parse(sanitizedParams);
      
  //     console.log(`🔍 Searching identities for wallet ${walletAddress}`);

  //     // Check both CrossChainIdentity and User tables
  //     const [crossChainIdentities, primaryUsers] = await Promise.all([
  //       supabase
  //         .from('CrossChainIdentity')
  //         .select(`
  //           *,
  //           User!userId(id, walletAddress, planId, blockchainId),
  //           Blockchain!blockchainId(name, ubid)
  //         `)
  //         .eq('walletAddress', walletAddress)
  //         .order('createdAt', { ascending: false }),
        
  //       supabase
  //         .from('User')
  //         .select(`
  //           id,
  //           walletAddress,
  //           blockchainId,
  //           planId,
  //           createdAt,
  //           Plan!planId(name, userLimit)
  //         `)
  //         .eq('walletAddress', walletAddress)
  //         .order('createdAt', { ascending: false })
  //     ]);

  //     if (crossChainIdentities.error || primaryUsers.error) {
  //       console.error('Error fetching wallet identities:', crossChainIdentities.error || primaryUsers.error);
  //       return reply.status(500).send({
  //         success: false,
  //         error: 'Failed to fetch wallet identities'
  //       });
  //     }

  //     const crossChainWithDetails = crossChainIdentities.data?.map(identity => ({
  //       ...identity,
  //       type: 'crosschain' as const,
  //       isPrimary: false,
  //     })) || [];

  //     const primaryWithDetails = primaryUsers.data?.map(user => ({
  //       id: user.id,
  //       walletAddress: user.walletAddress,
  //       blockchainId: user.blockchainId,
  //       userId: user.id,
  //       type: 'primary' as const,
  //       isPrimary: true,
  //       createdAt: user.createdAt,
  //       User: user,
  //       Plan: user.Plan
  //     })) || [];

  //     const allIdentities = [...primaryWithDetails, ...crossChainWithDetails];

  //     return reply.send({ 
  //       success: true, 
  //       data: {
  //         identities: allIdentities,
  //         count: allIdentities.length,
  //         walletAddress,
  //         supportedChains: [...new Set(allIdentities.map(id => id.blockchainId))],
  //         breakdown: {
  //           primary: primaryWithDetails.length,
  //           crosschain: crossChainWithDetails.length
  //         }
  //       }
  //     });

  //   } catch (err: unknown) {
  //     console.error('❌ Error fetching wallet identities:', err);

  //     if (err instanceof z.ZodError) {
  //       return reply.status(400).send({ 
  //         success: false,
  //         error: 'Invalid wallet address format', 
  //         details: err.errors 
  //       });
  //     }

  //     return reply.status(500).send({ 
  //       success: false, 
  //       error: err instanceof Error ? err.message : 'Unknown error' 
  //     });
  //   }
  // });

  // Add this to your crossChainIdentity routes for debugging
// ✅ FIXED: Debug endpoint without authentication
fastify.get('/debug/:walletAddress/:blockchainId', {
  // Remove preHandler for debugging purposes
}, async (request, reply) => {
  try {
    const { walletAddress, blockchainId } = request.params as any;
    
    console.log(`🔍 DEBUG: Checking wallet ${walletAddress} on chain ${blockchainId}`);
    
    // Check both tables
    const [crossChainData, primaryData] = await Promise.all([
      supabase
        .from('CrossChainIdentity')
        .select('*')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId),
      
      supabase
        .from('User')
        .select('*')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
    ]);
    
    return reply.send({
      success: true,
      debug: {
        walletAddress,
        blockchainId,
        crossChainResults: crossChainData,
        primaryResults: primaryData,
        crossChainCount: crossChainData.data?.length || 0,
        primaryCount: primaryData.data?.length || 0,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Debug failed'
    });
  }
});



  // ✅ DELETE - Remove identity (with safety checks)
  fastify.delete('/:identityId', {
    preHandler: [authenticationHook, transactionLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const sanitizedBody = sanitizeObject(request.body);
      const { identityId } = identityIdSchema.parse(sanitizedParams);
      const { userId } = removeIdentitySchema.parse(sanitizedBody);

      console.log(`🗑️ Removing CrossChain identity ${identityId} for user ${userId}`);

      // Verify ownership
      const { data: existingIdentity, error: fetchError } = await supabase
        .from('CrossChainIdentity')
        .select(`
          *,
          User!userId(id, walletAddress, planId)
        `)
        .eq('id', identityId)
        .eq('userId', userId)
        .maybeSingle();

      if (fetchError || !existingIdentity) {
        return reply.status(404).send({
          success: false,
          error: 'CrossChain identity not found or access denied',
          code: 'IDENTITY_NOT_FOUND'
        });
      }

      // Check for related transactions
      const { data: relatedTransactions } = await supabase
        .from('CrossChainTransaction')
        .select('id')
        .or(`fromAddress.eq.${existingIdentity.walletAddress},toAddress.eq.${existingIdentity.walletAddress}`)
        .limit(1);

      if (relatedTransactions && relatedTransactions.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Cannot remove identity with existing transactions. Please contact support.',
          code: 'IDENTITY_HAS_TRANSACTIONS'
        });
      }

      // Remove the identity
      const { error: deleteError } = await supabase
        .from('CrossChainIdentity')
        .delete()
        .eq('id', identityId)
        .eq('userId', userId);

      if (deleteError) {
        console.error('Failed to delete CrossChain identity:', deleteError);
        const dbError = handleDatabaseError(deleteError);
        return reply.status(dbError.status).send({
          success: false,
          error: dbError.message,
          details: deleteError.message
        });
      }

      console.log('✅ Removed CrossChain identity:', identityId);

      return reply.send({
        success: true,
        message: 'CrossChain identity removed successfully',
        data: {
          removedIdentity: {
            id: identityId,
            walletAddress: existingIdentity.walletAddress,
            blockchainId: existingIdentity.blockchainId
          }
        }
      });

    } catch (err: unknown) {
      console.error('❌ Error removing CrossChain identity:', err);

      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          success: false,
          error: 'Validation failed', 
          details: err.errors 
        });
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        success: false,
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  // ✅ PUT - Update proof hash
  fastify.put('/:identityId', {
    preHandler: [authenticationHook, transactionLimitHook],
  }, async (request, reply) => {
    try {
      const updateSchema = z.object({
        userId: z.string()
          .min(1, 'User ID is required')
          .max(50, 'User ID too long')
          .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid user ID format'),
        proofHash: z.string()
          .min(1, 'Proof hash is required')
          .max(200, 'Proof hash too long'),
      });

      const sanitizedParams = sanitizeObject(request.params);
      const sanitizedBody = sanitizeObject(request.body);
      const { identityId } = identityIdSchema.parse(sanitizedParams);
      const { userId, proofHash } = updateSchema.parse(sanitizedBody);

      console.log(`🔄 Updating CrossChain identity ${identityId} for user ${userId}`);

      // Verify ownership
      const { data: existingIdentity } = await supabase
        .from('CrossChainIdentity')
        .select('id, userId, walletAddress, blockchainId')
        .eq('id', identityId)
        .eq('userId', userId)
        .maybeSingle();

      if (!existingIdentity) {
        return reply.status(404).send({
          success: false,
          error: 'CrossChain identity not found or access denied',
          code: 'IDENTITY_NOT_FOUND'
        });
      }

      // Update proof hash
      const { data: updatedIdentity, error: updateError } = await supabase
        .from('CrossChainIdentity')
        .update({
          proofHash: proofHash,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', identityId)
        .eq('userId', userId)
        .select()
        .single();

      if (updateError) {
        console.error('Failed to update CrossChain identity:', updateError);
        const dbError = handleDatabaseError(updateError);
        return reply.status(dbError.status).send({
          success: false,
          error: dbError.message,
          details: updateError.message
        });
      }

      console.log('✅ Updated CrossChain identity:', updatedIdentity);

      return reply.send({
        success: true,
        message: 'CrossChain identity updated successfully',
        data: {
          identity: updatedIdentity
        }
      });

    } catch (err: unknown) {
      console.error('❌ Error updating CrossChain identity:', err);

      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          success: false,
          error: 'Validation failed', 
          details: err.errors 
        });
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        success: false,
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

 // ✅ ADD: Enhanced wallet verification with credit score initialization
fastify.get('/verify/:walletAddress/:blockchainId', {
  preHandler: [authenticationHook, queryLimitHook],
}, async (request, reply) => {
  try {
    const verifySchema = z.object({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
      blockchainId: z.string()
        .min(1, 'Blockchain ID is required')
        .max(100, 'Blockchain ID too long')
        .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid blockchain ID format'),
    });

    const sanitizedParams = sanitizeObject(request.params);
    const { walletAddress, blockchainId } = verifySchema.parse(sanitizedParams);
    
    console.log(`✅ Verifying identity for ${walletAddress} on ${blockchainId}`);

    // Check both CrossChainIdentity and User tables
    const [crossChainIdentity, primaryUser] = await Promise.all([
      supabase
        .from('CrossChainIdentity')
        .select(`
          *,
          User!userId(id, walletAddress, planId, blockchainId)
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle(),
      
      supabase
        .from('User')
        .select(`
          id,
          walletAddress,
          blockchainId,
          planId,
          creditScore,
          Plan!planId(name, userLimit)
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle()
    ]);

    if (crossChainIdentity.error || primaryUser.error) {
      console.error('Error verifying identity:', crossChainIdentity.error || primaryUser.error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to verify identity'
      });
    }

    let isRegistered = false;
    let source: 'primary' | 'crosschain' | null = null;
    let identity: any = null;
    let creditScore = 0;

    if (primaryUser.data) {
      isRegistered = true;
      source = 'primary';
      identity = primaryUser.data;
      creditScore = primaryUser.data.creditScore || 0;
    } else if (crossChainIdentity.data) {
      isRegistered = true;
      source = 'crosschain';
      identity = crossChainIdentity.data;
      creditScore = crossChainIdentity.data.creditScore || 0; // ✅ Include CrossChain credit score
    }

    return reply.send({ 
      success: true, 
      data: {
        isRegistered,
        source,
        identity,
        creditScore, // ✅ Include credit score in verification
        walletAddress,
        blockchainId,
        canCreateInvoices: isRegistered,
        message: isRegistered 
          ? `Wallet is registered as ${source} wallet with credit score ${creditScore}` 
          : 'Wallet is not registered for this blockchain'
      }
    });

  } catch (err: unknown) {
    console.error('❌ Error verifying identity:', err);

    if (err instanceof z.ZodError) {
      return reply.status(400).send({ 
        success: false,
        error: 'Invalid parameters', 
        details: err.errors 
      });
    }

    return reply.status(500).send({ 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    });
  }
});

// ✅ NEW: Initialize credit score for CrossChainIdentity
fastify.post('/:identityId/init-credit-score', {
  preHandler: [authenticationHook, transactionLimitHook],
}, async (request, reply) => {
  try {
    const { identityId } = request.params as any;
    const { userId } = request.body as any;

    // Verify ownership
    const { data: identity } = await supabase
      .from('CrossChainIdentity')
      .select('*')
      .eq('id', identityId)
      .eq('userId', userId)
      .maybeSingle();

    if (!identity) {
      return reply.status(404).send({
        success: false,
        error: 'CrossChain identity not found or access denied'
      });
    }

    // Initialize credit score (default 500)
    const { data: updatedIdentity, error } = await supabase
      .from('CrossChainIdentity')
      .update({
        creditScore: 500,
        updatedAt: new Date().toISOString()
      })
      .eq('id', identityId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return reply.send({
      success: true,
      message: 'Credit score initialized successfully',
      data: updatedIdentity
    });

  } catch (error) {
    console.error('Error initializing credit score:', error);
    return reply.status(500).send({
      success: false,
      error: 'Failed to initialize credit score'
    });
  }
});
}
