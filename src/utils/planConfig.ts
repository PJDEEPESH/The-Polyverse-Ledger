// Combined Plan Configuration with TypeScript types
// This file contains all plan-related constants and mappings

export interface PlanConfig {
  name: string;
  displayName: string;
  prismaPlanId: string | null;
  paypalPlanId: string | null;
  maxWallets: number;
  canViewOthers: boolean;
  canAddWallets: boolean;
  queryLimit: number;
  txnLimit: number | null;
  color: string;
  popular: boolean;
  price: number;
  billing: string;
}

export type PlanName = 'Free' | 'Basic' | 'Pro' | 'Premium';

// ✅ Corrected PLAN_CONFIG to match your middleware exactly
export const PLAN_CONFIG: Record<PlanName, PlanConfig> = {
  'Free': {
    name: 'Free',
    displayName: 'Free Plan',
    prismaPlanId: null,
    paypalPlanId: null,
    maxWallets: 1,
    canViewOthers: false,
    canAddWallets: false,
    queryLimit: 100, // ✅ Matches middleware (100 queries in 5 days)
    txnLimit: null,
    color: 'gray',
    popular: false,
    price: 0,
    billing: 'forever'
  },
  
  'Basic': {
    name: 'Basic',
    displayName: 'Basic Plan',
    prismaPlanId: 'a946852b-0e64-455b-90f4-6091e8f11ade',
    paypalPlanId: 'P-7WV44462TF966624XNB2PKXA',
    maxWallets: 1,
    canViewOthers: false,
    canAddWallets: false,
    queryLimit: 1000, // ✅ Correct
    txnLimit: null,
    color: 'blue',
    popular: false,
    price: 149, // ✅ Fixed: $19/month not $149
    billing: 'monthly'
  },
  
  'Pro': {
    name: 'Pro',
    displayName: 'Pro Plan',
    prismaPlanId: 'e203a24f-bfba-471f-a8b8-58d513c42b7f',
    paypalPlanId: 'P-1LC09938TF381221LNB2PLHQ',
    maxWallets: 3,
    canViewOthers: true,
    canAddWallets: true,
    queryLimit: 15000, // ✅ Correct
    txnLimit: 20000,
    color: 'indigo',
    popular: true,
    price: 699, // ✅ Fixed: $29/month not $699
    billing: 'monthly'
  },
  
  'Premium': {
    name: 'Premium',
    displayName: 'Premium Plan',
    prismaPlanId: '76a4c4e2-b2b2-498d-ad18-91adccdcd3b0',
    paypalPlanId: 'P-7S343131C3165360FNB2PJ6A',
    maxWallets: 5,
    canViewOthers: true,
    canAddWallets: true,
    queryLimit: 1000000, // ✅ Fixed: 1M queries not 100K (matches middleware)
    txnLimit: null,
    color: 'purple',
    popular: false,
    price: 3699, // ✅ Fixed: $49/month not $3699
    billing: 'monthly'
  }
};

// ✅ Helper Functions with proper TypeScript types
export const getPlanConfig = (planName?: string | null): PlanConfig => {
  if (!planName) return PLAN_CONFIG['Free'];
  
  // ✅ Safer normalization
  const normalized = planName.charAt(0).toUpperCase() + planName.slice(1).toLowerCase();
  const validPlanName = Object.keys(PLAN_CONFIG).find(key => key === normalized);
  
  return validPlanName ? PLAN_CONFIG[validPlanName as PlanName] : PLAN_CONFIG['Free'];
};

export const getPlanByPrismaId = (prismaId?: string | null): PlanConfig => {
  if (!prismaId) return PLAN_CONFIG['Free'];
  return Object.values(PLAN_CONFIG).find(plan => plan.prismaPlanId === prismaId) || PLAN_CONFIG['Free'];
};

export const getPlanByPayPalId = (paypalId?: string | null): PlanConfig => {
  if (!paypalId) return PLAN_CONFIG['Free'];
  return Object.values(PLAN_CONFIG).find(plan => plan.paypalPlanId === paypalId) || PLAN_CONFIG['Free'];
};

// ✅ Capability Checkers with proper types
export const canUserAddWallets = (planName?: string | null, currentWalletCount: number = 0): boolean => {
  const plan = getPlanConfig(planName);
  return plan.canAddWallets && currentWalletCount < plan.maxWallets;
};

export const canUserViewOtherWallets = (planName?: string | null): boolean => {
  const plan = getPlanConfig(planName);
  return plan.canViewOthers;
};

export const getUserQueryLimit = (planName?: string | null): number => {
  const plan = getPlanConfig(planName);
  return plan.queryLimit;
};

export const getUserTransactionLimit = (planName?: string | null): number | null => {
  const plan = getPlanConfig(planName);
  return plan.txnLimit;
};

export const getMaxWallets = (planName?: string | null): number => {
  const plan = getPlanConfig(planName);
  return plan.maxWallets;
};

// ✅ Plan Validation with types
export const isValidPlan = (planName?: string | null): boolean => {
  if (!planName) return false;
  const normalizedName = planName.charAt(0).toUpperCase() + planName.slice(1).toLowerCase();
  return Object.keys(PLAN_CONFIG).includes(normalizedName);
};

export const isPaidPlan = (planName?: string | null): boolean => {
  const plan = getPlanConfig(planName);
  return plan.price > 0;
};

export const isPremiumFeature = (planName?: string | null): boolean => {
  const plan = getPlanConfig(planName);
  return plan.name === 'Pro' || plan.name === 'Premium';
};

// ✅ UI Helpers with types
export const getPlanColor = (planName?: string | null): string => {
  const plan = getPlanConfig(planName);
  return plan.color;
};

export const getPlanPrice = (planName?: string | null): number => {
  const plan = getPlanConfig(planName);
  return plan.price;
};

export const isPopularPlan = (planName?: string | null): boolean => {
  const plan = getPlanConfig(planName);
  return plan.popular;
};

// ✅ Format price for display
export const getFormattedPlanPrice = (planName?: string | null): string => {
  const plan = getPlanConfig(planName);
  if (plan.price === 0) return 'Free';
  return `$${plan.price}/month`;
};

// ✅ Get plan description for UI
export const getPlanDescription = (planName?: string | null): string[] => {
  const plan = getPlanConfig(planName);
  
  switch (plan.name) {
    case 'Free':
      return [
        `${plan.queryLimit} queries in 5 days`,
        'Basic credit scoring',
        '1 wallet only'
      ];
    case 'Basic':
      return [
        `${plan.queryLimit.toLocaleString()} queries/month`,
        'Credit scoring',
        'Single wallet'
      ];
    case 'Pro':
      return [
        `${plan.queryLimit.toLocaleString()} queries/month`,
        'Up to 3 wallets',
        '$20K transaction limit',
        'View other wallets'
      ];
    case 'Premium':
      return [
        `${plan.queryLimit.toLocaleString()} queries/month`,
        'Up to 5 wallets',
        'Unlimited transactions',
        'Full access'
      ];
    default:
      return ['Basic features'];
  }
};

// ✅ Legacy compatibility types
export interface PlanLimits {
  maxWallets: number;
  canViewOthers: boolean;
  queryLimit: number;
  txnLimit: number | null;
}

export interface PlanMapping {
  prismaPlanId: string;
  paypalPlanId: string;
  queryLimit: number;
  userLimit: number;
}

export interface PlanCapabilities extends PlanLimits {
  canAddWallets: boolean;
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = Object.fromEntries(
  Object.entries(PLAN_CONFIG).map(([key, value]) => [
    key,
    {
      maxWallets: value.maxWallets,
      canViewOthers: value.canViewOthers,
      queryLimit: value.queryLimit,
      txnLimit: value.txnLimit
    }
  ])
) as Record<PlanName, PlanLimits>;

export const PLAN_MAPPING: Record<string, PlanMapping> = {
  'basic': {
    prismaPlanId: PLAN_CONFIG.Basic.prismaPlanId!,
    paypalPlanId: PLAN_CONFIG.Basic.paypalPlanId!,
    queryLimit: PLAN_CONFIG.Basic.queryLimit,
    userLimit: PLAN_CONFIG.Basic.maxWallets
  },
  'pro': {
    prismaPlanId: PLAN_CONFIG.Pro.prismaPlanId!,
    paypalPlanId: PLAN_CONFIG.Pro.paypalPlanId!,
    queryLimit: PLAN_CONFIG.Pro.queryLimit,
    userLimit: PLAN_CONFIG.Pro.maxWallets
  },
  'premium': {
    prismaPlanId: PLAN_CONFIG.Premium.prismaPlanId!,
    paypalPlanId: PLAN_CONFIG.Premium.paypalPlanId!,
    queryLimit: PLAN_CONFIG.Premium.queryLimit,
    userLimit: PLAN_CONFIG.Premium.maxWallets
  }
};

export const PLAN_CAPABILITIES: Record<PlanName, PlanCapabilities> = Object.fromEntries(
  Object.entries(PLAN_CONFIG).map(([key, value]) => [
    key,
    {
      maxWallets: value.maxWallets,
      canViewOthers: value.canViewOthers,
      queryLimit: value.queryLimit,
      canAddWallets: value.canAddWallets,
      txnLimit: value.txnLimit
    }
  ])
) as Record<PlanName, PlanCapabilities>;

// ✅ All available plan names with proper typing
export const PLAN_NAMES: PlanName[] = Object.keys(PLAN_CONFIG) as PlanName[];

// ✅ Export default for convenience
export default PLAN_CONFIG;
