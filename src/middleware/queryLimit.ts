// src/middleware/queryLimit.ts - COMPLETE VERSION WITH CROSSCHAIN SUPPORT
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
  Basic: { queryLimit: 1000; userLimit: 1; price: 1900 };
  Pro: { queryLimit: 15000; userLimit: 3; price: 2900 };
  Premium: { queryLimit: 100000; userLimit: 5; price: 4900 };
}

const PLAN_LIMITS: PlanLimits = {
  Free: { queryLimit: 100, userLimit: 1, trialDays: 5 },
  Basic: { queryLimit: 1000, userLimit: 1, price: 1900 },
  Pro: { queryLimit: 15000, userLimit: 3, price: 2900 },
  Premium: { queryLimit: 100000, userLimit: 5, price: 4900 }
};

// ✅ NEW: Enhanced function to find user from wallet (supports CrossChainIdentity)
async function findUserByWallet(walletAddress: string, blockchainId: string) {
  console.log(`🔍 Looking for user with wallet: ${walletAddress} on chain: ${blockchainId}`);
  
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

  if (primaryError) {
    console.error('❌ Error checking primary user:', primaryError);
  }

  if (primaryUser) {
    console.log(`✅ Found primary user: ${primaryUser.id}`);
    return {
      user: primaryUser,
      source: 'primary' as const,
      crossChainIdentityId: null
    };
  }

  // ✅ NEW: Check CrossChainIdentity table
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

  if (crossChainError) {
    console.error('❌ Error checking CrossChain user:', crossChainError);
  }

  if (crossChainUser && crossChainUser.User) {
    const userData = Array.isArray(crossChainUser.User) ? crossChainUser.User[0] : crossChainUser.User;
    console.log(`✅ Found CrossChain user: ${userData.id} (via CrossChainIdentity: ${crossChainUser.id})`);
    return {
      user: userData,
      source: 'crosschain' as const,
      crossChainIdentityId: crossChainUser.id
    };
  }

  console.log(`❌ No user found for wallet: ${walletAddress}/${blockchainId}`);
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
    console.error('Error fetching organization plan:', error);
    return null;
  }
}

// ✅ Enhanced plan resolution supporting all plan types
async function resolveEffectivePlan(user: any) {
  let effectivePlan = null;
  let planSource: 'individual' | 'organization' | 'free' = 'free';
  let currentUsers = 1;

  // 1. Check for organization plan first (highest priority)
  if (user.orgId) {
    console.log(`🏢 User ${user.id} is in organization ${user.orgId}, checking org plan`);
    
    const orgPlan = await getOrganizationPlan(user.orgId);
    if (orgPlan) {
      console.log(`✅ Found organization plan: ${orgPlan.name} (${orgPlan.currentUsers} users)`);
      effectivePlan = orgPlan;
      planSource = 'organization';
      currentUsers = orgPlan.currentUsers;
      return { effectivePlan, planSource, currentUsers };
    }
    
    console.log(`⚠️ No organization plan found, falling back to individual plan`);
  }

  // 2. Check for individual plan
  if (user.planId && user.Plan) {
    const individualPlan = Array.isArray(user.Plan) ? user.Plan[0] : user.Plan;
    if (individualPlan) {
      console.log(`✅ Found individual plan: ${individualPlan.name}`);
      effectivePlan = {
        ...individualPlan,
        source: 'individual'
      };
      planSource = 'individual';
      return { effectivePlan, planSource, currentUsers: 1 };
    }
  }

  // 3. Default to Free plan
  console.log(`🆓 No paid plan found, using Free plan`);
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
      console.log(`📊 No members found in organization ${orgId}`);
      return 0;
    }

    console.log(`👥 Found ${members.length} members in organization ${orgId}`);

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
    console.log(`📈 Total organization usage: ${totalUsage}`);
    
    return totalUsage;
  } catch (error) {
    console.error('Error calculating organization usage:', error);
    return 0;
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
    console.log(`🔍 Fetching wallet info for invoice: ${invoiceId}`);
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
      console.log(`❌ No invoice or user found for ID: ${invoiceId}`);
      return null;
    }

    console.log(`✅ Found wallet info: ${invoice.user.walletAddress}, blockchain: ${invoice.user.blockchainId}`);
    return {
      walletAddress: invoice.user.walletAddress,
      blockchainId: invoice.user.blockchainId
    };
  } catch (error) {
    console.error('Error fetching invoice wallet info:', error);
    return null;
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
  console.log(`🚀 Query limit hook triggered for URL: ${request.url}`);
  
  try {
    const body = request.body as QueryLimitBody;
    const params = request.params as QueryLimitParams;
    
    // Handle wallet-less routes
    const walletLessRoutes = ['/markPaid', 'markPaid'];
    const isWalletLessRoute = walletLessRoutes.some(route => 
      request.url.includes(route) || request.routerPath?.includes(route)
    );

    console.log(`📋 Route analysis: isWalletLessRoute = ${isWalletLessRoute}`);

    let walletAddress: string | undefined;
    let blockchainId: string | undefined;

    if (isWalletLessRoute) {
      const invoiceId = params?.id;
      console.log(`🔑 Invoice ID from params: ${invoiceId}`);
      
      if (invoiceId) {
        const walletInfo = await getWalletInfoFromInvoice(invoiceId);
        if (walletInfo) {
          walletAddress = walletInfo.walletAddress;
          blockchainId = walletInfo.blockchainId;
          console.log(`✅ Wallet info extracted: ${walletAddress}, ${blockchainId}`);
        } else {
          console.warn(`⚠️ Could not find wallet info for invoice ${invoiceId}, continuing without tracking`);
          return;
        }
      } else {
        console.warn('⚠️ No invoice ID found for wallet-less route, continuing without tracking');
        return;
      }
    } else {
      walletAddress = body?.walletAddress || params?.walletAddress;
      blockchainId = body?.blockchainId || params?.blockchainId;
      console.log(`📝 Regular route wallet info: ${walletAddress}, ${blockchainId}`);
    }

    const shouldIncrementUsage = body?.incrementUsage !== false;
    const isLenientMode = isWalletLessRoute;

    // Validate wallet info
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      if (!isWalletLessRoute) {
        console.log(`❌ Invalid wallet for regular route: ${walletAddress}`);
        return reply.status(400).send({
          success: false,
          error: 'Invalid or missing wallet address',
          code: 'INVALID_WALLET_ADDRESS',
        });
      } else {
        console.warn('⚠️ Invalid wallet address for wallet-less route, continuing without tracking');
        return;
      }
    }

    if (!blockchainId) {
      if (!isWalletLessRoute) {
        console.log(`❌ Missing blockchain ID for regular route`);
        return reply.status(400).send({
          success: false,
          error: 'Missing required field: blockchainId',
          code: 'MISSING_BLOCKCHAIN_ID',
        });
      } else {
        console.warn('⚠️ Missing blockchain ID for wallet-less route, continuing without tracking');
        return;
      }
    }

    console.log(`✅ Valid wallet info confirmed, proceeding with query tracking`);

    // UTC-safe date handling
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    console.log(`📅 Current month/year: ${currentMonth}/${currentYear}`);

    // ✅ ENHANCED: Find user supporting both primary and CrossChainIdentity
    const userResult = await findUserByWallet(walletAddress, blockchainId);

    if (!userResult) {
      console.log(`❌ User not found: ${walletAddress}/${blockchainId}`);
      if (isWalletLessRoute) {
        console.warn('⚠️ User not found for wallet-less route, continuing without tracking');
        return;
      }
      return reply.status(404).send({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const { user, source: walletSource, crossChainIdentityId } = userResult;
    console.log(`✅ User found: ${user.id}, planId: ${user.planId}, orgId: ${user.orgId}, walletSource: ${walletSource}`);

    // ✅ Resolve effective plan with organization support
    const { effectivePlan, planSource, currentUsers } = await resolveEffectivePlan(user);

    if (!effectivePlan) {
      if (isWalletLessRoute) {
        console.warn('⚠️ No plan found for wallet-less route, continuing without tracking');
        return;
      }
      return reply.status(500).send({
        success: false,
        error: 'System configuration error: No plan available',
        code: 'NO_PLAN_AVAILABLE',
      });
    }

    console.log(`📊 Effective plan: ${effectivePlan.name} (source: ${planSource}), limit: ${effectivePlan.queryLimit}, users: ${currentUsers}/${effectivePlan.userLimit}`);

    // Check trial and plan status
    const trialActive = isTrialActive(user.trialStartDate);
    const planName = effectivePlan.name;

    console.log(`🎯 Plan analysis: plan=${planName}, trialActive=${trialActive}, planSource=${planSource}, walletSource=${walletSource}`);

    let usageInfo: any;
    let newUsageCount = 0;

    // ✅ PLAN-SPECIFIC PROCESSING (same as before)
    switch (planName) {
      case 'Free':
        console.log('🆓 Processing Free plan');
        
        if (!trialActive && !isLenientMode) {
          console.log(`❌ Trial expired for user ${user.id}`);
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
        console.log(`📈 Free user usage: ${usageInfo.used}/${usageInfo.limit}`);
        
        if (!usageInfo.canQuery && !isLenientMode) {
          console.log(`❌ Free trial limit exceeded for user ${user.id}`);
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
          console.log(`📝 Incrementing free user usage for ${user.id}`);
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
        break;

      case 'Basic':
        console.log('💼 Processing Basic plan');
        
        usageInfo = await getBasicUserUsage(user.id, currentMonth, currentYear);
        console.log(`📈 Basic user usage: ${usageInfo.used}/${usageInfo.limit}`);

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
        console.log('🚀 Processing Pro plan');
        
        usageInfo = await getPaidPlanUsage(user, 'Pro', currentMonth, currentYear, planSource);
        console.log(`📈 Pro plan usage: ${usageInfo.used}/${usageInfo.limit} (${planSource})`);

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
        console.log('💎 Processing Premium plan');
        
        usageInfo = await getPaidPlanUsage(user, 'Premium', currentMonth, currentYear, planSource);
        console.log(`📈 Premium plan usage: ${usageInfo.used}/${usageInfo.limit} (${planSource})`);

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
        console.log(`❓ Unknown plan: ${planName}, treating as Basic`);
        usageInfo = await getBasicUserUsage(user.id, currentMonth, currentYear);
        
        if (shouldIncrementUsage) {
          newUsageCount = await incrementUsage(user.id, currentMonth, currentYear);
        } else {
          newUsageCount = usageInfo.used;
        }
    }

    // ✅ ENHANCED: Attach context with CrossChain info
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
    console.log(`✅ ${planName} plan processing complete for ${walletSource} wallet, continuing to route handler`);
    return;

  } catch (error) {
    console.error('❌ Query limit hook error:', error);
    
    const walletLessRoutes = ['/markPaid', 'markPaid'];
    const isWalletLessRoute = walletLessRoutes.some(route => 
      request.url.includes(route) || request.routerPath?.includes(route)
    );
    
    if (isWalletLessRoute) {
      console.warn('⚠️ Query limit hook error for wallet-less route, continuing without tracking', error);
      return;
    }
    
    return reply.status(500).send({
      success: false,
      error: 'Internal server error in query limit validation',
      details: error instanceof Error ? error.message : String(error),
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
