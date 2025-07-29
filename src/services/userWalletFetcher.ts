// src/services/userWalletFetcher.ts
import { supabase } from '../lib/supabaseClient.js';

export async function fetchWalletData(walletAddress: string, blockchainId: string) {
  // 1. Try to find primary user (wallet owned by User)
  const { data: primaryUser, error: userError } = await supabase
    .from('User')
    .select(`
      *,
      Plan!planId(name, queryLimit, userLimit, txnLimit),
      QueryUsage(used)
    `)
    .eq('walletAddress', walletAddress)
    .eq('blockchainId', blockchainId)
    .maybeSingle();

  if (userError) throw userError;

  if (primaryUser) {
    // Found as direct user wallet
    const planData = primaryUser.Plan?.[0];
    return {
      ...primaryUser,
      source: 'primary',
      planName: planData?.name || 'Free',
      queriesLimit: planData?.queryLimit || 100,
      queriesUsed: primaryUser.QueryUsage?.[0]?.used || 0,
      userLimit: planData?.userLimit || 1,
      txnLimit: planData?.txnLimit || 10
    };
  }

  // 2. Fallback to cross-chain identity (wallet owned as CrossChainIdentity)
  const { data: crossChainIdentity, error: ccError } = await supabase
    .from('CrossChainIdentity')
    .select(`
      *,
      User!userId(
        id,
        planId,
        Plan!planId(name, queryLimit, userLimit, txnLimit),
        QueryUsage(used)
      ),
      Blockchain!blockchainId(name, ubid)
    `)
    .eq('walletAddress', walletAddress)
    .eq('blockchainId', blockchainId)
    .maybeSingle();

  if (ccError) throw ccError;

  if (crossChainIdentity && crossChainIdentity.User) {
    const userData = Array.isArray(crossChainIdentity.User) ? crossChainIdentity.User[0] : crossChainIdentity.User;
    const planData = userData.Plan?.[0];
    return {
      ...crossChainIdentity,
      source: 'crosschain',
      planName: planData?.name || 'Free',
      queriesLimit: planData?.queryLimit || 100,
      queriesUsed: userData.QueryUsage?.[0]?.used || 0,
      userLimit: planData?.userLimit || 1,
      txnLimit: planData?.txnLimit || 10,
      mainUserId: userData.id,
      planId: userData.planId,
      blockchain: crossChainIdentity.Blockchain
    };
  }

  // 3. Not found anywhere
  return null;
}
