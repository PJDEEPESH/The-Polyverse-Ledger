import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') {
    return '';
  }
  return purify.sanitize(input.trim());
};

// ✅ FIXED: Add field whitelisting to prevent filtering out required fields
export const sanitizeObject = (obj: any): any => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // ✅ Define allowed fields (add all fields your API expects)
  const allowedFields = [
    // Invoice creation fields
    'blockchainId',
    'walletAddress',
    'userWalletAddress',
    'amount',
    'dueDate',
    'tokenized',
    'tokenAddress',
    'escrowAddress',
    'subscriptionId',
    
    // Query parameters
    'page',
    'limit',
    'status',
    'userId',
    'hash',
    
    // Nested object keys that should be preserved
    'params',
    'query',
    'body',
    
    // Add any other fields your API uses
    'id',
    'type',
    'name',
    'planId',
    'planName',
    'source'
  ];

  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // ✅ Only include whitelisted fields
    if (allowedFields.includes(key)) {
      if (typeof value === 'string') {
        // Sanitize string values
        sanitized[key] = sanitizeInput(value);
      } else if (value && typeof value === 'object') {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeObject(value);
      } else if (value !== undefined && value !== null) {
        // Keep other primitive types (numbers, booleans) as-is
        sanitized[key] = value;
      }
    }
  }
  
  return sanitized;
};

// ✅ NEW: Alternative function for when you want to sanitize values without field filtering
export const sanitizeObjectValues = (obj: any): any => {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }
  
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObjectValues(value);
    }
    return sanitized;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObjectValues(item));
  }
  
  return obj;
};

// ✅ NEW: Specific sanitizer for query parameters
export const sanitizeQueryParams = (params: Record<string, any>): Record<string, any> => {
  const allowedQueryFields = [
    'userWalletAddress',
    'walletAddress',
    'blockchainId',
    'page',
    'limit',
    'status',
    'userId'
  ];

  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(params || {})) {
    if (allowedQueryFields.includes(key) && value !== undefined && value !== null && value !== '') {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeInput(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  
  return sanitized;
};
