//src/routes/creditScore.ts - CORRECTED: Fixed duplicate routes and CrossChainIdentity support
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreditScoreService } from '../services/creditScore.js';
import { walletValidationHook } from '../middleware/validateWallet.js';
import { queryLimitHook } from '../middleware/queryLimit.js';
import { authenticationHook } from '../middleware/authentication.js';
import { sanitizeObject } from '../utils/sanitization.js';
import { supabase } from '../lib/supabaseClient.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ✅ Validation schemas
const userIdSchema = z.object({
  userId: z.string()
    .min(1, 'User ID is required')
    .max(50, 'User ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid user ID format'),
});

const crossChainIdSchema = z.object({
  crossChainIdentityId: z.string()
    .min(1, 'CrossChain Identity ID is required')
    .max(50, 'CrossChain Identity ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid CrossChain Identity ID format'),
});

const walletParamsSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  blockchainId: z.string()
    .min(1, 'Blockchain ID is required')
    .max(100, 'Blockchain ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid blockchain ID format'),
});

// ✅ ADD THIS FUNCTION to your creditScore.ts
async function findWalletCreditScore(walletAddress: string, blockchainId: string): Promise<{
  found: boolean;
  userId?: string;
  creditScore?: number;
  source?: 'primary' | 'crosschain';
  crossChainIdentityId?: string;
  error?: string;
}> {
  try {
    console.log(`🔍 DEBUG: Looking for wallet ${walletAddress} on chain ${blockchainId}`);
    
    // Check primary wallet (User table)
    const { data: primaryUser, error: primaryError } = await supabase
      .from('User')
      .select('id, creditScore')
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    console.log('🔍 Primary user check:', { data: primaryUser, error: primaryError });

    if (primaryUser) {
      return {
        found: true,
        userId: primaryUser.id,
        creditScore: primaryUser.creditScore,
        source: 'primary'
      };
    }

    // ✅ CRITICAL: Check CrossChainIdentity table
    const { data: crossChainUser, error: crossChainError } = await supabase
      .from('CrossChainIdentity')
      .select(`
        id,
        userId,
        creditScore,
        User!userId(id)
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    console.log('🔍 CrossChain user check:', { data: crossChainUser, error: crossChainError });

    if (crossChainUser && crossChainUser.User) {
      return {
        found: true,
        userId: crossChainUser.userId,
        creditScore: crossChainUser.creditScore,
        source: 'crosschain',
        crossChainIdentityId: crossChainUser.id
      };
    }

    // If we get here, wallet not found
    console.log('❌ Wallet not found in either table');
    return {
      found: false,
      error: 'Wallet not found in system'
    };
    
  } catch (error) {
    console.error('❌ Error in findWalletCreditScore:', error);
    return {
      found: false,
      error: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}


export async function creditScoreRoutes(fastify: FastifyInstance) {
  
  // Global error handler
  fastify.setErrorHandler(async (error, request, reply) => {
    console.error('Credit score route error:', error);
    
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

  // ✅ GET /api/v1/credit-score/:userId - Get credit score for primary User
  fastify.get('/:userId', {
    preHandler: [authenticationHook, queryLimitHook],
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const { userId } = userIdSchema.parse(sanitizedParams);

      console.log(`📊 Getting credit score for primary user: ${userId}`);

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          creditScore: true,
          walletAddress: true,
          blockchainId: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Calculate fresh score
      const score = await CreditScoreService.calculateScore(userId);

      return reply.send({ 
        success: true, 
        userId, 
        creditScore: score,
        source: 'primary',
        walletAddress: user.walletAddress,
        blockchainId: user.blockchainId
      });
    } catch (error) {
      console.error('Primary user credit score fetch error:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid user ID format',
          details: error.errors
        });
      }

      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ✅ NEW: GET /api/v1/credit-score/crosschain/:crossChainIdentityId
  fastify.get('/crosschain/:crossChainIdentityId', {
    preHandler: [authenticationHook, queryLimitHook],
    schema: {
      params: {
        type: 'object',
        required: ['crossChainIdentityId'],
        properties: {
          crossChainIdentityId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const { crossChainIdentityId } = crossChainIdSchema.parse(sanitizedParams);

      console.log(`📊 Getting credit score for CrossChainIdentity: ${crossChainIdentityId}`);

      // Check if CrossChainIdentity exists
      const { data: crossChainIdentity } = await supabase
        .from('CrossChainIdentity')
        .select(`
          id,
          userId,
          creditScore,
          walletAddress,
          blockchainId,
          User!userId(id, walletAddress, blockchainId)
        `)
        .eq('id', crossChainIdentityId)
        .maybeSingle();

      if (!crossChainIdentity) {
        return reply.status(404).send({
          success: false,
          error: 'CrossChainIdentity not found',
          code: 'CROSSCHAIN_IDENTITY_NOT_FOUND'
        });
      }

      // Calculate fresh score for this CrossChainIdentity
      const score = await CreditScoreService.calculateCrossChainScore(crossChainIdentityId);

      return reply.send({ 
        success: true, 
        crossChainIdentityId,
        userId: crossChainIdentity.userId,
        creditScore: score,
        source: 'crosschain',
        walletAddress: crossChainIdentity.walletAddress,
        blockchainId: crossChainIdentity.blockchainId
      });
    } catch (error) {
      console.error('CrossChain credit score fetch error:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid CrossChain Identity ID format',
          details: error.errors
        });
      }

      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ✅ FIXED: Single wallet endpoint (removed duplicate)
  // ✅ ADD THIS ROUTE to your creditScore.ts
fastify.get('/wallet/:walletAddress/:blockchainId', {
  // preHandler: [authenticationHook, walletValidationHook, queryLimitHook],
  schema: {
    params: {
      type: 'object',
      required: ['walletAddress', 'blockchainId'],
      properties: {
        walletAddress: { type: 'string' },
        blockchainId: { type: 'string' },
      },
    },
  },
}, async (request, reply) => {
  try {
    const sanitizedParams = sanitizeObject(request.params);
    const { walletAddress, blockchainId } = walletParamsSchema.parse(sanitizedParams);

    console.log(`📊 Getting credit score for wallet: ${walletAddress} on ${blockchainId}`);

    const walletInfo = await findWalletCreditScore(walletAddress, blockchainId);

    if (!walletInfo.found) {
      console.log(`❌ Wallet not found: ${walletAddress}/${blockchainId}`);
      return reply.status(404).send({
        success: false,
        error: walletInfo.error || 'Wallet not found',
        code: 'WALLET_NOT_FOUND'
      });
    }

    console.log(`✅ Found wallet: ${JSON.stringify(walletInfo)}`);

    // Recalculate score based on wallet type
    let freshScore: number;
    if (walletInfo.source === 'primary') {
      freshScore = await CreditScoreService.calculateScore(walletInfo.userId!);
    } else {
      // For CrossChainIdentity, use the stored credit score for now
      // You can implement calculateCrossChainScore later
      freshScore = walletInfo.creditScore || 500;
    }

    return reply.send({ 
      success: true, 
      userId: walletInfo.userId,
      crossChainIdentityId: walletInfo.crossChainIdentityId,
      creditScore: freshScore,
      source: walletInfo.source,
      walletAddress,
      blockchainId
    });
  } catch (error) {
    console.error('Wallet credit score fetch error:', error);
    
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid wallet address or blockchain ID format',
        details: error.errors
      });
    }

    return reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});



  // ✅ NEW: GET /api/v1/credit-score/user/:userId/all
  fastify.get('/user/:userId/all', {
    preHandler: [authenticationHook, queryLimitHook],
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const { userId } = userIdSchema.parse(sanitizedParams);

      console.log(`📊 Getting all credit scores for user: ${userId}`);

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          creditScore: true,
          walletAddress: true,
          blockchainId: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Get primary wallet score
      const primaryScore = await CreditScoreService.calculateScore(userId);

      // Get all CrossChainIdentities for this user
      const { data: crossChainIdentities } = await supabase
        .from('CrossChainIdentity')
        .select(`
          id,
          creditScore,
          walletAddress,
          blockchainId
        `)
        .eq('userId', userId);

      // Calculate fresh scores for all CrossChainIdentities
      const crossChainScores = await Promise.all(
        (crossChainIdentities || []).map(async (identity) => {
          const freshScore = await CreditScoreService.calculateCrossChainScore(identity.id);
          return {
            crossChainIdentityId: identity.id,
            creditScore: freshScore,
            walletAddress: identity.walletAddress,
            blockchainId: identity.blockchainId,
            source: 'crosschain' as const
          };
        })
      );

      return reply.send({ 
        success: true, 
        userId,
        primaryWallet: {
          creditScore: primaryScore,
          walletAddress: user.walletAddress,
          blockchainId: user.blockchainId,
          source: 'primary' as const
        },
        crossChainWallets: crossChainScores,
        totalWallets: 1 + crossChainScores.length
      });
    } catch (error) {
      console.error('All credit scores fetch error:', error);
      
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid user ID format',
          details: error.errors
        });
      }

      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
