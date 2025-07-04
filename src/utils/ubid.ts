import { createHash } from 'crypto';
import { ethers } from 'ethers';

export function generateUBID(networkType: string, chainProtocol: string): string {
  // Generate a unique identifier for blockchain networks
  // Format: UBID-[NETWORK_TYPE]-[PROTOCOL]-[HASH]
  const timestamp = Date.now().toString();
const random = ethers.randomBytes(16).toString();
  
  const hash = createHash('sha256')
    .update(timestamp + random)
    .digest('hex')
    .substring(0, 12);
    
  return `UBID-${networkType.toUpperCase()}-${chainProtocol.toUpperCase()}-${hash}`;
}

export function generateBNSName(name: string): string {
  // Convert blockchain name to BNS format
  // Format: [name].bchain
  return `${name.toLowerCase()}.bchain`;
}

export function generateCrossChainAddress(blockchainId: string, userId: string): string {
  // Generate cross-chain address format
  // Format: BCHAIN://[BlockchainID]/[UserID]
  return `BCHAIN://${blockchainId}/${userId}`;
}