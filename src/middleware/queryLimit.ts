// src/middleware/queryLimit.ts - PRODUCTION VERSION WITH CROSSCHAIN SUPPORT
import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';
import { isTrialActive } from '../utils/isTrialActive.js';
import { generateUUID } from '../utils/ubid.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface QueryLimitBody {
  walletAddress?: string;
  blockchainId?: string;
  incrementUsage?: boolean;
}

interface QueryLimitParams {
  walletAddress?: string;
  blockchainId?: string;
  id?: string;
}

interface QueryContext {
  userId: string;
  currentUsage: number;
  limit: number;
  remaining: number;
  plan: string;
  planId: string;
  trialActive: boolean;
  planSource: 'individual' | 'organization' | 'free';
  userCount?: number;
  userLimit?: number;
  month?: number;
  year?: number;
  walletSource?: 'primary' | 'crosschain';
  crossChainIdentityId?: string;
}

interface PlanLimits {
  Free: { queryLimit: 100; userLimit: 1; trialDays: 5 };
  Basic: { queryLimit: 1000; userLimit: 1; price: 149 };
  Pro: { queryLimit: 15000; userLimit: 3; price: 669 };
  Premium: { queryLimit: 100000; userLimit: 5; price: 3699 };
}

const PLAN_LIMITS: PlanLimits = {
  Free: { queryLimit: 100, userLimit: 1, trialDays: 5 },
  Basic: { queryLimit: 1000, userLimit: 1, price: 149 },
  Pro: { queryLimit: 15000, userLimit: 3, price: 669 },
  Premium: { queryLimit: 100000, userLimit: 5, price: 3699 }
};

// ✅ Enhanced function to find user from wallet (supports CrossChainIdentity)
async function findUserByWallet(walletAddress: string, blockchainId: string) {
  // Check primary wallet (User table)
  const { data: primaryUser, error: primaryError } = await supabase
    .from('User')
    .select(`
      id, 
      planId, 
      orgId,
      trialStartDate, 
      trialUsed,
      walletAddress,
      blockchainId,
      Plan!planId (
        id,
        name,
        queryLimit,
        userLimit
      )
    `)
    .eq('walletAddress', walletAddress)
    .eq('blockchainId', blockchainId.toString())
    .maybeSingle();

  if (primaryError && primaryError.code !== 'PGRST116') {
    throw new Error(`Primary user query failed: ${primaryError.message}`);
  }

  if (primaryUser) {
    return {
      user: primaryUser,
      source: 'primary' as const,
      crossChainIdentityId: null
    };
  }

  // Check CrossChainIdentity table
  const { data: crossChainUser, error: crossChainError } = await supabase
    .from('CrossChainIdentity')
    .select(`
      id,
      userId,
      User!userId(
        id, 
        planId, 
        orgId,
        trialStartDate, 
        trialUsed,
        walletAddress,
        blockchainId,
        Plan!planId (
          id,
          name,
          queryLimit,
          userLimit
        )
      )
    `)
    .eq('walletAddress', walletAddress)
    .eq('blockchainId', blockchainId.toString())
    .maybeSingle();

  if (crossChainError && crossChainError.code !== 'PGRST116') {
    throw new Error(`CrossChain user query failed: ${crossChainError.message}`);
  }

  if (crossChainUser && crossChainUser.User) {
    const userData = Array.isArray(crossChainUser.User) ? crossChainUser.User[0] : crossChainUser.User;
    return {
      user: userData,
      source: 'crosschain' as const,
      crossChainIdentityId: crossChainUser.id
    };
  }

  return null;
}

// ✅ Enhanced helper to get organization plan with user count
async function getOrganizationPlan(orgId: string) {
  try {
    const { data: org, error } = await supabase
      .from('Organization')
      .select(`
        planId,
        name,
        Plan!planId (
          id, 
          name, 
          queryLimit, 
          userLimit
        )
      `)
      .eq('id', orgId)
      .single();

    if (error) throw error;

    // Count organization members
    const { count: memberCount, error: countError } = await supabase
      .from('User')
      .select('*', { count: 'exact', head: true })
      .eq('orgId', orgId);

    if (countError) throw countError;

    if (org?.planId && org.Plan) {
      const plan = Array.isArray(org.Plan) ? org.Plan[0] : org.Plan;
      return {
        ...plan,
        source: 'organization' as const,
        organizationName: org.name,
        currentUsers: memberCount || 0
      };
    }
    return null;
  } catch (error) {
    throw new Error(`Failed to fetch organization plan: ${error}`);
  }
}

// ✅ Enhanced plan resolution supporting all plan types
async function resolveEffectivePlan(user: any) {
  let effectivePlan = null;
  let planSource: 'individual' | 'organization' | 'free' = 'free';
  let currentUsers = 1;

  // 1. Check for organization plan first (highest priority)
  if (user.orgId) {
    const orgPlan = await getOrganizationPlan(user.orgId);
    if (orgPlan) {
      effectivePlan = orgPlan;
      planSource = 'organization';
      currentUsers = orgPlan.currentUsers;
      return { effectivePlan, planSource, currentUsers };
    }
  }

  // 2. Check for individual plan
  if (user.planId && user.Plan) {
    const individualPlan = Array.isArray(user.Plan) ? user.Plan[0] : user.Plan;
    if (individualPlan) {
      effectivePlan = {
        ...individualPlan,
        source: 'individual'
      };
      planSource = 'individual';
      return { effectivePlan, planSource, currentUsers: 1 };
    }
  }

  // 3. Default to Free plan
  const { data: freePlan } = await supabase
    .from('Plan')
    .select('id, name, queryLimit, userLimit')
    .eq('name', 'Free')
    .single();

  effectivePlan = freePlan || {
    id: 'free-default',
    name: 'Free',
    queryLimit: PLAN_LIMITS.Free.queryLimit,
    userLimit: PLAN_LIMITS.Free.userLimit
  };

  return { effectivePlan, planSource, currentUsers: 1 };
}

// ✅ Enhanced organization usage calculation
async function getOrganizationUsage(orgId: string, month: number, year: number) {
  try {
    // Get all organization members
    const { data: members, error: membersError } = await supabase
      .from('User')
      .select('id')
      .eq('orgId', orgId);

    if (membersError) throw membersError;

    if (!members || members.length === 0) {
      return 0;
    }

    // Sum usage for all organization members
    const memberIds = members.map(member => member.id);
    const { data: orgUsage, error: usageError } = await supabase
      .from('QueryUsage')
      .select('used')
      .in('userId', memberIds)
      .eq('month', month)
      .eq('year', year);

    if (usageError) throw usageError;

    const totalUsage = orgUsage?.reduce((sum, record) => sum + record.used, 0) || 0;
    return totalUsage;
  } catch (error) {
    throw new Error(`Failed to calculate organization usage: ${error}`);
  }
}

// ✅ Enhanced Free user usage with 5-day rolling window
async function getFreeUserUsage(userId: string) {
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const { data: recentQueries, error } = await supabase
    .from('QueryUsage')
    .select('used, createdAt')
    .eq('userId', userId)
    .gte('createdAt', fiveDaysAgo.toISOString());

  if (error) throw error;

  const totalUsed = recentQueries?.reduce((sum, record) => sum + record.used, 0) || 0;
  const limit = PLAN_LIMITS.Free.queryLimit;
  
  return {
    used: totalUsed,
    limit,
    remaining: Math.max(0, limit - totalUsed),
    canQuery: totalUsed < limit
  };
}

// ✅ Enhanced Basic plan usage (individual monthly limit)
async function getBasicUserUsage(userId: string, month: number, year: number) {
  const { data: usage, error } = await supabase
    .from('QueryUsage')
    .select('used')
    .eq('userId', userId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  if (error) throw error;

  const used = usage?.used || 0;
  const limit = PLAN_LIMITS.Basic.queryLimit;

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    canQuery: used < limit
  };
}

// ✅ Enhanced Pro/Premium usage (supports both individual and organization)
async function getPaidPlanUsage(user: any, planName: 'Pro' | 'Premium', month: number, year: number, planSource: string) {
  const limit = PLAN_LIMITS[planName].queryLimit;
  let used = 0;

  if (planSource === 'organization' && user.orgId) {
    // Organization-wide usage
    used = await getOrganizationUsage(user.orgId, month, year);
  } else {
    // Individual usage
    const { data: usage, error } = await supabase
      .from('QueryUsage')
      .select('used')
      .eq('userId', user.id)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle();

    if (error) throw error;
    used = usage?.used || 0;
  }

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    canQuery: used < limit
  };
}

// ✅ Helper function to get wallet info from invoice ID
async function getWalletInfoFromInvoice(invoiceId: string) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        user: {
          select: {
            walletAddress: true,
            blockchainId: true
          }
        }
      }
    });

    if (!invoice || !invoice.user) {
      return null;
    }

    return {
      walletAddress: invoice.user.walletAddress,
      blockchainId: invoice.user.blockchainId
    };
  } catch (error) {
    throw new Error(`Failed to fetch invoice wallet info: ${error}`);
  }
}

// ✅ Enhanced usage increment function
async function incrementUsage(userId: string, month: number, year: number) {
  const now = new Date().toISOString();
  
  const { data: currentUsage, error: fetchError } = await supabase
    .from('QueryUsage')
    .select('id, used')
    .eq('userId', userId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

  if (currentUsage) {
    // Update existing record
    const { error: updateError } = await supabase
      .from('QueryUsage')
      .update({ 
        used: currentUsage.used + 1,
        updatedAt: now
      })
      .eq('id', currentUsage.id);

    if (updateError) throw updateError;
    return currentUsage.used + 1;
  } else {
    // Create new record
    const { error: insertError } = await supabase
      .from('QueryUsage')
      .insert({
        id: generateUUID(),
        userId,
        month,
        year,
        used: 1,
        createdAt: now,
        updatedAt: now
      });

    if (insertError) throw insertError;
    return 1;
  }
}

// ✅ MAIN QUERY LIMIT HOOK WITH CROSSCHAIN SUPPORT
export async function queryLimitHook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = request.body as QueryLimitBody;
    const params = request.params as QueryLimitParams;
    
    // Handle wallet-less routes
    const walletLessRoutes = ['/markPaid', 'markPaid'];
    const isWalletLessRoute = walletLessRoutes.some(route => 
      request.url.includes(route) || request.routerPath?.includes(route)
    );

    let walletAddress: string | undefined;
    let blockchainId: string | undefined;

    if (isWalletLessRoute) {
      const invoiceId = params?.id;
      
      if (invoiceId) {
        const walletInfo = await getWalletInfoFromInvoice(invoiceId);
        if (walletInfo) {
          walletAddress = walletInfo.walletAddress;
          blockchainId = walletInfo.blockchainId;
        } else {
          return;
        }
      } else {
        return;
      }
    } else {
      walletAddress = body?.walletAddress || params?.walletAddress;
      blockchainId = body?.blockchainId || params?.blockchainId;
    }

    const shouldIncrementUsage = body?.incrementUsage !== false;
    const isLenientMode = isWalletLessRoute;

    // Validate wallet info
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      if (!isWalletLessRoute) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid or missing wallet address',
          code: 'INVALID_WALLET_ADDRESS',
        });
      } else {
        return;
      }
    }

    if (!blockchainId) {
      if (!isWalletLessRoute) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required field: blockchainId',
          code: 'MISSING_BLOCKCHAIN_ID',
        });
      } else {
        return;
      }
    }

    // UTC-safe date handling
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    // ✅ Find user supporting both primary and CrossChainIdentity
    const userResult = await findUserByWallet(walletAddress, blockchainId);

    if (!userResult) {
      if (isWalletLessRoute) {
        return;
      }
      return reply.status(404).send({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const { user, source: walletSource, crossChainIdentityId } = userResult;

    // ✅ Resolve effective plan with organization support
    const { effectivePlan, planSource, currentUsers } = await resolveEffectivePlan(user);

    if (!effectivePlan) {
      if (isWalletLessRoute) {
        return;
      }
      return reply.status(500).send({
        success: false,
        error: 'System configuration error: No plan available',
        code: 'NO_PLAN_AVAILABLE',
      });
    }

    // Check trial and plan status
    const trialActive = isTrialActive(user.trialStartDate);
    const planName = effectivePlan.name;

    let usageInfo: any;
    let newUsageCount = 0;

    // ✅ PLAN-SPECIFIC PROCESSING
    switch (planName) {
      case 'Free':
        if (!trialActive && !isLenientMode) {
          return reply.status(403).send({
            success: false,
            error: 'Free trial expired. Please upgrade your plan.',
            code: 'TRIAL_EXPIRED',
            data: {
              trialActive: false,
              planName,
              upgradeRequired: true,
            },
          });
        }

        usageInfo = await getFreeUserUsage(user.id);
        
        if (!usageInfo.canQuery && !isLenientMode) {
          return reply.status(429).send({
            success: false,
            error: 'Free trial query limit exceeded',
            message: 'You have used all queries in your 5-day trial period. Please upgrade your plan.',
            code: 'TRIAL_LIMIT_EXCEEDED',
            data: {
              currentUsage: usageInfo.used,
              limit: usageInfo.limit,
              remaining: 0,
              plan: planName,
              trialActive: true,
            },
          });
        }

        if (shouldIncrementUsage) {
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
        break;

      case 'Basic':
        usageInfo = await getBasicUserUsage(user.id, currentMonth, currentYear);

        if (!usageInfo.canQuery && !isLenientMode) {
          return reply.status(429).send({
            success: false,
            error: 'Basic plan monthly limit exceeded',
            message: `You have reached your monthly query limit of ${usageInfo.limit.toLocaleString()} queries.`,
            code: 'QUERY_LIMIT_EXCEEDED',
            data: {
              currentUsage: usageInfo.used,
              limit: usageInfo.limit,
              remaining: 0,
              plan: planName,
              planSource,
            },
          });
        }

        if (shouldIncrementUsage) {
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
        break;

      case 'Pro':
        usageInfo = await getPaidPlanUsage(user, 'Pro', currentMonth, currentYear, planSource);

        if (!usageInfo.canQuery && !isLenientMode) {
          return reply.status(429).send({
            success: false,
            error: 'Pro plan monthly limit exceeded',
            message: `You have reached your monthly query limit of ${usageInfo.limit.toLocaleString()} queries.`,
            code: 'QUERY_LIMIT_EXCEEDED',
            data: {
              currentUsage: usageInfo.used,
              limit: usageInfo.limit,
              remaining: 0,
              plan: planName,
              planSource,
              userCount: currentUsers,
              userLimit: effectivePlan.userLimit,
            },
          });
        }

        if (shouldIncrementUsage) {
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
        break;

      case 'Premium':
        usageInfo = await getPaidPlanUsage(user, 'Premium', currentMonth, currentYear, planSource);

        if (!usageInfo.canQuery && !isLenientMode) {
          return reply.status(429).send({
            success: false,
            error: 'Premium plan monthly limit exceeded',
            message: `You have reached your monthly query limit of ${usageInfo.limit.toLocaleString()} queries.`,
            code: 'QUERY_LIMIT_EXCEEDED',
            data: {
              currentUsage: usageInfo.used,
              limit: usageInfo.limit,
              remaining: 0,
              plan: planName,
              planSource,
              userCount: currentUsers,
              userLimit: effectivePlan.userLimit,
            },
          });
        }

        if (shouldIncrementUsage) {
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
        break;

      default:
        usageInfo = await getBasicUserUsage(user.id, currentMonth, currentYear);
        
        if (shouldIncrementUsage) {
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
    }

    // ✅ Attach context with CrossChain info
    const queryContext: QueryContext = {
      userId: user.id,
      currentUsage: newUsageCount,
      limit: usageInfo.limit,
      remaining: Math.max(0, usageInfo.limit - newUsageCount),
      plan: planName,
      planId: effectivePlan.id,
      trialActive: planName === 'Free' ? trialActive : false,
      planSource,
      userCount: currentUsers,
      userLimit: effectivePlan.userLimit,
      month: currentMonth,
      year: currentYear,
      walletSource,
      crossChainIdentityId
    };

    (request as any).queryContext = queryContext;
    return;

  } catch (error) {
    const walletLessRoutes = ['/markPaid', 'markPaid'];
    const isWalletLessRoute = walletLessRoutes.some(route => 
      request.url.includes(route) || request.routerPath?.includes(route)
    );
    
    if (isWalletLessRoute) {
      return;
    }
    
    return reply.status(500).send({
      success: false,
      error: 'Internal server error in query limit validation',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}

// ✅ Export helper functions for use in other parts of the application
export { 
  resolveEffectivePlan,
  getFreeUserUsage,
  getBasicUserUsage,
  getPaidPlanUsage,
  getOrganizationUsage,
  findUserByWallet,
  PLAN_LIMITS
};
