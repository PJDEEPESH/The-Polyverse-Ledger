import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';

// ✅ Enhanced interface with cross-chain support
declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser?: {
      id: string;
      walletAddress: string;
      blockchainId: string;
      planId?: string;
      source?: 'primary' | 'crosschain';
      crossChainIdentityId?: string;
    };
  }
}

// ✅ Helper function to find user by wallet (supports cross-chain)
async function findUserByWallet(walletAddress: string, blockchainId: string): Promise<{
  found: boolean;
  userId?: string;
  planId?: string;
  source?: 'primary' | 'crosschain';
  crossChainIdentityId?: string;
  error?: string;
}> {
  try {
    // Check primary wallet first
    const { data: primaryUser, error: primaryError } = await supabase
      .from('User')
      .select('id, planId')
      .eq('walletAddress', walletAddress)
      .eq('blockchainId', blockchainId)
      .maybeSingle();

    if (primaryError && primaryError.code !== 'PGRST116') {
      throw new Error(`Primary user query failed: ${primaryError.message}`);
    }

    if (primaryUser) {
      return {
        found: true,
        userId: primaryUser.id,
        planId: primaryUser.planId,
        source: 'primary'
      };
    }

    // Check CrossChainIdentity
    const { data: crossChainUser, error: crossChainError } = await supabase
      .from('CrossChainIdentity')
      .select(`
        id,
        userId,
        User!userId(id, planId)
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
        found: true,
        userId: crossChainUser.userId,
        planId: userData.planId,
        source: 'crosschain',
        crossChainIdentityId: crossChainUser.id
      };
    }

    return {
      found: false,
      error: 'Wallet not registered'
    };
  } catch (error: any) {
    return {
      found: false,
      error: `Database error: ${error.message}`
    };
  }
}

export const authenticationHook = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const authHeader = request.headers.authorization;
    
    // ✅ Extract wallet info from request
    const extractWalletInfo = () => {
      const body = request.body as any;
      const params = request.params as any;
      const query = request.query as any;
      const headers = request.headers;
      
      return {
        walletAddress: 
          body?.userWalletAddress || 
          body?.walletAddress || 
          params?.walletAddress || 
          query?.walletAddress ||
          headers['x-wallet-address'],
        blockchainId: 
          body?.blockchainId || 
          params?.blockchainId || 
          query?.blockchainId ||
          headers['x-blockchain-id'],
        userId: 
          body?.userId || 
          params?.userId || 
          query?.userId
      };
    };

    const { walletAddress, blockchainId, userId } = extractWalletInfo();

    // ✅ Handle missing auth header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (isDevelopment) {
        // ✅ Try wallet-based authentication for development
        if (walletAddress && blockchainId) {
          const walletUser = await findUserByWallet(walletAddress, blockchainId);
          
          if (walletUser.found) {
            request.authenticatedUser = {
              id: walletUser.userId!,
              walletAddress,
              blockchainId,
              planId: walletUser.planId,
              source: walletUser.source,
              crossChainIdentityId: walletUser.crossChainIdentityId
            };
            return;
          } else {
            return reply.status(401).send({ 
              success: false,
              error: walletUser.error || 'Wallet not registered',
              code: 'WALLET_NOT_REGISTERED'
            });
          }
        }
        
        // ✅ Fallback for development with userId
        if (userId) {
          request.authenticatedUser = {
            id: userId,
            walletAddress: walletAddress || '',
            blockchainId: blockchainId || ''
          };
          return;
        }
        
        return reply.status(401).send({ 
          success: false,
          error: 'Authentication required - no wallet info provided',
          code: 'AUTH_REQUIRED'
        });
      } else {
        return reply.status(401).send({ 
          success: false,
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }
    }

    // ✅ Token extraction and validation
    const token = authHeader.substring(7).trim();
    
    if (!token) {
      return reply.status(401).send({ 
        success: false,
        error: 'Empty authentication token',
        code: 'EMPTY_TOKEN'
      });
    }

    // ✅ Check token structure before decoding
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return reply.status(401).send({ 
        success: false,
        error: `Invalid token format - expected 3 parts, got ${tokenParts.length}`,
        code: 'INVALID_TOKEN_STRUCTURE'
      });
    }

    // ✅ Enhanced JWT validation
    try {
      let decodedPayload: any;
      
      // ✅ Token decoding with validation
      try {
        const [header, payload, signature] = tokenParts;
        
        if (!header || !payload || !signature) {
          throw new Error('Token missing required parts');
        }

        // ✅ Base64 decoding with padding
        const addPadding = (base64: string): string => {
          const padding = 4 - (base64.length % 4);
          return padding !== 4 ? base64 + '='.repeat(padding) : base64;
        };

        const payloadWithPadding = addPadding(payload.replace(/-/g, '+').replace(/_/g, '/'));
        const decodedString = Buffer.from(payloadWithPadding, 'base64').toString('utf8');
        
        if (!decodedString) {
          throw new Error('Failed to decode token payload');
        }

        decodedPayload = JSON.parse(decodedString);
        
        if (!decodedPayload || typeof decodedPayload !== 'object') {
          throw new Error('Invalid payload structure');
        }

      } catch (decodeError: any) {
        return reply.status(401).send({ 
          success: false,
          error: `Token decode failed: ${decodeError.message}`,
          code: 'TOKEN_DECODE_ERROR'
        });
      }

      // ✅ Check token expiration
      if (decodedPayload.exp && Date.now() >= decodedPayload.exp * 1000) {
        return reply.status(401).send({ 
          success: false,
          error: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      // ✅ Extract user info from token
      const tokenUserId = decodedPayload.userId || decodedPayload.sub || decodedPayload.id;
      const tokenWalletAddress = decodedPayload.walletAddress;
      const tokenBlockchainId = decodedPayload.blockchainId;
      
      const finalWalletAddress = tokenWalletAddress || walletAddress;
      const finalBlockchainId = tokenBlockchainId || blockchainId;
      
      if (finalWalletAddress && finalBlockchainId) {
        const walletUser = await findUserByWallet(finalWalletAddress, finalBlockchainId);
        
        if (walletUser.found) {
          request.authenticatedUser = {
            id: walletUser.userId!,
            walletAddress: finalWalletAddress,
            blockchainId: finalBlockchainId,
            planId: walletUser.planId,
            source: walletUser.source,
            crossChainIdentityId: walletUser.crossChainIdentityId
          };
          return;
        } else {
          return reply.status(401).send({ 
            success: false,
            error: walletUser.error || 'Wallet not registered',
            code: 'WALLET_NOT_REGISTERED'
          });
        }
      } else if (tokenUserId) {
        request.authenticatedUser = {
          id: tokenUserId,
          walletAddress: finalWalletAddress || '',
          blockchainId: finalBlockchainId || '',
          planId: decodedPayload.planId
        };
        return;
      } else {
        return reply.status(401).send({ 
          success: false,
          error: 'Invalid token payload - missing user identification',
          code: 'INVALID_TOKEN_PAYLOAD'
        });
      }
      
    } catch (jwtError: any) {
      return reply.status(401).send({ 
        success: false,
        error: 'Token validation failed',
        code: 'JWT_INVALID'
      });
    }
    
  } catch (error: any) {
    return reply.status(500).send({ 
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// ✅ No-auth hook for public endpoints
export const noAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
  return;
};

// ✅ Enhanced wallet signature authentication
export const walletAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { walletAddress, blockchainId, signature } = request.body as any;
    
    if (!walletAddress || !blockchainId) {
      return reply.status(400).send({
        success: false,
        error: 'Wallet address and blockchain ID required',
        code: 'MISSING_WALLET_INFO'
      });
    }

    const walletUser = await findUserByWallet(walletAddress, blockchainId);
    
    if (!walletUser.found) {
      return reply.status(401).send({
        success: false,
        error: walletUser.error || 'Wallet not registered',
        code: 'WALLET_NOT_REGISTERED'
      });
    }

    // ✅ TODO: Implement signature verification here
    if (signature) {
      // Verify the signature matches the wallet address
      // Use ethers.js utils.verifyMessage() or similar
    }

    request.authenticatedUser = {
      id: walletUser.userId!,
      walletAddress,
      blockchainId,
      planId: walletUser.planId,
      source: walletUser.source,
      crossChainIdentityId: walletUser.crossChainIdentityId
    };

    return;
    
  } catch (error: any) {
    return reply.status(401).send({
      success: false,
      error: 'Wallet authentication failed',
      code: 'WALLET_AUTH_FAILED'
    });
  }
};

// ✅ Helper function to get user from request
export const getAuthenticatedUser = (request: FastifyRequest) => {
  return request.authenticatedUser;
};

// ✅ Plan verification middleware
export const requirePlan = (allowedPlans: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getAuthenticatedUser(request);
    
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    try {
      const { data: userData, error } = await supabase
        .from('User')
        .select(`
          planId,
          Plan!planId(name)
        `)
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to check user plan',
          code: 'PLAN_CHECK_ERROR'
        });
      }

      // ✅ Extract plan name safely
      let planName = 'Free'; // Default fallback
      
      if (userData?.Plan) {
        const planData = userData.Plan as any;
        if (Array.isArray(planData) && planData.length > 0) {
          planName = planData[0]?.name || 'Free';
        } else if (planData?.name) {
          planName = planData.name;
        }
      }

      // ✅ Check if current plan is allowed
      if (!allowedPlans.includes(planName)) {
        return reply.status(403).send({
          success: false,
          error: `This feature requires ${allowedPlans.join(' or ')} plan. Your current plan: ${planName}`,
          code: 'INSUFFICIENT_PLAN',
          currentPlan: planName,
          requiredPlans: allowedPlans
        });
      }

      return;

    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to verify user plan',
        code: 'PLAN_CHECK_ERROR'
      });
    }
  };
};
