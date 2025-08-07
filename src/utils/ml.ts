// //src/utils/ml.ts
// import type { User } from '@prisma/client';
// import { PrismaClient } from '@prisma/client';

// const prisma = new PrismaClient();

// // Define extended User type with relations
// type UserWithRelations = User & {
//   transactions?: any[];
//   invoices?: any[];
// };

// export async function calculateRiskScore(userId: string): Promise<number> {
//   // This is a simplified risk scoring model
//   // In production, you would use a proper ML model
  
//   // Fetch user with related data
//   const user = await prisma.user.findUnique({
//     where: { id: userId },
//     include: {
//       transactions: true,
//       invoices: true
//     }
//   });

//   if (!user) {
//     throw new Error('User not found');
//   }

//   const transactionCount = user.transactions?.length || 0;
//   const invoiceCount = user.invoices?.length || 0;
  
//   // Basic risk factors:
//   // 1. Transaction history length
//   // 2. Invoice payment history
//   // 3. Account age (in days)
  
//   const accountAge = (new Date().getTime() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  
//   // Calculate base score (0-1)
//   let score = 0;
  
//   // Transaction history weight
//   score += Math.min(transactionCount / 100, 1) * 0.4;
  
//   // Invoice history weight
//   score += Math.min(invoiceCount / 20, 1) * 0.3;
  
//   // Account age weight
//   score += Math.min(accountAge / 365, 1) * 0.3;
  
//   return score;
// }
//src/utils/ml.ts - CORRECTED: Fixed risk scoring logic
import type { User } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Define extended User type with relations
type UserWithRelations = User & {
  transactions?: any[];
  invoices?: any[];
};

export async function calculateRiskScore(userId: string): Promise<number> {
  // Fetch user with related data
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      transactions: {
        where: { status: 'SUCCESS' } // Only successful transactions
      },
      invoices: true
    }
  });

  if (!user) {
    throw new Error('User not found');
  }

  const transactionCount = user.transactions?.length || 0;
  const invoiceCount = user.invoices?.length || 0;
  const paidInvoices = user.invoices?.filter(inv => inv.status === 'PAID').length || 0;
  
  // Account age in days
  const accountAge = Math.max(0, (new Date().getTime() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  
  // ✅ FIXED: Start with moderate risk for new users (0.6 = 60% risk)
  let riskScore = 0.6;
  
  // ✅ REDUCE risk based on positive behavior
  
  // Transaction history reduces risk (max 20% reduction)
  if (transactionCount > 0) {
    const transactionRiskReduction = Math.min(transactionCount / 50, 0.2);
    riskScore -= transactionRiskReduction;
  }
  
  // Invoice payment history reduces risk (max 25% reduction)
  if (invoiceCount > 0) {
    const paymentRatio = paidInvoices / invoiceCount;
    const invoiceRiskReduction = paymentRatio * 0.25;
    riskScore -= invoiceRiskReduction;
  }
  
  // Account age reduces risk, but only after 7 days (max 15% reduction)
  if (accountAge > 7) {
    const ageRiskReduction = Math.min((accountAge - 7) / 365, 0.15);
    riskScore -= ageRiskReduction;
  }
  
  // ✅ Ensure risk stays within reasonable bounds (10%-85%)
  riskScore = Math.max(0.1, Math.min(0.85, riskScore));
  
  console.log(`🎯 Risk Score Calculation for user ${userId}:`, {
    transactionCount,
    invoiceCount,
    paidInvoices,
    accountAge: accountAge.toFixed(2),
    calculatedRiskScore: riskScore.toFixed(3),
    riskPercentage: `${(riskScore * 100).toFixed(1)}%`
  });
  
  return riskScore;
}
