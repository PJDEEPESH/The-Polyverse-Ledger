// src/services/crossChainIdentity.ts - FIXED VERSION
import { supabase } from '../lib/supabaseClient.js';
import { CreditScoreService } from './creditScore.js';
import { checkUserPlanLimits, canAddWalletToUser } from '../utils/checkUserPlanLimits.js';
import { generateUUID } from '../utils/ubid.js';

export class CrossChainIdentityService {
  static async createIdentity(
    userId: string, 
    blockchainId: string, 
    walletAddress: string, 
    metadataURI?: string
  ) {
    try {
      // ✅ 1. Validate user plan and wallet limits
      const canAdd = await canAddWalletToUser(userId, walletAddress, blockchainId);
      
      if (!canAdd.canAdd) {
        throw new Error(`Cannot add wallet: ${canAdd.reason}`);
      }

      // ✅ 2. Check if wallet already exists
      const { data: existingWallet } = await supabase
        .from('CrossChainIdentity')
        .select('id, userId')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (existingWallet) {
        if (existingWallet.userId === userId) {
          throw new Error('Wallet already added to your account');
        } else {
          throw new Error('Wallet already registered by another user');
        }
      }

      // ✅ 3. Ensure blockchain exists
      const { data: blockchain } = await supabase
        .from('Blockchain')
        .select('id')
        .eq('id', blockchainId)
        .maybeSingle();

      if (!blockchain) {
        const { error: blockchainError } = await supabase
          .from('Blockchain')
          .upsert({
            id: blockchainId,
            name: `Chain ${blockchainId}`,
            ubid: generateUUID(),
            apiKey: generateUUID(),
            networkType: 'custom',
            chainProtocol: 'custom',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

        if (blockchainError) throw blockchainError;
      }

      // ✅ 4. Create the identity
      const now = new Date().toISOString();
      const { data: identity, error } = await supabase
        .from('CrossChainIdentity')
        .insert({
          id: generateUUID(),
          userId,
          blockchainId,
          walletAddress,
          proofHash: generateUUID(), // Generate proper proof
          createdAt: now,
          updatedAt: now,
        })
        .select(`
          *,
          User!userId(id, planId),
          Blockchain!blockchainId(name, ubid)
        `)
        .single();

      if (error) throw error;

      // ✅ 5. Recalculate credit score
      try {
        await CreditScoreService.calculateScore(userId);
        console.log(`✅ Credit score recalculated after identity creation: ${userId}`);
      } catch (scoreError) {
        console.error('⚠️ Error recalculating credit score:', scoreError);
      }

      return {
        ...identity,
        countsTowardLimit: canAdd.wouldCount,
        message: `Wallet added successfully ${canAdd.wouldCount ? '(counts toward limit)' : '(cross-chain duplicate)'}`
      };

    } catch (error) {
      console.error('CrossChainIdentity creation error:', error);
      throw error;
    }
  }

  // ✅ Get all identities for a user
  static async getUserIdentities(userId: string) {
    const { data: identities, error } = await supabase
      .from('CrossChainIdentity')
      .select(`
        *,
        Blockchain!blockchainId(name, ubid)
      `)
      .eq('userId', userId)
      .order('createdAt', { ascending: false });

    if (error) throw error;
    return identities || [];
  }

  // ✅ Remove identity with plan validation
  static async removeIdentity(identityId: string, userId: string) {
    // Verify ownership
    const { data: identity } = await supabase
      .from('CrossChainIdentity')
      .select('userId')
      .eq('id', identityId)
      .single();

    if (!identity || identity.userId !== userId) {
      throw new Error('Identity not found or access denied');
    }

    const { error } = await supabase
      .from('CrossChainIdentity')
      .delete()
      .eq('id', identityId);

    if (error) throw error;

    // Recalculate credit score after removal
    try {
      await CreditScoreService.calculateScore(userId);
    } catch (scoreError) {
      console.error('⚠️ Error recalculating credit score after removal:', scoreError);
    }

    return { success: true, message: 'Wallet removed successfully' };
  }
}
