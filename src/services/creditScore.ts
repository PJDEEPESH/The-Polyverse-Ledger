import { PrismaClient } from '@prisma/client';
import { calculateRiskScore } from '../utils/ml.js';

const prisma = new PrismaClient();

export class CreditScoreService {
  static async calculateScore(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        transactions: true,
        invoices: true,
        crossChainTxs: true,
        creditHistory: {
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Calculate transaction volume score (25%)
    const transactionVolume = [
      ...user.transactions,
      ...user.crossChainTxs
    ].reduce((sum, tx) => sum + tx.amount, 0);
    const volumeScore = Math.min(250, (transactionVolume / 10000) * 250);

    // Calculate transaction consistency score (25%)
    const successfulTxs = [
      ...user.transactions.filter(tx => tx.status === 'success'),
      ...user.crossChainTxs.filter(tx => tx.status === 'completed')
    ].length;
    const totalTxs = user.transactions.length + user.crossChainTxs.length;
    const consistencyScore = totalTxs > 0 ? (successfulTxs / totalTxs) * 250 : 0;

    // Calculate invoice payment score (25%)
    const paidInvoices = user.invoices.filter(inv => inv.status === 'paid').length;
    const invoiceScore = user.invoices.length > 0 
      ? (paidInvoices / user.invoices.length) * 250 
      : 0;

    // Calculate risk score using ML (25%)
    const riskScore = await calculateRiskScore(user.id);
    const riskScorePoints = (1 - riskScore) * 250; // Invert risk score as lower risk = higher points

    // Calculate final score (300-900 range)
    const baseScore = 300;
    const finalScore = Math.floor(
      baseScore + 
      volumeScore + 
      consistencyScore + 
      invoiceScore + 
      riskScorePoints
    );

    // Store score history
    await prisma.creditScoreHistory.create({
      data: {
        userId: user.id,
        score: finalScore,
        factors: {
          volumeScore,
          consistencyScore,
          invoiceScore,
          riskScore: riskScorePoints,
        }
      }
    });

    // Update user's current credit score
    await prisma.user.update({
      where: { id: userId },
      data: { creditScore: finalScore }
    });

    return finalScore;
  }
}