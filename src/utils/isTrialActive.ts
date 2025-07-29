//src/utils/isTrialActive.ts
export function isTrialActive(trialStartDate: Date | string | null): boolean {
  if (!trialStartDate) return false;

  const start = new Date(trialStartDate);
  const daysSinceStart = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  return daysSinceStart <= 5;
}

export function getTrialDaysRemaining(trialStartDate: Date | string | null): number {
  if (!trialStartDate) return 0;

  const start = new Date(trialStartDate);
  const daysSinceStart = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, 5 - daysSinceStart);
}

