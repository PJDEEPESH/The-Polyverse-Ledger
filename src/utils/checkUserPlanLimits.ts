// src/utils/checkUserPlanLimits.ts - CORRECTED VERSION WITH CROSSCHAIN SUPPORT
import { supabase } from '../lib/supabaseClient.js';
import { isTrialActive } from './isTrialActive.js';

export interface PlanInfo {
  planName: string;
  allowedWallets: number;
  usedWallets: number;
  queryLimit: number;
  txnLimit: number | null;
  trialActive: boolean;
  walletDetails: WalletInfo[];
}

export interface WalletInfo {
  id: string;
  walletAddress: string;
  blockchainId: string;
  blockchainName: string;
  hasUBID: boolean;
  isUnique: boolean; // counts toward wallet limit
  isPrimary: boolean;
  creditScore: number;
  createdAt: string;
  source: 'primary' | 'crosschain';
}

/**
 * ✅ ENHANCED: Get all wallets for a user (primary + cross-chain) with CrossChain support
 */
async function getAllUserWallets(userId: string) {
  try {
    console.log(`🔍 Getting all wallets for user: ${userId}`);

    // ✅ FIXED: Get primary wallet from User table
    const { data: primaryUser, error: primaryError } = await supabase
      .from('User')
      .select(`
        id, 
        walletAddress, 
        blockchainId, 
        createdAt, 
        creditScore,
        blockchain:Blockchain!blockchainId(name, ubid)
      `)
      .eq('id', userId)
      .maybeSingle();

    if (primaryError) {
      console.error('Error fetching primary user:', primaryError);
    }

    // ✅ FIXED: Get cross-chain identities with blockchain info
    const { data: crossChainWallets, error: crossChainError } = await supabase
      .from('CrossChainIdentity')
      .select(`
        id, 
        walletAddress, 
        blockchainId, 
        createdAt, 
        creditScore,
        blockchain:Blockchain!blockchainId(name, ubid)
      `)
      .eq('userId', userId);

    if (crossChainError) {
      console.error('Error fetching cross-chain wallets:', crossChainError);
    }

    const allWallets = [];

    // Add primary wallet
    if (primaryUser && primaryUser.walletAddress) {
      const blockchain = Array.isArray(primaryUser.blockchain) ? primaryUser.blockchain[0] : primaryUser.blockchain;
      
      allWallets.push({
        id: primaryUser.id,
        walletAddress: primaryUser.walletAddress,
        blockchainId: primaryUser.blockchainId,
        blockchainName: blockchain?.name || 'Unknown',
        hasUBID: !!blockchain?.ubid,
        isPrimary: true,
        creditScore: primaryUser.creditScore || 0,
        createdAt: primaryUser.createdAt,
        source: 'primary' as const,
      });
      
      console.log(`✅ Added primary wallet: ${primaryUser.walletAddress}`);
    }

    // Add cross-chain wallets
    if (crossChainWallets && crossChainWallets.length > 0) {
      for (const wallet of crossChainWallets) {
        const blockchain = Array.isArray(wallet.blockchain) ? wallet.blockchain[0] : wallet.blockchain;
        
        allWallets.push({
          id: wallet.id,
          walletAddress: wallet.walletAddress,
          blockchainId: wallet.blockchainId,
          blockchainName: blockchain?.name || 'Unknown',
          hasUBID: !!blockchain?.ubid,
          isPrimary: false,
          creditScore: wallet.creditScore || 0,
          createdAt: wallet.createdAt,
          source: 'crosschain' as const,
        });
      }
      
      console.log(`✅ Added ${crossChainWallets.length} cross-chain wallets`);
    }

    console.log(`📊 Total wallets found: ${allWallets.length}`);
    return allWallets;
    
  } catch (error) {
    console.error('Error fetching user wallets:', error);
    return [];
  }
}

/**
 * ✅ ENHANCED: Get credit score for a specific wallet (supports CrossChain)
 */
async function getCreditScoreForWallet(walletAddress: string, blockchainId: string): Promise<number> {
  try {
    // First check if it's a primary wallet
    const { data: user } = await supabase
      .from('User')
      .select('creditScore')
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (user) {
      return user.creditScore || 0;
    }

    // ✅ ENHANCED: Check CrossChainIdentity for credit score
    const { data: crossChainWallet } = await supabase
      .from('CrossChainIdentity')
      .select('creditScore')
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (crossChainWallet) {
      return crossChainWallet.creditScore || 0;
    }

    return 0;
  } catch (error) {
    console.error('Error fetching credit score:', error);
    return 0;
  }
}

/**
 * Apply wallet counting logic (your 3 rules)
 */
function applyWalletCountingLogic(wallets: any[]): WalletInfo[] {
  const addressGroups = new Map<string, any[]>();
  
  // Group by wallet address (case insensitive)
  wallets.forEach(wallet => {
    const address = wallet.walletAddress.toLowerCase();
    if (!addressGroups.has(address)) {
      addressGroups.set(address, []);
    }
    addressGroups.get(address)!.push(wallet);
  });

  const result: WalletInfo[] = [];

  addressGroups.forEach((walletsForAddress) => {
    if (walletsForAddress.length === 1) {
      // Rule 2: Single wallet always counts
      const wallet = walletsForAddress[0];
      result.push({
        ...wallet,
        isUnique: true,
      });
    } else {
      // Multiple chains for same address
      const hasAnyUBID = walletsForAddress.some(w => w.hasUBID);
      
      walletsForAddress.forEach((wallet, index) => {
        if (hasAnyUBID) {
          // Rule 3: With UBID, each UBID-enabled chain counts
          result.push({
            ...wallet,
            isUnique: wallet.hasUBID, // Only UBID-enabled ones count
          });
        } else {
          // Rule 1: Same wallet on many chains = count as 1
          result.push({
            ...wallet,
            isUnique: index === 0, // Only first one counts
          });
        }
      });
    }
  });

  return result;
}

/**
 * ✅ ENHANCED: Main function supporting both User ID and CrossChainIdentity ID
 */
export async function checkUserPlanLimits(identifier: string): Promise<PlanInfo> {
  try {
    console.log(`🔍 Checking plan limits for identifier: ${identifier}`);
    
    let userId: string;
    let user: any = null;
    
    // ✅ NEW: Check if identifier is a CrossChainIdentity ID first
    const { data: crossChainIdentity, error: crossChainError } = await supabase
      .from('CrossChainIdentity')
      .select(`
        id,
        userId,
        User!userId(
          id,
          planId,
          trialStartDate,
          trialUsed
        )
      `)
      .eq('id', identifier)
      .maybeSingle();

    if (crossChainError && crossChainError.code !== 'PGRST116') {
      console.error('Error checking CrossChainIdentity:', crossChainError);
    }

    if (crossChainIdentity && crossChainIdentity.User) {
      // It's a CrossChainIdentity ID
      const userData = Array.isArray(crossChainIdentity.User) ? crossChainIdentity.User[0] : crossChainIdentity.User;
      userId = userData.id;
      user = userData;
      console.log(`✅ Found user via CrossChainIdentity: ${userId}`);
    } else {
      // Assume it's a User ID
      const { data: directUser, error: userError } = await supabase
        .from('User')
        .select(`
          id,
          planId,
          trialStartDate,
          trialUsed
        `)
        .eq('id', identifier)
        .maybeSingle();

      if (userError) {
        console.error('Error checking User:', userError);
        throw new Error(`Database error: ${userError.message}`);
      }

      if (directUser) {
        userId = directUser.id;
        user = directUser;
        console.log(`✅ Found direct user: ${userId}`);
      } else {
        console.log(`❌ No user found for identifier: ${identifier}`);
        throw new Error('User not found');
      }
    }

    // Get plan details separately
    let plan = null;
    if (user.planId) {
      const { data: planData } = await supabase
        .from('Plan')
        .select('name, queryLimit, userLimit, txnLimit')
        .eq('id', user.planId)
        .single();
      plan = planData;
    }

    const trialActive = isTrialActive(user.trialStartDate);

    // ✅ ENHANCED: Determine plan defaults with better fallbacks
    const planName = plan?.name || 'Free';
    const queryLimit = plan?.queryLimit || 100; // ✅ FIXED: Free plan should have 100, not 1000
    const allowedWallets = plan?.userLimit ?? (planName === 'Free' ? 1 : 3); // Default based on plan
    const txnLimit = plan?.txnLimit ?? null;

    console.log(`📊 Plan info: ${planName}, wallets: ${allowedWallets}, queries: ${queryLimit}`);

    // Get all user wallets
    const allWallets = await getAllUserWallets(userId);
    
    // Apply counting logic
    const walletDetails = applyWalletCountingLogic(allWallets);
    const usedWallets = walletDetails.filter(w => w.isUnique).length;

    console.log(`🔢 Wallet count: ${usedWallets}/${allowedWallets} used`);

    // ✅ ENHANCED: Better trial/plan validation
    if (planName === 'Free' && !trialActive) {
      console.log('❌ Free plan trial expired');
      // Don't throw error, just mark trial as inactive
    }

    return {
      planName,
      allowedWallets,
      usedWallets,
      queryLimit,
      txnLimit,
      trialActive,
      walletDetails,
    };

  } catch (error) {
    console.error('Error checking user plan limits:', error);
    throw error;
  }
}

/**
 * ✅ ENHANCED: Check if user can add a new wallet (supports CrossChain)
 */
export async function canAddWalletToUser(
  userIdOrCrossChainId: string,
  newWalletAddress: string,
  blockchainId: string
): Promise<{
  canAdd: boolean;
  reason?: string;
  wouldCount: boolean;
}> {
  try {
    console.log(`🔍 Checking if can add wallet ${newWalletAddress} to user ${userIdOrCrossChainId}`);
    
    const planInfo = await checkUserPlanLimits(userIdOrCrossChainId);
    
    // ✅ ENHANCED: Check if this wallet already exists anywhere in the system
    const [existingPrimary, existingCrossChain] = await Promise.all([
      supabase
        .from('User')
        .select('id, walletAddress')
        .eq('walletAddress', newWalletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle(),
      
      supabase
        .from('CrossChainIdentity')
        .select('id, walletAddress, userId')
        .eq('walletAddress', newWalletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle()
    ]);

    // Check if wallet already exists for this user
    const existingWallet = planInfo.walletDetails.find(
      w => w.walletAddress.toLowerCase() === newWalletAddress.toLowerCase()
    );

    let wouldCount = true;
    
    if (existingWallet) {
      // Get blockchain UBID info
      const { data: blockchain } = await supabase
        .from('Blockchain')
        .select('ubid')
        .eq('id', blockchainId)
        .single();
      
      if (blockchain?.ubid) {
        // Rule 3: With UBID, each chain counts
        wouldCount = true;
      } else {
        // Rule 1: Same wallet on multiple chains = doesn't count
        wouldCount = false;
      }
    }
    
    const newCount = wouldCount ? planInfo.usedWallets + 1 : planInfo.usedWallets;
    const canAdd = newCount <= planInfo.allowedWallets;

    let reason: string | undefined;
    if (!canAdd) {
      reason = `Would exceed ${planInfo.planName} plan limit of ${planInfo.allowedWallets} wallets (currently using ${planInfo.usedWallets})`;
    }

    console.log(`📊 Can add wallet: ${canAdd}, would count: ${wouldCount}, new total: ${newCount}/${planInfo.allowedWallets}`);

    return {
      canAdd,
      reason,
      wouldCount,
    };

  } catch (error) {
    console.error('Error checking if can add wallet:', error);
    return {
      canAdd: false,
      reason: 'Failed to check wallet limits',
      wouldCount: false,
    };
  }
}

/**
 * ✅ NEW: Helper function to get user ID from any identifier
 */
export async function getUserIdFromIdentifier(identifier: string): Promise<string | null> {
  try {
    // Check if it's a CrossChainIdentity ID
    const { data: crossChainIdentity } = await supabase
      .from('CrossChainIdentity')
      .select('userId')
      .eq('id', identifier)
      .maybeSingle();

    if (crossChainIdentity) {
      return crossChainIdentity.userId;
    }

    // Check if it's a User ID
    const { data: user } = await supabase
      .from('User')
      .select('id')
      .eq('id', identifier)
      .maybeSingle();

    if (user) {
      return user.id;
    }

    return null;
  } catch (error) {
    console.error('Error getting user ID from identifier:', error);
    return null;
  }
}
