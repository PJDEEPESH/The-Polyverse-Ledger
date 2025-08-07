// src/middleware/transactionLimit.ts - PRODUCTION VERSION WITH CROSSCHAIN SUPPORT
import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';
import { isTrialActive } from '../utils/isTrialActive.js';

interface TransactionLimitBody {
  walletAddress?: string;
  blockchainId?: string;
  userWalletAddress?: string;
  amount?: number;
  userId: string; 
  incrementUsage?: boolean;
}

interface TransactionLimitParams {
  walletAddress?: string;
  blockchainId?: string;
  id?: string;
}

interface UserInfo {
  userId: string;
  source: 'primary' | 'crosschain';
  crossChainIdentityId?: string;
  planData: any;
}

// ✅ Find user supporting both primary and CrossChain wallets
async function findUserByWallet(walletAddress: string, blockchainId: string): Promise<UserInfo | null> {
  try {
    // Check primary wallet (User table)
    const { data: primaryUser, error: primaryError } = await supabase
      .from('User')
      .select(`
        id, 
        planId, 
        trialStartDate, 
        trialUsed,
        Plan!planId(
          id,
          name,
          txnLimit,
          userLimit
        )
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (primaryError && primaryError.code !== 'PGRST116') {
      throw new Error(`Primary user query failed: ${primaryError.message}`);
    }

    if (primaryUser) {
      return {
        userId: primaryUser.id,
        source: 'primary',
        planData: primaryUser
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
          trialStartDate, 
          trialUsed,
          Plan!planId(
            id,
            name,
            txnLimit,
            userLimit
          )
        )
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (crossChainError && crossChainError.code !== 'PGRST116') {
      throw new Error(`CrossChain user query failed: ${crossChainError.message}`);
    }

    if (crossChainUser && crossChainUser.User) {
      const userData = Array.isArray(crossChainUser.User) ? crossChainUser.User[0] : crossChainUser.User;
      return {
        userId: userData.id,
        source: 'crosschain',
        crossChainIdentityId: crossChainUser.id,
        planData: userData
      };
    }

    return null;
  } catch (error) {
    throw new Error(`Failed to find user by wallet: ${error}`);
  }
}

// ✅ Get monthly transaction volume for user (includes all wallets)
async function getMonthlyTransactionVolume(userId: string, month: number, year: number) {
  try {
    // Get transactions for the primary user
    const { data: transactions, error } = await supabase
      .from('Transaction')
      .select('amount')
      .eq('userId', userId)
      .gte('createdAt', `${year}-${month.toString().padStart(2, '0')}-01`)
      .lt('createdAt', month === 12 ? `${year + 1}-01-01` : `${year}-${(month + 1).toString().padStart(2, '0')}-01`);

    if (error) {
      throw new Error(`Failed to fetch transactions: ${error.message}`);
    }

    const volume = transactions?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;
    return volume;
  } catch (error) {
    throw new Error(`Failed to calculate monthly transaction volume: ${error}`);
  }
}

// ✅ Get wallet info from invoice ID (supports CrossChain)
async function getWalletInfoFromInvoice(invoiceId: string) {
  try {
    // Get invoice with user info
    const { data: invoice, error } = await supabase
      .from('Invoice')
      .select(`
        id,
        walletAddress,
        blockchainId,
        userId,
        crossChainIdentityId
      `)
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) {
      return null;
    }

    return {
      walletAddress: invoice.walletAddress,
      blockchainId: invoice.blockchainId,
      userId: invoice.userId,
      crossChainIdentityId: invoice.crossChainIdentityId
    };
  } catch (error) {
    return null;
  }
}

export async function transactionLimitHook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = request.body as TransactionLimitBody;
    const params = request.params as TransactionLimitParams;
    
    let walletAddress: string = '';
    let blockchainId: string = '';
    let transactionAmount = 0;
    let isWalletLessRoute = false;

    // ✅ Handle different route patterns including wallet-less routes
    if (request.url.includes('/markPaid')) {
      isWalletLessRoute = true;
      const invoiceId = params?.id;
      
      if (invoiceId) {
        // Get wallet info from invoice
        const invoiceWalletInfo = await getWalletInfoFromInvoice(invoiceId);
        if (invoiceWalletInfo) {
          walletAddress = invoiceWalletInfo.walletAddress;
          blockchainId = invoiceWalletInfo.blockchainId;
        } else {
          return; // Allow markPaid to proceed without validation
        }
      } else if (body?.userWalletAddress) {
        // Fallback to body wallet address
        walletAddress = body.userWalletAddress;
        // Try to get blockchain ID from user lookup
        const userInfo = await findUserByWallet(walletAddress, '');
        if (userInfo) {
          const { data: user } = await supabase
            .from('User')
            .select('blockchainId')
            .eq('id', userInfo.userId)
            .single();
          blockchainId = user?.blockchainId || '';
        }
      } else {
        return;
      }
      
      transactionAmount = 0; // MarkPaid doesn't involve new transaction amount
      
    } else if (request.method === 'POST' && request.url.includes('/invoices')) {
      // Invoice creation
      walletAddress = body?.userWalletAddress || body?.walletAddress || '';
      blockchainId = body?.blockchainId || '';
      transactionAmount = body?.amount || 0;
      
    } else {
      // Regular routes with wallet params
      walletAddress = body?.walletAddress || params?.walletAddress || '';
      blockchainId = body?.blockchainId || params?.blockchainId || '';
      transactionAmount = body?.amount || 0;
    }

    // ✅ Validate wallet address format
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      if (isWalletLessRoute) {
        return;
      }
      return reply.status(400).send({
        success: false,
        error: 'Invalid or missing wallet address',
        code: 'INVALID_WALLET_ADDRESS',
      });
    }

    if (!blockchainId) {
      if (isWalletLessRoute) {
        return;
      }
      return reply.status(400).send({
        success: false,
        error: 'Missing required field: blockchainId',
        code: 'MISSING_BLOCKCHAIN_ID',
      });
    }

    // Get current date
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    // ✅ Find user supporting both primary and CrossChain wallets
    const userInfo = await findUserByWallet(walletAddress, blockchainId);

    if (!userInfo) {
      if (isWalletLessRoute) {
        return;
      }
      return reply.status(404).send({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const { userId, source, planData } = userInfo;

    // ✅ Resolve effective plan
    let effectivePlan = null;
    let planSource = 'free';

    if (planData.planId && planData.Plan) {
      const individualPlan = Array.isArray(planData.Plan) ? planData.Plan[0] : planData.Plan;
      effectivePlan = individualPlan;
      planSource = 'individual';
    }

    if (!effectivePlan) {
      // Default plan limits
      effectivePlan = {
        name: 'Free',
        txnLimit: 5000, // $5,000 for Free plan
        userLimit: 1
      };
      planSource = 'free';
    }

    // ✅ Skip transaction amount checking for markPaid route
    if (request.url.includes('/markPaid')) {
      // Only check trial status for free users
      if (planSource === 'free') {
        const trialActive = isTrialActive(planData.trialStartDate);
        if (!trialActive) {
          return reply.status(403).send({
            success: false,
            error: 'Free trial expired. Please upgrade your plan.',
            code: 'TRIAL_EXPIRED'
          });
        }
      }
      
      return; // Allow markPaid to proceed
    }

    // Check if plan has unlimited transactions
    if (effectivePlan.txnLimit === null || effectivePlan.txnLimit === undefined) {
      return;
    }

    // ✅ Calculate current monthly transaction volume (for the primary user)
    let currentVolume = 0;
    
    if (transactionAmount > 0) {
      // Always use the primary user ID for transaction volume calculation
      // This ensures CrossChain users share limits with their primary account
      currentVolume = await getMonthlyTransactionVolume(userId, currentMonth, currentYear);

      // Check if this transaction would exceed the limit
      const newTotalVolume = currentVolume + transactionAmount;
      
      if (newTotalVolume > effectivePlan.txnLimit) {
        return reply.status(429).send({
          success: false,
          error: 'Monthly transaction limit exceeded',
          message: `This transaction would exceed your monthly limit of $${effectivePlan.txnLimit.toLocaleString()}. Current usage: $${currentVolume.toLocaleString()}, Transaction amount: $${transactionAmount.toLocaleString()}`,
          code: 'TRANSACTION_LIMIT_EXCEEDED',
          data: {
            currentVolume,
            limit: effectivePlan.txnLimit,
            transactionAmount,
            remaining: Math.max(0, effectivePlan.txnLimit - currentVolume),
            plan: effectivePlan.name,
            planSource,
            userType: source,
            period: { month: currentMonth, year: currentYear },
          },
        });
      }
    }

    // ✅ Check trial status for free users
    if (planSource === 'free') {
      const trialActive = isTrialActive(planData.trialStartDate);
      if (!trialActive) {
        return reply.status(403).send({
          success: false,
          error: 'Free trial expired. Please upgrade your plan.',
          code: 'TRIAL_EXPIRED'
        });
      }
    }

    // ✅ Attach transaction context to request with CrossChain info
    (request as any).transactionContext = {
      userId,
      userType: source,
      crossChainIdentityId: userInfo.crossChainIdentityId,
      currentVolume,
      limit: effectivePlan.txnLimit,
      remaining: effectivePlan.txnLimit ? effectivePlan.txnLimit - (currentVolume + transactionAmount) : null,
      plan: effectivePlan.name,
      planSource,
      transactionAmount,
    };

    return;

  } catch (error) {
    // For wallet-less routes, continue even if there's an error
    const isWalletLessRoute = request.url.includes('/markPaid');
    if (isWalletLessRoute) {
      return;
    }
    
    return reply.status(500).send({
      success: false,
      error: 'Internal server error in transaction limit validation',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}

// ✅ Export helper function for use in other parts of the application
export { findUserByWallet, getMonthlyTransactionVolume };
