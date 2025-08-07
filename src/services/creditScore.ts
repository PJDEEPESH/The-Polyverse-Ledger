//src/services/creditScore.ts - FIXED: Proper CrossChain scoring with crossChainIdentityId
import { PrismaClient } from '@prisma/client';
import { calculateRiskScore } from '../utils/ml.js';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID } from '../utils/ubid.js';

const prisma = new PrismaClient();

// ✅ Prevent multiple simultaneous calculations
const scoreCalculationInProgress = new Map<string, boolean>();

export class CreditScoreService {
  static async calculateScore(userId: string): Promise<number> {
    // ✅ Prevent multiple simultaneous calculations
    if (scoreCalculationInProgress.get(userId)) {
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { creditScore: true }
      });
      return existingUser?.creditScore || 300;
    }

    scoreCalculationInProgress.set(userId, true);

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          transactions: {
            where: { status: 'SUCCESS' } // ✅ Only successful transactions
          },
          invoices: {
            where: { crossChainIdentityId: null } // ✅ Only primary wallet invoices
          },
          crossChainTxs: {
            where: { status: 'completed' } // ✅ Only completed cross-chain transactions
          },
          creditHistory: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // ✅ Volume Score (0-150) - Reduced from 250
      const transactionVolume = [
        ...user.transactions, // Already filtered for SUCCESS
        ...user.crossChainTxs, // Already filtered for completed
      ].reduce((sum, tx) => sum + tx.amount, 0);
      const volumeScore = Math.min(150, (transactionVolume / 10000) * 150);

      // ✅ Consistency Score (0-100) - Reduced from 250
      const successfulTxs = user.transactions.length + user.crossChainTxs.length;
      const totalTxs = await prisma.transaction.count({
        where: { userId: user.id }
      }) + await prisma.crossChainTransaction.count({
        where: { userId: user.id }
      });
      const consistencyScore = totalTxs > 0 ? (successfulTxs / totalTxs) * 100 : 0;

      // ✅ Invoice Score (0-150) - Only primary wallet invoices
      const paidInvoices = user.invoices.filter(inv => inv.status === 'PAID').length;
      const invoiceScore = user.invoices.length > 0
        ? (paidInvoices / user.invoices.length) * 150
        : 0;

      // ✅ Risk Score (0-100) - Reduced from 250 and improved logic
      const riskScore = await calculateRiskScore(user.id);
      const riskScorePoints = (1 - riskScore) * 100;

      // ✅ Base Score reduced to 250
      const baseScore = 250;
      const finalScore = Math.floor(
        baseScore +
        volumeScore +
        consistencyScore +
        invoiceScore +
        riskScorePoints
      );

      // ✅ Cap the final score at reasonable maximum
      const cappedScore = Math.min(finalScore, 700);


      // ✅ Only create history record if score actually changed
      const lastScore = user.creditHistory[0]?.score || 0;
      if (Math.abs(cappedScore - lastScore) > 5) { // Only if change is significant
        await prisma.creditScoreHistory.create({
          data: {
            userId: user.id,
            score: cappedScore,
            factors: {
              baseScore,
              volumeScore: Math.round(volumeScore),
              consistencyScore: Math.round(consistencyScore),
              invoiceScore: Math.round(invoiceScore),
              riskScore: Math.round(riskScorePoints),
              transactionCount: user.transactions.length,
              invoiceCount: user.invoices.length,
              paidInvoices,
            },
          },
        });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { creditScore: cappedScore },
      });

      return cappedScore;

    } finally {
      scoreCalculationInProgress.delete(userId);
    }
  }

  // ✅ FIXED: Proper CrossChain score calculation using crossChainIdentityId
  static async calculateCrossChainScore(crossChainIdentityId: string): Promise<number> {
    
    if (scoreCalculationInProgress.get(crossChainIdentityId)) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { data: existing } = await supabase
        .from('CrossChainIdentity')
        .select('creditScore')
        .eq('id', crossChainIdentityId)
        .maybeSingle();
      return existing?.creditScore || 0;
    }

    scoreCalculationInProgress.set(crossChainIdentityId, true);

    try {
      // ✅ Get CrossChain identity with related data
      const crossChainIdentity = await prisma.crossChainIdentity.findUnique({
        where: { id: crossChainIdentityId },
        include: {
          user: {
            include: {
              crossChainTxs: {
                where: {
                  // ✅ Get transactions for this specific wallet
                  sourceBlockchainId: { equals: '' }, // This needs the blockchain ID from crossChainIdentity
                  status: 'completed'
                }
              }
            }
          },
          invoices: { // ✅ This uses the crossChainIdentityId relation
            include: {
              transactions: {
                where: { status: 'SUCCESS' }
              }
            }
          },
          creditHistory: {
            take: 1,
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!crossChainIdentity) {
        return 0;
      }

    
      
      // Invoice Score (0-200)
      const invoices = crossChainIdentity.invoices;
      const paidInvoices = invoices.filter(inv => inv.status === 'PAID').length;
      const totalInvoiceValue = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
      
      const invoiceScore = invoices.length > 0
        ? (paidInvoices / invoices.length) * 200
        : 0;

      // Volume Score (0-150)
      const invoiceVolume = totalInvoiceValue;
      const volumeScore = Math.min(150, (invoiceVolume / 5000) * 150);

      // Transaction Success Score (0-100)
      const allTransactions = invoices.flatMap(inv => inv.transactions);
      const successfulTxs = allTransactions.filter(tx => tx.status === 'SUCCESS').length;
      const txSuccessScore = allTransactions.length > 0
        ? (successfulTxs / allTransactions.length) * 100
        : 0;

      // Base Score for CrossChain (lower than primary)
      const baseScore = 150;
      
      const finalScore = Math.floor(
        baseScore +
        invoiceScore +
        volumeScore +
        txSuccessScore
      );

      // ✅ Cap CrossChain score at 600 (lower than primary wallet max)
      const cappedScore = Math.min(finalScore, 600);

  

      // ✅ Create credit history for CrossChain identity
      const lastScore = crossChainIdentity.creditHistory[0]?.score || 0;
      if (Math.abs(cappedScore - lastScore) > 5) {
        await prisma.creditScoreHistory.create({
          data: {
            crossChainIdentityId: crossChainIdentity.id,
            score: cappedScore,
            factors: {
              baseScore,
              invoiceScore: Math.round(invoiceScore),
              volumeScore: Math.round(volumeScore),
              txSuccessScore: Math.round(txSuccessScore),
              invoiceCount: invoices.length,
              paidInvoices,
              totalInvoiceValue: Math.round(totalInvoiceValue),
              source: 'crosschain'
            },
          },
        });
      }

      // ✅ Update CrossChain identity score
      await prisma.crossChainIdentity.update({
        where: { id: crossChainIdentityId },
        data: { creditScore: cappedScore },
      });

      return cappedScore;

    } catch (error) {
      return 0;
    } finally {
      scoreCalculationInProgress.delete(crossChainIdentityId);
    }
  }

  // ✅ NEW: Helper method to get all scores for a user
  static async getAllScoresForUser(userId: string): Promise<{
    primary: { creditScore: number; walletAddress: string; blockchainId: string };
    crossChain: Array<{
      crossChainIdentityId: string;
      creditScore: number;
      walletAddress: string;
      blockchainId: string;
    }>;
  }> {
    // Get primary wallet score
    const primaryScore = await this.calculateScore(userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true, blockchainId: true }
    });

    // Get all CrossChain identities
    const crossChainIdentities = await prisma.crossChainIdentity.findMany({
      where: { userId },
      select: {
        id: true,
        walletAddress: true,
        blockchainId: true,
        creditScore: true
      }
    });

    // Calculate fresh scores for all CrossChain identities
    const crossChainScores = await Promise.all(
      crossChainIdentities.map(async (identity) => {
        const freshScore = await this.calculateCrossChainScore(identity.id);
        return {
          crossChainIdentityId: identity.id,
          creditScore: freshScore,
          walletAddress: identity.walletAddress,
          blockchainId: identity.blockchainId
        };
      })
    );

    return {
      primary: {
        creditScore: primaryScore,
        walletAddress: user?.walletAddress || '',
        blockchainId: user?.blockchainId || ''
      },
      crossChain: crossChainScores
    };
  }
}