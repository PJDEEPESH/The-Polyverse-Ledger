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
      const identityId = generateUUID();
      
      const { data: identity, error } = await supabase
        .from('CrossChainIdentity')
        .insert({
          id: identityId,
          userId,
          blockchainId,
          walletAddress,
          proofHash: generateUUID(),
          creditScore: null, // ✅ Start with null, calculate later
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

      // ✅ 5. Calculate initial credit score dynamically
      let calculatedScore = 300; // fallback
      try {
        calculatedScore = await CreditScoreService.calculateCrossChainScore(identityId);
      } catch (scoreError) {
        // Update with fallback score
        await supabase
          .from('CrossChainIdentity')
          .update({ creditScore: calculatedScore })
          .eq('id', identityId);
      }

      // ✅ 6. Also recalculate user's main credit score
      try {
        await CreditScoreService.calculateScore(userId);
      } catch (scoreError) {
      }

      return {
        ...identity,
        creditScore: calculatedScore, // Return the calculated score
        countsTowardLimit: canAdd.wouldCount,
        message: `Wallet added successfully with credit score ${calculatedScore}`
      };

    } catch (error) {
      throw error;
    }
  }
}
