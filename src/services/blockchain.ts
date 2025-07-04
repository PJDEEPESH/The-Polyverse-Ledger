import { PrismaClient } from '@prisma/client';
import { create } from 'ipfs-http-client';
import { ethers } from 'ethers';
import { generateUBID, generateBNSName } from '../utils/ubid.js';

const prisma = new PrismaClient();
const ipfs = create({ url: process.env.IPFS_URL || 'http://localhost:5001' });

export class BlockchainService {
  static async register(data: {
    name: string;
    networkType: string;
    chainProtocol: string;
  }) {
    const ubid = generateUBID(data.networkType, data.chainProtocol);
    const bnsName = generateBNSName(data.name);
    const apiKey = ethers.hexlify(ethers.randomBytes(32));

    // Store blockchain metadata in IPFS
    const ipfsData = {
      ...data,
      ubid,
      bnsName,
      timestamp: new Date().toISOString(),
    };
    
    const ipfsResult = await ipfs.add(JSON.stringify(ipfsData));

    const blockchain = await prisma.blockchain.create({
      data: {
        ...data,
        ubid,
        bnsName,
        apiKey,
      }
    });

    return {
      ...blockchain,
      ipfsHash: ipfsResult.path,
    };
  }

  static async verifyApiKey(apiKey: string) {
    const blockchain = await prisma.blockchain.findUnique({
      where: { apiKey }
    });

    return !!blockchain;
  }

  static async resolveUBID(ubid: string) {
    const blockchain = await prisma.blockchain.findUnique({
      where: { ubid }
    });

    if (!blockchain) {
      throw new Error('Blockchain not found');
    }

    return blockchain;
  }

  static async resolveBNS(bnsName: string) {
    const blockchain = await prisma.blockchain.findUnique({
      where: { bnsName }
    });

    if (!blockchain) {
      throw new Error('BNS name not found');
    }

    return blockchain;
  }
}