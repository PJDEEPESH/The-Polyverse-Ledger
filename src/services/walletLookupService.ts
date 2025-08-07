import { supabase } from '../lib/supabaseClient.js';

export async function getWalletWithAllData(walletAddress: string, blockchainId: string) {
  // Single optimized query that checks both tables with all relations
  const [primaryResult, crossChainResult] = await Promise.all([
    // Primary user with all related data in ONE query
    supabase
      .from('User')
      .select(`
        *,
        Plan!planId(name, queryLimit, userLimit, txnLimit),
        QueryUsage(used, month, year),
        CrossChainIdentity(id, walletAddress, blockchainId, creditScore)
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle(),

    // CrossChain identity with user and plan data in ONE query
    supabase
      .from('CrossChainIdentity')
      .select(`
        *,
        User!userId(
          id, planId, trialStartDate, trialUsed,
          Plan!planId(name, queryLimit, userLimit, txnLimit),
          QueryUsage(used, month, year)
        ),
        Blockchain!blockchainId(name, ubid)
      `)
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle()
  ]);

  // Return unified format
  if (primaryResult.data) {
    const plan = primaryResult.data.Plan?.[0];
    return {
      ...primaryResult.data,
      source: 'primary',
      planName: plan?.name || 'Free',
      queriesLimit: plan?.queryLimit || 100,
      queriesUsed: primaryResult.data.QueryUsage?.[0]?.used || 0,
      userLimit: plan?.userLimit || 1
    };
  }

  if (crossChainResult.data?.User) {
    const userData = crossChainResult.data.User;
    const plan = userData.Plan?.[0];
    return {
      ...crossChainResult.data,
      source: 'crosschain',
      planName: plan?.name || 'Free',
      queriesLimit: plan?.queryLimit || 100,
      queriesUsed: userData.QueryUsage?.[0]?.used || 0,
      mainUserId: userData.id,
      planId: userData.planId
    };
  }

  return null;
}
