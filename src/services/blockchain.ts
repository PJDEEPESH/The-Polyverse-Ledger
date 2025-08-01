import { PrismaClient, Prisma } from '@prisma/client';
import { create } from 'ipfs-http-client';
import { ethers } from 'ethers';
import { generateUBID, generateBNSName } from '../utils/ubid.js';

const prisma = new PrismaClient();

// IPFS client with error handling
let ipfsClient: any = null;
try {
  ipfsClient = create({ 
    url: process.env.IPFS_URL || 'http://localhost:5001',
    timeout: 10000 // 10 second timeout
  });
} catch (error) {
  console.warn('IPFS client initialization failed:', error);
}

export interface RegisterBlockchainData {
  name: string;
  networkType: string;
  chainProtocol: string;
}

export interface BlockchainWithIPFS {
  id: string;
  name: string;
  ubid: string;
  bnsName: string | null;
  networkType: string;
  chainProtocol: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
  ipfsHash?: string;
}

export interface ApiKeyVerificationResult {
  valid: boolean;
  blockchainId?: string;
}

export class BlockchainService {
  static async register(data: RegisterBlockchainData): Promise<BlockchainWithIPFS> {
    // Input validation
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Valid blockchain name is required');
    }

    if (!data.networkType || typeof data.networkType !== 'string') {
      throw new Error('Valid network type is required');
    }

    if (!data.chainProtocol || typeof data.chainProtocol !== 'string') {
      throw new Error('Valid chain protocol is required');
    }

    try {
      const ubid = generateUBID(data.networkType, data.chainProtocol);
      const bnsName = generateBNSName(data.name);
      const apiKey = ethers.hexlify(ethers.randomBytes(32));

      // Prepare metadata for IPFS storage
      const ipfsData = {
        name: data.name,
        networkType: data.networkType,
        chainProtocol: data.chainProtocol,
        ubid,
        bnsName,
        timestamp: new Date().toISOString(),
        version: '1.0'
      };

      let ipfsHash: string | undefined;

      // Try to store in IPFS (non-blocking)
      if (ipfsClient) {
        try {
          const ipfsResult = await ipfsClient.add(JSON.stringify(ipfsData));
          ipfsHash = ipfsResult.path;
          console.log('Blockchain metadata stored in IPFS:', ipfsHash);
        } catch (ipfsError) {
          console.warn('IPFS storage failed (continuing without IPFS):', ipfsError);
          // Don't throw - IPFS failure shouldn't block blockchain registration
        }
      } else {
        console.warn('IPFS client not available, skipping IPFS storage');
      }

      // Create blockchain record in database
      const blockchain = await prisma.blockchain.create({
        data: {
          name: data.name,
          ubid,
          bnsName,
          apiKey,
          networkType: data.networkType,
          chainProtocol: data.chainProtocol,
        },
      });

      console.log('Blockchain registered successfully:', {
        id: blockchain.id,
        name: blockchain.name,
        ubid: blockchain.ubid,
        bnsName: blockchain.bnsName
      });

      return {
        ...blockchain,
        ...(ipfsHash && { ipfsHash })
      };

    } catch (error: any) {
      console.error('Blockchain registration error:', error);

      // Handle Prisma errors - FIXED: Proper type handling for meta.target
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          // Type assertion for meta.target
          const meta = error.meta as { target?: string[] } | undefined;
          const field = meta?.target?.[0] || 'field';
          throw new Error(`${field} already exists`);
        }
      }

      // Re-throw validation errors
      if (error.message.includes('required') || 
          error.message.includes('already exists')) {
        throw error;
      }

      // Generic error for unexpected issues
      throw new Error('Failed to register blockchain');
    }
  }

  static async verifyApiKey(apiKey: string): Promise<ApiKeyVerificationResult> {
    try {
      if (!apiKey || typeof apiKey !== 'string') {
        return { valid: false };
      }

      const blockchain = await prisma.blockchain.findUnique({
        where: { apiKey },
        select: {
          id: true
        }
      });

      if (blockchain) {
        return {
          valid: true,
          blockchainId: blockchain.id
        };
      }

      return { valid: false };

    } catch (error: any) {
      console.error('API key verification error:', error);
      return { valid: false };
    }
  }

  static async resolveUBID(ubid: string) {
    try {
      if (!ubid || typeof ubid !== 'string') {
        throw new Error('Valid UBID is required');
      }

      const blockchain = await prisma.blockchain.findUnique({
        where: { ubid },
        select: {
          id: true,
          name: true,
          ubid: true,
          bnsName: true,
          networkType: true,
          chainProtocol: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!blockchain) {
        throw new Error('Blockchain not found');
      }

      return blockchain;

    } catch (error: any) {
      console.error('UBID resolution error:', error);
      
      if (error.message === 'Blockchain not found' ||
          error.message === 'Valid UBID is required') {
        throw error;
      }
      
      throw new Error('Failed to resolve UBID');
    }
  }

  static async resolveBNS(bnsName: string) {
    try {
      if (!bnsName || typeof bnsName !== 'string') {
        throw new Error('Valid BNS name is required');
      }

      const blockchain = await prisma.blockchain.findUnique({
        where: { bnsName },
        select: {
          id: true,
          name: true,
          ubid: true,
          bnsName: true,
          networkType: true,
          chainProtocol: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!blockchain) {
        throw new Error('BNS name not found');
      }

      return blockchain;

    } catch (error: any) {
      console.error('BNS resolution error:', error);
      
      if (error.message === 'BNS name not found' ||
          error.message === 'Valid BNS name is required') {
        throw error;
      }
      
      throw new Error('Failed to resolve BNS name');
    }
  }

  static async getAllBlockchains() {
    try {
      const blockchains = await prisma.blockchain.findMany({
        select: {
          id: true,
          name: true,
          ubid: true,
          bnsName: true,
          networkType: true,
          chainProtocol: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return blockchains;

    } catch (error: any) {
      console.error('Failed to fetch blockchains:', error);
      throw new Error('Failed to fetch blockchains');
    }
  }

  static async getBlockchainById(id: string) {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Valid blockchain ID is required');
      }

      const blockchain = await prisma.blockchain.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          ubid: true,
          bnsName: true,
          networkType: true,
          chainProtocol: true,
          createdAt: true,
          updatedAt: true
        }
      });

      if (!blockchain) {
        throw new Error('Blockchain not found');
      }

      return blockchain;

    } catch (error: any) {
      console.error('Failed to fetch blockchain by ID:', error);
      
      if (error.message === 'Blockchain not found' ||
          error.message === 'Valid blockchain ID is required') {
        throw error;
      }
      
      throw new Error('Failed to fetch blockchain');
    }
  }

  // Cleanup method for graceful shutdown
  static async cleanup() {
    try {
      await prisma.$disconnect();
      console.log('Prisma client disconnected');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Received SIGINT, cleaning up...');
  await BlockchainService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up...');
  await BlockchainService.cleanup();
  process.exit(0);
});
