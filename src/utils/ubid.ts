//src/utils/ubid.ts
import { createHash, randomBytes } from 'crypto';

// Sanitize input for UBID and BNS to prevent invalid characters
function sanitizeInput(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
}

// ✅ UBID Format: UBID-NETWORKTYPE-CHAINPROTOCOL-<12-char-hash>
export function generateUBID(networkType: string, chainProtocol: string): string {
  const sanitizedNetwork = sanitizeInput(networkType).toUpperCase();
  const sanitizedProtocol = sanitizeInput(chainProtocol).toUpperCase();
  const random = randomBytes(16).toString('hex').substring(0, 12);
  return `UBID-${sanitizedNetwork}-${sanitizedProtocol}-${random}`;
}

// ✅ UUID Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (RFC 4122 v4)
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ✅ BNS Name Format: sanitizedName.bchain
export function generateBNSName(name: string): string {
  const sanitized = sanitizeInput(name);
  return `${sanitized}.bchain`;
}

// ✅ Cross-Chain Address Format: BCHAIN://blockchainId/userId
export function generateCrossChainAddress(blockchainId: string, userId: string): string {
  const encodedBlockchainId = encodeURIComponent(blockchainId);
  const encodedUserId = encodeURIComponent(userId);
  return `BCHAIN://${encodedBlockchainId}/${encodedUserId}`;
}

// ✅ API Key: 48-character hex string (secure random)
export function generateAPIKey(): string {
  return randomBytes(24).toString('hex');
}
