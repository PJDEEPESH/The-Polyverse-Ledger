// src/services/crossChainTransaction.ts - COMPLETE CORRECTED VERSION
import { supabase } from '../lib/supabaseClient.js';
import { CreditScoreService } from './creditScore.js';
import { checkUserPlanLimits } from '../utils/checkUserPlanLimits.js';
import { generateUUID } from '../utils/ubid.js';

// ✅ Plan-based transaction limits
const PLAN_TRANSACTION_LIMITS = {
  'Free': 0, // No transactions allowed
  'Basic': 0, // No transactions allowed
  'Pro': 20000, // $20K limit
  'Premium': null // Unlimited
};

// ✅ Type definitions for better TypeScript support
interface TransactionData {
  amount: number;
  status: string;
  assetType: string;
  createdAt?: string;
}

interface AssetTypeStats {
  count: number;
  totalAmount: number;
}

export class CrossChainTransactionService {
  
  // ✅ Create transaction with plan validation
  static async createTransaction(
    userId: string,
    sourceBlockchainId: string,
    destinationAddress: string,
    amount: number,
    assetType: string,
    proofHash?: string
  ) {
    try {
      // Check user plan and transaction limits
      const planInfo = await checkUserPlanLimits(userId);
      
      if (!planInfo) {
        throw new Error('User plan not found');
      }

      const txnLimit = PLAN_TRANSACTION_LIMITS[planInfo.planName as keyof typeof PLAN_TRANSACTION_LIMITS];
      
      if (txnLimit === 0) {
        throw new Error(`${planInfo.planName} plan does not support cross-chain transactions. Upgrade to Pro or Premium.`);
      }

      if (txnLimit !== null && amount > txnLimit) {
        throw new Error(`Transaction amount $${amount} exceeds ${planInfo.planName} plan limit of $${txnLimit}`);
      }

      // Check monthly transaction total for Pro plan
      if (txnLimit !== null) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { data: monthlyTxns } = await supabase
          .from('CrossChainTransaction')
          .select('amount')
          .eq('userId', userId)
          .gte('createdAt', startOfMonth.toISOString());

        const monthlyTotal = monthlyTxns?.reduce((sum, tx) => sum + tx.amount, 0) || 0;
        
        if (monthlyTotal + amount > txnLimit) {
          throw new Error(`Adding this transaction would exceed your monthly limit of $${txnLimit}. Current usage: $${monthlyTotal}`);
        }
      }

      // Validate source blockchain ownership
      const [userOwnsChain, blockchainExists] = await Promise.all([
        // Check if user has this blockchain in their wallets
        supabase
          .from('User')
          .select('id')
          .eq('id', userId)
          .eq('blockchainId', sourceBlockchainId)
          .maybeSingle(),
        
        // Check if blockchain exists
        supabase
          .from('Blockchain')
          .select('id')
          .eq('id', sourceBlockchainId)
          .single()
      ]);

      let hasBlockchainAccess = !!userOwnsChain.data;

      // Also check CrossChainIdentity
      if (!hasBlockchainAccess) {
        const { data: crossChainAccess } = await supabase
          .from('CrossChainIdentity')
          .select('id')
          .eq('userId', userId)
          .eq('blockchainId', sourceBlockchainId)
          .maybeSingle();
        
        hasBlockchainAccess = !!crossChainAccess;
      }

      if (!hasBlockchainAccess) {
        throw new Error('You do not have access to the source blockchain');
      }

      if (blockchainExists.error) {
        throw new Error('Source blockchain not found');
      }

      // Create the transaction
      const { data: transaction, error } = await supabase
        .from('CrossChainTransaction')
        .insert({
          id: generateUUID(),
          userId,
          sourceBlockchainId,
          destinationAddress,
          amount,
          assetType,
          proofHash: proofHash || generateUUID(),
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select(`
          *,
          User!userId(id, planId),
          Blockchain!sourceBlockchainId(name)
        `)
        .single();

      if (error) throw error;

      // Recalculate credit score
      try {
        await CreditScoreService.calculateScore(userId);
      } catch (scoreError) {
      }

      return transaction;

    } catch (error) {
      throw error;
    }
  }

  // ✅ Update transaction status
  static async updateTransactionStatus(txId: string, status: string, userId?: string) {
    try {
      // Verify ownership if userId provided
      if (userId) {
        const { data: transaction } = await supabase
          .from('CrossChainTransaction')
          .select('userId')
          .eq('id', txId)
          .single();

        if (!transaction || transaction.userId !== userId) {
          throw new Error('Transaction not found or access denied');
        }
      }

      const { data: updatedTransaction, error } = await supabase
        .from('CrossChainTransaction')
        .update({ 
          status, 
          updatedAt: new Date().toISOString() 
        })
        .eq('id', txId)
        .select(`
          *,
          Blockchain!sourceBlockchainId(name)
        `)
        .single();

      if (error) throw error;
      return updatedTransaction;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Get user's transaction history with limits
  static async getUserTransactions(userId: string, limit = 50) {
    try {
      const { data: transactions, error } = await supabase
        .from('CrossChainTransaction')
        .select(`
          *,
          Blockchain!sourceBlockchainId(name, ubid)
        `)
        .eq('userId', userId)
        .order('createdAt', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return transactions || [];
    } catch (error) {
      throw error;
    }
  }

  // ✅ Get monthly transaction summary
  static async getMonthlyTransactionSummary(userId: string) {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data: transactions } = await supabase
        .from('CrossChainTransaction')
        .select('amount, status')
        .eq('userId', userId)
        .gte('createdAt', startOfMonth.toISOString());

      const summary = {
        totalAmount: 0,
        successfulAmount: 0,
        pendingAmount: 0,
        failedAmount: 0,
        totalCount: transactions?.length || 0,
        completedCount: 0,
        pendingCount: 0,
        failedCount: 0,
        cancelledCount: 0,
      };

      transactions?.forEach((tx: { amount: number; status: string }) => {
        summary.totalAmount += tx.amount;
        
        switch (tx.status) {
          case 'completed':
            summary.successfulAmount += tx.amount;
            summary.completedCount++;
            break;
          case 'pending':
            summary.pendingAmount += tx.amount;
            summary.pendingCount++;
            break;
          case 'failed':
            summary.failedAmount += tx.amount;
            summary.failedCount++;
            break;
          case 'cancelled':
            summary.cancelledCount++;
            break;
        }
      });

      return summary;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Get transaction by ID with ownership validation
  static async getTransactionById(transactionId: string, userId?: string) {
    try {
      const query = supabase
        .from('CrossChainTransaction')
        .select(`
          *,
          User!userId(id, planId),
          Blockchain!sourceBlockchainId(name, ubid)
        `)
        .eq('id', transactionId);

      if (userId) {
        query.eq('userId', userId);
      }

      const { data: transaction, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw error;
      }

      return transaction;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Cancel transaction
  static async cancelTransaction(transactionId: string, userId: string) {
    try {
      // First check if transaction exists and is owned by user
      const { data: transaction } = await supabase
        .from('CrossChainTransaction')
        .select('userId, status')
        .eq('id', transactionId)
        .single();

      if (!transaction || transaction.userId !== userId) {
        throw new Error('Transaction not found or access denied');
      }

      if (transaction.status !== 'pending') {
        throw new Error(`Cannot cancel transaction with status: ${transaction.status}`);
      }

      const { data: cancelledTransaction, error } = await supabase
        .from('CrossChainTransaction')
        .update({ 
          status: 'cancelled', 
          updatedAt: new Date().toISOString() 
        })
        .eq('id', transactionId)
        .select(`
          *,
          Blockchain!sourceBlockchainId(name)
        `)
        .single();

      if (error) throw error;
      return cancelledTransaction;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Get comprehensive transaction statistics
  static async getTransactionStats(userId: string) {
    try {
      const [allTimeStats, monthlyStats] = await Promise.all([
        // All-time stats
        supabase
          .from('CrossChainTransaction')
          .select('amount, status, assetType, createdAt')
          .eq('userId', userId),
        
        // Current month stats
        supabase
          .from('CrossChainTransaction')
          .select('amount, status, assetType')
          .eq('userId', userId)
          .gte('createdAt', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
      ]);

      const allTransactions = allTimeStats.data || [];
      const monthlyTransactions = monthlyStats.data || [];

      // Calculate statistics with proper typing
      const stats = {
        allTime: {
          totalTransactions: allTransactions.length,
          totalAmount: allTransactions.reduce((sum: number, tx: TransactionData) => sum + tx.amount, 0),
          completedTransactions: allTransactions.filter((tx: TransactionData) => tx.status === 'completed').length,
          pendingTransactions: allTransactions.filter((tx: TransactionData) => tx.status === 'pending').length,
          failedTransactions: allTransactions.filter((tx: TransactionData) => tx.status === 'failed').length,
          cancelledTransactions: allTransactions.filter((tx: TransactionData) => tx.status === 'cancelled').length,
        },
        currentMonth: {
          totalTransactions: monthlyTransactions.length,
          totalAmount: monthlyTransactions.reduce((sum: number, tx: TransactionData) => sum + tx.amount, 0),
          completedTransactions: monthlyTransactions.filter((tx: TransactionData) => tx.status === 'completed').length,
          pendingTransactions: monthlyTransactions.filter((tx: TransactionData) => tx.status === 'pending').length,
        },
        assetTypes: this.getAssetTypeStats(allTransactions),
        successRate: allTransactions.length > 0 
          ? ((allTransactions.filter((tx: TransactionData) => tx.status === 'completed').length / allTransactions.length) * 100).toFixed(2) + '%'
          : '0%'
      };

      return stats;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Helper method for asset type statistics with proper typing
  private static getAssetTypeStats(transactions: TransactionData[]): Record<string, AssetTypeStats> {
    const assetStats: Record<string, AssetTypeStats> = {};
    
    transactions.forEach((tx: TransactionData) => {
      if (!assetStats[tx.assetType]) {
        assetStats[tx.assetType] = { count: 0, totalAmount: 0 };
      }
      assetStats[tx.assetType].count++;
      assetStats[tx.assetType].totalAmount += tx.amount;
    });

    return assetStats;
  }
}
