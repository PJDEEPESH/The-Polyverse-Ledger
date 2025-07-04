import type { User } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Define extended User type with relations
type UserWithRelations = User & {
  transactions?: any[];
  invoices?: any[];
};

export async function calculateRiskScore(userId: string): Promise<number> {
  // This is a simplified risk scoring model
  // In production, you would use a proper ML model
  
  // Fetch user with related data
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      transactions: true,
      invoices: true
    }
  });

  if (!user) {
    throw new Error('User not found');
  }

  const transactionCount = user.transactions?.length || 0;
  const invoiceCount = user.invoices?.length || 0;
  
  // Basic risk factors:
  // 1. Transaction history length
  // 2. Invoice payment history
  // 3. Account age (in days)
  
  const accountAge = (new Date().getTime() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  
  // Calculate base score (0-1)
  let score = 0;
  
  // Transaction history weight
  score += Math.min(transactionCount / 100, 1) * 0.4;
  
  // Invoice history weight
  score += Math.min(invoiceCount / 20, 1) * 0.3;
  
  // Account age weight
  score += Math.min(accountAge / 365, 1) * 0.3;
  
  return score;
}
