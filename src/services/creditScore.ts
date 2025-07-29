//src/services/creditScore.ts - CORRECTED: Fixed enum values and added CrossChain support
import { PrismaClient } from '@prisma/client';
import { calculateRiskScore } from '../utils/ml.js';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID } from '../utils/ubid.js';

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
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // ✅ FIXED: Use correct enum values
    const transactionVolume = [
      ...user.transactions.filter(tx => tx.status === 'SUCCESS'), // ✅ FIXED
      ...user.crossChainTxs.filter(tx => tx.status === 'completed'), // ✅ Keep as is - this might be a string field
    ].reduce((sum, tx) => sum + tx.amount, 0);
    const volumeScore = Math.min(250, (transactionVolume / 10000) * 250);

    const successfulTxs = [
      ...user.transactions.filter(tx => tx.status === 'SUCCESS'), // ✅ FIXED
      ...user.crossChainTxs.filter(tx => tx.status === 'completed'),
    ].length;
    const totalTxs = user.transactions.length + user.crossChainTxs.length;
    const consistencyScore = totalTxs > 0 ? (successfulTxs / totalTxs) * 250 : 0;

    // ✅ FIXED: Use correct enum value
    const paidInvoices = user.invoices.filter(inv => inv.status === 'PAID').length; // ✅ FIXED
    const invoiceScore = user.invoices.length > 0
      ? (paidInvoices / user.invoices.length) * 250
      : 0;

    const riskScore = await calculateRiskScore(user.id);
    const riskScorePoints = (1 - riskScore) * 250;

    const baseScore = 300;
    const finalScore = Math.floor(
      baseScore +
      volumeScore +
      consistencyScore +
      invoiceScore +
      riskScorePoints
    );

    await prisma.creditScoreHistory.create({
      data: {
        userId: user.id,
        score: finalScore,
        factors: {
          volumeScore,
          consistencyScore,
          invoiceScore,
          riskScore: riskScorePoints,
        },
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { creditScore: finalScore },
    });

    return finalScore;
  }

  // ✅ NEW: Method for CrossChainIdentity credit scores (as referenced in invoice routes)
  static async calculateCrossChainScore(crossChainIdentityId: string): Promise<number> {
    // Get CrossChainIdentity with related data
    const { data: crossChainIdentity } = await supabase
      .from('CrossChainIdentity')
      .select(`
        id,
        userId,
        walletAddress,
        blockchainId,
        creditScore
      `)
      .eq('id', crossChainIdentityId)
      .maybeSingle();

    if (!crossChainIdentity) {
      throw new Error('CrossChainIdentity not found');
    }

    // Get invoices for this specific CrossChainIdentity
    // Note: This assumes you have crossChainIdentityId field in Invoice after migration
    const invoices = await prisma.invoice.findMany({
      where: { 
        userId: crossChainIdentity.userId,
        walletAddress: crossChainIdentity.walletAddress,
        blockchainId: crossChainIdentity.blockchainId
      },
    });

    // Calculate score based only on this wallet's invoices
    const paidInvoices = invoices.filter(inv => inv.status === 'PAID').length; // ✅ FIXED
    const invoiceScore = invoices.length > 0
      ? (paidInvoices / invoices.length) * 250
      : 0;

    // For CrossChain, we focus mainly on invoice performance since transactions are at User level
    const baseScore = 300;
    const finalScore = Math.floor(baseScore + invoiceScore);

    // Update CrossChainIdentity credit score
    await supabase
      .from('CrossChainIdentity')
      .update({ creditScore: finalScore })
      .eq('id', crossChainIdentityId);

    // Record in history
    await supabase
      .from('CreditScoreHistory')
      .insert({
        id: generateUUID(),
        crossChainIdentityId: crossChainIdentityId,
        score: finalScore,
        factors: {
          invoiceScore,
          totalInvoices: invoices.length,
          paidInvoices: paidInvoices,
          calculatedAt: new Date().toISOString()
        }
      });

    return finalScore;
  }
}
