//src/utils/checkPlanStatus.ts
import { differenceInDays } from 'date-fns';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function isPlanActive(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) return false;

  if (user.planId) return true; // Paid plan

  if (user.trialUsed && user.trialStartDate) {
    const trialDays = 5; // Adjust based on your system
    const usedDays = differenceInDays(new Date(), new Date(user.trialStartDate));
    return usedDays < trialDays;
  }

  return true; // Still eligible
}
