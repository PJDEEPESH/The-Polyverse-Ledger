// src/routes/crossChainTransaction.ts - COMPLETE IMPLEMENTATION
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CrossChainTransactionService } from '../services/crossChainTransaction.js';
import { checkUserPlanLimits } from '../utils/checkUserPlanLimits.js';

const createTransactionSchema = z.object({
  userId: z.string().uuid(),
  sourceBlockchainId: z.string().min(1),
  destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.number().positive().max(10000000), // Max $10M
  assetType: z.string().min(1).max(50),
  proofHash: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  userId: z.string().uuid().optional(),
});

export async function crossChainTransactionRoutes(fastify: FastifyInstance) {
  
  // ✅ Create new cross-chain transaction
  fastify.post('/', async (request, reply) => {
    try {
      const parsed = createTransactionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const { userId, sourceBlockchainId, destinationAddress, amount, assetType, proofHash } = parsed.data;

      console.log(`🔄 Creating cross-chain transaction: $${amount} ${assetType} for user ${userId}`);

      const newTransaction = await CrossChainTransactionService.createTransaction(
        userId,
        sourceBlockchainId,
        destinationAddress,
        amount,
        assetType,
        proofHash
      );

      return reply.send({ 
        success: true, 
        transaction: newTransaction,
        message: 'Cross-chain transaction created successfully'
      });

    } catch (error) {
      console.error('Transaction creation error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let statusCode = 500;
      let errorCode = 'TRANSACTION_FAILED';
      
      // Handle specific error types
      if (errorMessage.includes('plan does not support')) {
        statusCode = 403;
        errorCode = 'PLAN_RESTRICTION';
      } else if (errorMessage.includes('exceeds') && errorMessage.includes('limit')) {
        statusCode = 403;
        errorCode = 'AMOUNT_LIMIT_EXCEEDED';
      } else if (errorMessage.includes('do not have access')) {
        statusCode = 403;
        errorCode = 'BLOCKCHAIN_ACCESS_DENIED';
      } else if (errorMessage.includes('not found')) {
        statusCode = 404;
        errorCode = 'RESOURCE_NOT_FOUND';
      }
      
      return reply.status(statusCode).send({ 
        success: false, 
        error: errorMessage,
        code: errorCode
      });
    }
  });

  // ✅ Get user's transaction history
  fastify.get('/user/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const { limit = '50', status, assetType } = request.query as { 
        limit?: string; 
        status?: string; 
        assetType?: string; 
      };

      console.log(`📋 Fetching transactions for user ${userId}`);

      // Validate user exists and get plan info
      const planInfo = await checkUserPlanLimits(userId);
      if (!planInfo) {
        return reply.status(404).send({
          success: false,
          error: 'User not found'
        });
      }

      const transactions = await CrossChainTransactionService.getUserTransactions(
        userId, 
        parseInt(limit)
      );

      // Apply filters if provided
      let filteredTransactions = transactions;
      if (status) {
        filteredTransactions = transactions.filter(tx => tx.status === status);
      }
      if (assetType) {
        filteredTransactions = filteredTransactions.filter(tx => tx.assetType === assetType);
      }

      return reply.send({ 
        success: true, 
        data: filteredTransactions,
        count: filteredTransactions.length,
        planInfo: {
          planName: planInfo.planName,
          transactionLimit: planInfo.txnLimit
        }
      });

    } catch (error) {
      console.error('Get transactions error:', error);
      return reply.status(500).send({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch transactions' 
      });
    }
  });

  // ✅ Get monthly transaction summary
  fastify.get('/user/:userId/monthly-summary', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      console.log(`📊 Fetching monthly summary for user ${userId}`);

      // Validate user exists
      const planInfo = await checkUserPlanLimits(userId);
      if (!planInfo) {
        return reply.status(404).send({
          success: false,
          error: 'User not found'
        });
      }

      const summary = await CrossChainTransactionService.getMonthlyTransactionSummary(userId);

      // Calculate remaining limit for Pro plan
      let remainingLimit = null;
      if (planInfo.txnLimit !== null) {
        remainingLimit = planInfo.txnLimit - summary.totalAmount;
      }

      return reply.send({ 
        success: true, 
        data: {
          ...summary,
          planName: planInfo.planName,
          monthlyLimit: planInfo.txnLimit,
          remainingLimit,
          limitUtilization: planInfo.txnLimit ? (summary.totalAmount / planInfo.txnLimit * 100).toFixed(2) + '%' : 'Unlimited'
        }
      });

    } catch (error) {
      console.error('Get monthly summary error:', error);
      return reply.status(500).send({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch summary' 
      });
    }
  });

  // ✅ Update transaction status
  fastify.patch('/:transactionId/status', async (request, reply) => {
    try {
      const { transactionId } = request.params as { transactionId: string };
      const parsed = updateStatusSchema.safeParse(request.body);
      
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          issues: parsed.error.issues,
        });
      }

      const { status, userId } = parsed.data;

      console.log(`🔄 Updating transaction ${transactionId} status to ${status}`);

      const updatedTransaction = await CrossChainTransactionService.updateTransactionStatus(
        transactionId, 
        status, 
        userId
      );

      return reply.send({ 
        success: true, 
        transaction: updatedTransaction,
        message: `Transaction status updated to ${status}`
      });

    } catch (error) {
      console.error('Update transaction status error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let statusCode = 500;
      
      if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
        statusCode = 404;
      }
      
      return reply.status(statusCode).send({ 
        success: false, 
        error: errorMessage 
      });
    }
  });

  // ✅ Get single transaction details
  fastify.get('/:transactionId', async (request, reply) => {
    try {
      const { transactionId } = request.params as { transactionId: string };
      const { userId } = request.query as { userId?: string };

      console.log(`🔍 Fetching transaction ${transactionId}`);

      const transaction = await CrossChainTransactionService.getTransactionById(transactionId, userId);

      if (!transaction) {
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
      console.error('Get transaction error:', error);
      return reply.status(500).send({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch transaction' 
      });
    }
  });

  // ✅ Cancel pending transaction
  fastify.post('/:transactionId/cancel', async (request, reply) => {
    try {
      const { transactionId } = request.params as { transactionId: string };
      const { userId } = request.body as { userId: string };

      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: 'userId is required'
        });
      }

      console.log(`❌ Cancelling transaction ${transactionId} for user ${userId}`);

      const cancelledTransaction = await CrossChainTransactionService.cancelTransaction(
        transactionId, 
        userId
      );

      return reply.send({ 
        success: true, 
        transaction: cancelledTransaction,
        message: 'Transaction cancelled successfully'
      });

    } catch (error) {
      console.error('Cancel transaction error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let statusCode = 500;
      
      if (errorMessage.includes('not found') || errorMessage.includes('access denied')) {
        statusCode = 404;
      } else if (errorMessage.includes('cannot cancel')) {
        statusCode = 400;
      }
      
      return reply.status(statusCode).send({ 
        success: false, 
        error: errorMessage 
      });
    }
  });

  // ✅ Get transaction statistics
  fastify.get('/stats/overview', async (request, reply) => {
    try {
      const { userId } = request.query as { userId?: string };

      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: 'userId query parameter is required'
        });
      }

      console.log(`📈 Fetching transaction stats for user ${userId}`);

      const stats = await CrossChainTransactionService.getTransactionStats(userId);

      return reply.send({ 
        success: true, 
        data: stats 
      });

    } catch (error) {
      console.error('Get transaction stats error:', error);
      return reply.status(500).send({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch stats' 
      });
    }
  });

  // ✅ Health check for transaction service
  fastify.get('/health', async (_, reply) => {
    return reply.send({
      status: 'ok',
      service: 'CrossChainTransaction',
      timestamp: new Date().toISOString(),
    });
  });
}
