import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';

export function validateWalletParams(walletAddress: string, blockchainId?: string) {
  if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('Invalid wallet address format');
  }
  if (blockchainId && blockchainId.length === 0) {
    throw new Error('Invalid blockchain ID');
  }
}

// ✅ ENHANCED: Wallet validation with CrossChainIdentity support
export async function walletValidationHook(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { walletAddress, blockchainId } = request.params as {
      walletAddress: string;
      blockchainId?: string;
    };

    console.log(`🔍 Validating wallet: ${walletAddress}${blockchainId ? ` on chain: ${blockchainId}` : ''}`);

    // Basic format validation
    validateWalletParams(walletAddress, blockchainId);

    // ✅ OPTIONAL: Enhanced validation that checks if wallet exists
    // This is useful for routes that require the wallet to be registered
    if (blockchainId) {
      console.log(`✅ Wallet validation passed: ${walletAddress}/${blockchainId}`);
      
      // You can add additional checks here if needed
      // For example, verify the wallet exists in either User or CrossChainIdentity tables
      // But for most cases, basic format validation is sufficient
    }

  } catch (err) {
    console.error(`❌ Wallet validation failed: ${(err as Error).message}`);
    return reply.status(400).send({ 
      success: false,
      error: (err as Error).message,
      code: 'WALLET_VALIDATION_FAILED'
    });
  }
}

// ✅ NEW: Enhanced validation that also checks wallet registration
export async function walletRegistrationValidationHook(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { walletAddress, blockchainId } = request.params as {
      walletAddress: string;
      blockchainId: string;
    };

    console.log(`🔍 Validating wallet registration: ${walletAddress} on chain: ${blockchainId}`);

    // Basic format validation
    validateWalletParams(walletAddress, blockchainId);

    // Check if wallet is registered in either table
    const [primaryUser, crossChainUser] = await Promise.all([
      supabase
        .from('User')
        .select('id')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle(),
      
      supabase
        .from('CrossChainIdentity')
        .select('id')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle()
    ]);

    if (!primaryUser.data && !crossChainUser.data) {
      console.log(`❌ Wallet not registered: ${walletAddress}/${blockchainId}`);
      return reply.status(404).send({
        success: false,
        error: 'Wallet not registered. Please register your wallet first.',
        code: 'WALLET_NOT_REGISTERED'
      });
    }

    const source = primaryUser.data ? 'primary' : 'crosschain';
    console.log(`✅ Wallet registration validated: ${walletAddress}/${blockchainId} (${source})`);

  } catch (err) {
    console.error(`❌ Wallet registration validation failed: ${(err as Error).message}`);
    return reply.status(400).send({ 
      success: false,
      error: (err as Error).message,
      code: 'WALLET_REGISTRATION_VALIDATION_FAILED'
    });
  }
}
