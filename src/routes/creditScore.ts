//src/routes/creditScore.ts - PRODUCTION VERSION: Fixed duplicate routes and CrossChainIdentity support
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

// ✅ Enhanced wallet credit score finder with CrossChain support
async function findWalletCreditScore(walletAddress: string, blockchainId: string): Promise<{
  found: boolean;
  userId?: string;
  creditScore?: number;
  source?: 'primary' | 'crosschain';
  crossChainIdentityId?: string;
  error?: string;
}> {
  try {
    // ✅ Check primary wallet using Prisma (more efficient)
    const primaryUser = await prisma.user.findUnique({
      where: {
        blockchainId_walletAddress: {
          blockchainId,
          walletAddress
        }
      },
      select: {
        id: true,
        creditScore: true
      }
    });

    if (primaryUser) {
      return {
        found: true,
        userId: primaryUser.id,
        creditScore: primaryUser.creditScore,
        source: 'primary'
      };
    }

    // ✅ Check CrossChainIdentity using Prisma
    const crossChainIdentity = await prisma.crossChainIdentity.findUnique({
      where: {
        blockchainId_walletAddress: {
          blockchainId,
          walletAddress
        }
      },
      include: {
        user: {
          select: { id: true }
        }
      }
    });

    if (crossChainIdentity && crossChainIdentity.user) {
      return {
        found: true,
        userId: crossChainIdentity.userId,
        creditScore: crossChainIdentity.creditScore,
        source: 'crosschain',
        crossChainIdentityId: crossChainIdentity.id
      };
    }

    return {
      found: false,
      error: 'Wallet not found in system'
    };
    
  } catch (error) {
    return {
      found: false,
      error: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

export async function creditScoreRoutes(fastify: FastifyInstance) {
  
  // Global error handler
  fastify.setErrorHandler(async (error, request, reply) => {
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

  // ✅ GET /api/v1/credit-score/crosschain/:crossChainIdentityId
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

  // ✅ GET /api/v1/credit-score/wallet/:walletAddress/:blockchainId
  fastify.get('/wallet/:walletAddress/:blockchainId', {
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

      // ✅ First check primary wallet (User table)
      const primaryUser = await prisma.user.findUnique({
        where: {
          blockchainId_walletAddress: {
            blockchainId,
            walletAddress
          }
        },
        select: {
          id: true,
          creditScore: true,
          walletAddress: true,
          blockchainId: true
        }
      });

      if (primaryUser) {
        const freshScore = await CreditScoreService.calculateScore(primaryUser.id);
        
        return reply.send({ 
          success: true, 
          userId: primaryUser.id,
          creditScore: freshScore,
          source: 'primary',
          walletAddress,
          blockchainId
        });
      }

      // ✅ Check CrossChainIdentity table
      const crossChainIdentity = await prisma.crossChainIdentity.findUnique({
        where: {
          blockchainId_walletAddress: {
            blockchainId,
            walletAddress
          }
        },
        include: {
          user: {
            select: { id: true }
          }
        }
      });

      if (crossChainIdentity) {
        // Calculate fresh CrossChain score
        const freshScore = await CreditScoreService.calculateCrossChainScore(crossChainIdentity.id);
        
        return reply.send({ 
          success: true, 
          userId: crossChainIdentity.userId,
          crossChainIdentityId: crossChainIdentity.id,
          creditScore: freshScore,
          source: 'crosschain',
          walletAddress,
          blockchainId
        });
      }

      // ✅ Wallet not found in either table
      return reply.status(404).send({
        success: false,
        error: 'Wallet not found in system',
        code: 'WALLET_NOT_FOUND',
        walletAddress,
        blockchainId
      });

    } catch (error) {
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

  // ✅ GET /api/v1/credit-score/user/:userId/all
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
