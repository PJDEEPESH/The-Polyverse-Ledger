// src/services/userWalletFetcher.ts
import { supabase } from '../lib/supabaseClient.js';

export async function fetchWalletData(walletAddress: string, blockchainId: string) {
  try {
    // ✅ OPTIMIZATION: Run both queries in parallel instead of sequential
    const [primaryResult, crossChainResult] = await Promise.all([
      // Primary user with all related data
      supabase
        .from('User')
        .select(`
          *,
          Plan!planId(name, queryLimit, userLimit, txnLimit),
          QueryUsage(used, month, year)
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle(),

      // CrossChain identity with user and plan data
      supabase
        .from('CrossChainIdentity')
        .select(`
          *,
          User!userId(
            id,
            planId,
            trialStartDate,
            trialUsed,
            Plan!planId(name, queryLimit, userLimit, txnLimit),
            QueryUsage(used, month, year)
          ),
          Blockchain!blockchainId(name, ubid)
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle()
    ]);

    // Handle primary user result
    if (primaryResult.error) {
    }

    if (primaryResult.data) {
      const planData = primaryResult.data.Plan?.[0];
      return {
        ...primaryResult.data,
        source: 'primary',
        planName: planData?.name || 'Free',
        queriesLimit: planData?.queryLimit || 100,
        queriesUsed: primaryResult.data.QueryUsage?.[0]?.used || 0,
        userLimit: planData?.userLimit || 1,
        txnLimit: planData?.txnLimit || 10,
        isPrimary: true
      };
    }

    // Handle cross-chain identity result
    if (crossChainResult.error) {
    }

    if (crossChainResult.data && crossChainResult.data.User) {
      const userData = Array.isArray(crossChainResult.data.User) 
        ? crossChainResult.data.User[0] 
        : crossChainResult.data.User;
      const planData = userData.Plan?.[0];
      
      return {
        ...crossChainResult.data,
        source: 'crosschain',
        planName: planData?.name || 'Free',
        queriesLimit: planData?.queryLimit || 100,
        queriesUsed: userData.QueryUsage?.[0]?.used || 0,
        userLimit: planData?.userLimit || 1,
        txnLimit: planData?.txnLimit || 10,
        mainUserId: userData.id,
        planId: userData.planId,
        trialStartDate: userData.trialStartDate,
        trialUsed: userData.trialUsed,
        blockchain: crossChainResult.data.Blockchain,
        isPrimary: false
      };
    }

    return null;

  } catch (error) {
    throw new Error(`Failed to fetch wallet data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ✅ BONUS: Add a validation function
export function validateWalletAddress(walletAddress: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
}

// ✅ BONUS: Add a typed interface for better TypeScript support
export interface WalletData {
  source: 'primary' | 'crosschain';
  planName: string;
  queriesLimit: number;
  queriesUsed: number;
  userLimit: number;
  txnLimit: number;
  isPrimary: boolean;
  mainUserId?: string;
  planId?: string;
  trialStartDate?: string;
  trialUsed?: boolean;
  blockchain?: any;
}
