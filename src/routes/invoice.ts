// src/routes/invoice.ts - PRODUCTION VERSION: All TypeScript errors fixed
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InvoiceService, InvoiceWithUser } from '../services/invoice.js';
import { PrismaClient } from '@prisma/client';
import { CreditScoreService } from '../services/creditScore.js';
import { queryLimitHook } from '../middleware/queryLimit.js';
import { walletValidationHook } from '../middleware/validateWallet.js';
import { transactionLimitHook } from '../middleware/transactionLimit.js';
import { authenticationHook } from '../middleware/authentication.js';
import { sanitizeObject } from '../utils/sanitization.js';
import { generateUUID } from '../utils/ubid.js';
import { ethers } from "ethers";
import { getInvoiceManagerContract } from '../utils/getInvoiceManagerContract.js';
import { supabase } from '../lib/supabaseClient.js';

const prisma = new PrismaClient();

// ✅ Price fetching utility
async function getETHUSDPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    const data = await response.json();
    return data.ethereum?.usd || 3000;
  } catch (error) {
    return 3000; // Fallback price
  }
}

// ✅ Enhanced function with proper typing
async function findExistingWalletUser(walletAddress: string, blockchainId: string): Promise<{
  found: boolean;
  userId?: string;
  planId?: string;
  source?: 'primary' | 'crosschain';
  crossChainIdentityId?: string | null;
  error?: string;
}> {
  // Check primary wallet (User table)
  const { data: primaryUser } = await supabase
    .from('User')
    .select('id, planId')
    .eq('walletAddress', walletAddress)
    .eq('blockchainId', blockchainId)
    .maybeSingle();

  if (primaryUser) {
    return {
      found: true,
      userId: primaryUser.id,
      planId: primaryUser.planId,
      source: 'primary',
      crossChainIdentityId: null
    };
  }

  // Check CrossChainIdentity table
  const { data: crossChainUser } = await supabase
    .from('CrossChainIdentity')
    .select(`
      id,
      userId,
      User!userId(id, planId)
    `)
    .eq('walletAddress', walletAddress)
    .eq('blockchainId', blockchainId)
    .maybeSingle();

  if (crossChainUser && crossChainUser.User) {
    const userData = Array.isArray(crossChainUser.User) 
      ? crossChainUser.User[0] 
      : crossChainUser.User;

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
    error: 'Wallet not registered. Please add this wallet through the user management system first.'
  };
}

// ✅ Convert USD to ETH
function convertUSDToETH(usdAmount: number, ethPrice: number): number {
  if (ethPrice <= 0) {
    throw new Error('Invalid ETH price');
  }
  return usdAmount / ethPrice;
}

// ✅ Convert ETH to Wei
function ethToWei(ethAmount: number): string {
  if (ethAmount < 0) {
    throw new Error('ETH amount cannot be negative');
  }
  const weiAmount = ethAmount * Math.pow(10, 18);
  return Math.floor(weiAmount).toString();
}

async function createBlockchainInvoice(
  recipientAddress: string,
  weiAmount: string,
  dueDate: Date,
): Promise<{ txHash: string | null; status: string; blockchainInvoiceId: string | null; error: string | null }> {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ETHEREUM_RPC_URL);
    const privateKey = process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
    
    if (!privateKey) {
      throw new Error('Private key not configured');
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const invoiceContract = getInvoiceManagerContract(wallet);
    
    const dueDateTimestamp = Math.floor(dueDate.getTime() / 1000);
    
    const estimatedGas = await invoiceContract.createInvoice.estimateGas(
      recipientAddress,
      weiAmount,
      dueDateTimestamp,
      "Invoice"
    );
    
    const tx = await invoiceContract.createInvoice(
      recipientAddress,
      weiAmount,
      dueDateTimestamp,
      "Invoice",
      {
        gasLimit: Math.floor(Number(estimatedGas) * 1.2),
        gasPrice: ethers.parseUnits("20", "gwei")
      }
    );
    
    const receipt = await tx.wait(1);
    
    if (receipt.status === 1) {
      let blockchainInvoiceId: string | null = null;
      if (receipt.logs && receipt.logs.length > 0) {
        try {
          const parsedLogs = receipt.logs.map((log: { topics: ReadonlyArray<string>; data: string; }) => {
            try {
              return invoiceContract.interface.parseLog(log);
            } catch {
              return null;
            }
          }).filter(Boolean);
          
          const invoiceCreatedEvent = parsedLogs.find((log: { name: string; args?: any }) => 
            log?.name === 'InvoiceCreated' || log?.name === 'InvoiceGenerated'
          );
          
          if (invoiceCreatedEvent && invoiceCreatedEvent.args) {
            blockchainInvoiceId = invoiceCreatedEvent.args.invoiceId?.toString() || 
                                 invoiceCreatedEvent.args.id?.toString() || null;
          }
        } catch (eventError) {
          // Event parsing failed
        }
      }
      
      return {
        txHash: tx.hash,
        status: 'confirmed',
        blockchainInvoiceId,
        error: null
      };
    } else {
      return {
        txHash: tx.hash,
        status: 'failed',
        blockchainInvoiceId: null,
        error: 'Transaction failed on blockchain'
      };
    }
    
  } catch (error) {
    return {
      txHash: null,
      status: 'failed',
      blockchainInvoiceId: null,
      error: error instanceof Error ? error.message : 'Unknown blockchain error'
    };
  }
}

// ✅ Validation schemas
const createInvoiceSchema = z.object({
  blockchainId: z.string()
    .min(1, 'Blockchain ID is required')
    .max(100, 'Blockchain ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid blockchain ID format'),
  walletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  amount: z.number()
    .positive('Amount must be positive')
    .max(1000000, 'Amount exceeds maximum limit')
    .refine(val => Number.isFinite(val), 'Amount must be a valid number'),
  dueDate: z.string().refine((date) => {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return false;
    const now = new Date();
    const minDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    return parsed >= minDate && parsed <= maxDate;
  }, 'Due date must be between 24 hours and 1 year from now'),
  tokenized: z.boolean().optional().default(false),
  tokenAddress: z.string()
    .optional()
    .nullable()
    .transform(val => val === '' ? null : val)
    .refine(val => !val || /^0x[a-fA-F0-9]{40}$/.test(val), 'Invalid token address format'),
  escrowAddress: z.string()
    .optional()
    .nullable()
    .transform(val => val === '' ? null : val)
    .refine(val => !val || /^0x[a-fA-F0-9]{40}$/.test(val), 'Invalid escrow address format'),
  subscriptionId: z.string().optional().nullable(),
  userWalletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user wallet address format'),
});

const invoiceIdSchema = z.object({
  id: z.string()
    .min(10, 'Invalid invoice ID format')
    .max(50, 'Invoice ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid invoice ID characters'),
});

const userIdSchema = z.object({
  userId: z.string()
    .min(1, 'User ID is required')
    .max(50, 'User ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid user ID format'),
});

const walletParamsSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  blockchainId: z.string()
    .min(1, 'Blockchain ID is required')
    .max(100, 'Blockchain ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid blockchain ID format'),
});

const paginationSchema = z.object({
  page: z.string()
    .optional()
    .default('1')
    .transform(val => {
      const num = parseInt(val);
      return isNaN(num) || num < 1 ? 1 : Math.min(num, 1000);
    }),
  limit: z.string()
    .optional()
    .default('20')
    .transform(val => {
      const num = parseInt(val);
      return isNaN(num) || num < 1 ? 20 : Math.min(num, 100);
    }),
  status: z.enum(['UNPAID', 'PAID', 'CANCELED']).optional(),
  userId: z.string().optional(),
});

const markPaidSchema = z.object({
  userWalletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user wallet address format'),
  hash: z.string().optional(),
});

const updateInvoiceSchema = z.object({
  amount: z.number()
    .positive('Amount must be positive')
    .max(1000000, 'Amount exceeds maximum limit')
    .optional(),
  dueDate: z.string().refine((date) => {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return false;
    const now = new Date();
    const minDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    return parsed >= minDate && parsed <= maxDate;
  }, 'Due date must be between 24 hours and 1 year from now').optional(),
  tokenAddress: z.string()
    .nullable()
    .optional()
    .refine(val => !val || /^0x[a-fA-F0-9]{40}$/.test(val), 'Invalid token address format'),
  escrowAddress: z.string()
    .nullable()
    .optional()
    .refine(val => !val || /^0x[a-fA-F0-9]{40}$/.test(val), 'Invalid escrow address format'),
  userWalletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user wallet address format'),
});

// Utility functions
const validateOwnership = async (invoiceId: string, userWalletAddress: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      user: {
        select: {
          walletAddress: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.user.walletAddress !== userWalletAddress) {
    throw new Error('Unauthorized: You can only access your own invoices');
  }

  return invoice;
};

const handleDatabaseError = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const prismaError = error as { code: string };
    
    if (prismaError.code === 'P2002') {
      return { status: 409, message: 'Duplicate entry detected' };
    }
    if (prismaError.code === 'P2025') {
      return { status: 404, message: 'Record not found' };
    }
    if (prismaError.code === 'P2003') {
      return { status: 400, message: 'Foreign key constraint failed' };
    }
  }
  
  return { status: 500, message: 'Database operation failed' };
};

export async function invoiceRoutes(fastify: FastifyInstance) {
  
  // Global error handler
  fastify.setErrorHandler(async (error, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.validation,
      });
    }

    const status = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    
    return reply.status(status).send({
      error: message,
      timestamp: new Date().toISOString(),
    });
  });

  // ✅ POST /api/v1/invoices
  fastify.post('/', {
    preHandler: [queryLimitHook, transactionLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedBody = sanitizeObject(request.body);
      const parsed = createInvoiceSchema.parse(sanitizedBody);

      const walletUser = await findExistingWalletUser(parsed.userWalletAddress, parsed.blockchainId);

      if (!walletUser.found) {
        return reply.status(400).send({
          success: false,
          error: walletUser.error || 'Wallet not registered',
          code: 'WALLET_NOT_REGISTERED',
          message: 'Please add this wallet through your user management system first (via /register or /add-wallet).'
        });
      }

      const userId = walletUser.userId!;
      const walletSource = walletUser.source!;
      const crossChainIdentityId = walletUser.crossChainIdentityId;

      const { data: userWithPlan } = await supabase
        .from('User')
        .select(`
          id,
          invoiceCount,
          Plan!planId(name, txnLimit)
        `)
        .eq('id', userId)
        .maybeSingle();

      if (!userWithPlan) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      const planData = userWithPlan.Plan?.[0];
      if (planData?.txnLimit && userWithPlan.invoiceCount >= planData.txnLimit) {
        return reply.status(403).send({
          success: false,
          error: `Transaction limit exceeded. Your ${planData.name} plan allows ${planData.txnLimit} invoices.`,
          code: 'PLAN_TXN_LIMIT_EXCEEDED'
        });
      }

      const ethPrice = await getETHUSDPrice();
      const ethAmount = convertUSDToETH(parsed.amount, ethPrice);
      const weiAmount = ethToWei(ethAmount);

      let blockchainResult = {
        txHash: null as string | null,
        status: 'pending' as string,
        blockchainInvoiceId: null as string | null,
        error: null as string | null
      };

      try {
        blockchainResult = await createBlockchainInvoice(
          parsed.walletAddress,
          weiAmount,
          new Date(parsed.dueDate)
        );
      } catch (blockchainError) {
        blockchainResult.status = 'failed';
        blockchainResult.error = blockchainError instanceof Error ? blockchainError.message : 'Unknown blockchain error';
        
        if (process.env.REQUIRE_BLOCKCHAIN === 'true') {
          return reply.status(500).send({
            error: 'Failed to create blockchain transaction',
            details: blockchainResult.error,
            conversion: {
              usdAmount: parsed.amount,
              ethAmount: ethAmount,
              weiAmount: weiAmount,
              ethPrice: ethPrice,
            }
          });
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        const newInvoice = await InvoiceService.create({
          userId: userId,
          crossChainIdentityId: crossChainIdentityId,
          blockchainId: parsed.blockchainId,
          walletAddress: parsed.walletAddress,
          amount: parsed.amount,
          ethAmount: ethAmount,
          weiAmount: weiAmount,
          ethPrice: ethPrice,
          dueDate: new Date(parsed.dueDate),
          tokenized: parsed.tokenized,
          tokenAddress: parsed.tokenAddress,
          escrowAddress: parsed.escrowAddress,
          subscriptionId: parsed.subscriptionId,
        });

        if (walletSource === 'primary') {
          await tx.user.update({
            where: { id: userId },
            data: { invoiceCount: { increment: 1 } }
          });
        } else if (crossChainIdentityId) {
          await supabase
            .from('CrossChainIdentity')
            .update({ invoiceCount: { increment: 1 } })
            .eq('id', crossChainIdentityId);
        }

        const transactionId = generateUUID();
        try {
          await tx.transaction.create({
            data: {
              id: transactionId,
              userId: userId,
              invoiceId: newInvoice.id,
              amount: parsed.amount,
              type: 'invoice_created',
              status: 'PENDING',
              hash: blockchainResult.txHash,
              riskScore: 0,
            },
          });
        } catch (transactionError) {
          // Transaction record creation failed, continue
        }

        return newInvoice;
      });

      try {
        if (walletSource === 'primary') {
          await CreditScoreService.calculateScore(userId);
        } else if (crossChainIdentityId) {
          await CreditScoreService.calculateScore(userId);
        }
      } catch (scoreError) {
        // Credit score update failed, continue
      }

      return reply.status(201).send({ 
        message: `Invoice created successfully using ${walletSource} wallet`, 
        data: {
          invoice: result,
          blockchain: {
            txHash: blockchainResult.txHash,
            status: blockchainResult.status,
            blockchainInvoiceId: blockchainResult.blockchainInvoiceId,
            explorerUrl: blockchainResult.txHash ? 
              `https://etherscan.io/tx/${blockchainResult.txHash}` : null,
            error: blockchainResult.error
          },
          conversion: {
            usdAmount: parsed.amount,
            ethAmount: ethAmount,
            weiAmount: weiAmount,
            ethPrice: ethPrice,
            displayText: `This will be ~${ethAmount.toFixed(6)} ETH`
          },
          source: walletSource,
          crossChainIdentityId: crossChainIdentityId,
          existingRegistration: true
        }
      });

    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation failed', 
          details: err.errors 
        });
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  // ✅ markPaid route
  fastify.post('/:id/markPaid', {
    preHandler: [ transactionLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const sanitizedBody = sanitizeObject(request.body);
      const { id } = invoiceIdSchema.parse(sanitizedParams);
      const { userWalletAddress, hash } = markPaidSchema.parse(sanitizedBody);

      const existingInvoice = await prisma.invoice.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              walletAddress: true,
            },
          },
        },
      });

      if (!existingInvoice) {
        return reply.status(404).send({ error: 'Invoice not found' });
      }

      if (existingInvoice.status === 'PAID') {
        return reply.status(400).send({ 
          error: 'Invoice is already marked as paid' 
        });
      }

      const isCreator = existingInvoice.user.walletAddress === userWalletAddress;
      const isRecipient = existingInvoice.walletAddress === userWalletAddress;

      if (!isCreator && !isRecipient) {
        return reply.status(403).send({ 
          error: 'Unauthorized: You can only mark invoices as paid if you are the creator or recipient' 
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const updatedInvoice = await InvoiceService.updateStatus(id, 'PAID', hash);

        try {
          await tx.transaction.updateMany({
            where: { invoiceId: id },
            data: {
              status: 'SUCCESS',
              hash: hash || undefined,
              updatedAt: new Date(),
            },
          });
        } catch (transactionUpdateError) {
          // Transaction update failed, continue
        }

        return { updatedInvoice };
      });

      let updatedScore = null;
      try {
        updatedScore = await CreditScoreService.calculateScore(existingInvoice.userId);
      } catch (scoreError) {
        // Credit score update failed, continue
      }

      return reply.send({
        message: 'Invoice marked as paid successfully',
        data: {
          invoice: result.updatedInvoice,
          creditScore: updatedScore,
          markedBy: isCreator ? 'creator' : 'recipient'
        },
      });

    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation failed', 
          details: error.errors 
        });
      }

      const dbError = handleDatabaseError(error);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ✅ GET /api/v1/invoices/user/:userId
  fastify.get('/user/:userId', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const { userId } = userIdSchema.parse(request.params);
      const sanitizedUserId = sanitizeObject(userId) as string;
      
      const user = await prisma.user.findUnique({
        where: { id: sanitizedUserId },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const invoices = await InvoiceService.getByUserId(sanitizedUserId);
      
      return reply.send({ 
        message: 'Invoices retrieved successfully',
        data: invoices,
        count: invoices.length 
      });

    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Invalid user ID format', 
          details: err.errors 
        });
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  // ✅ GET /api/v1/invoices/wallet/:walletAddress/:blockchainId
  fastify.get('/wallet/:walletAddress/:blockchainId', {
    preHandler: [authenticationHook, walletValidationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const { walletAddress, blockchainId } = walletParamsSchema.parse(sanitizedParams);

      const invoices = await InvoiceService.getByWalletAddress(walletAddress, blockchainId);

      const invoicesWithConversion = invoices.map(invoice => ({
        ...invoice,
        conversion: {
          usdAmount: invoice.amount,
          ethAmount: invoice.ethAmount,
          weiAmount: invoice.weiAmount,
          ethPrice: invoice.ethPrice,
          displayText: invoice.ethAmount ? `This is ~${invoice.ethAmount.toFixed(6)} ETH` : null,
        }
      }));
      
      return reply.send({
        message: 'Wallet-specific invoices retrieved successfully',
        data: invoicesWithConversion,
        count: invoicesWithConversion.length,
        walletAddress,
        blockchainId,
        debug: {
          searchedWallet: walletAddress,
          searchedChain: blockchainId,
          foundCount: invoicesWithConversion.length
        }
      });

    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Invalid wallet address or blockchain ID format', 
          details: err.errors 
        });
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  // ✅ GET /api/v1/invoices/:id
  fastify.get('/:id', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const sanitizedQuery = sanitizeObject(request.query);
      const { id } = invoiceIdSchema.parse(sanitizedParams);
      
      const invoice = await InvoiceService.getWithConversionDetails(id);

      if (!invoice) {
        return reply.status(404).send({ error: 'Invoice not found' });
      }

      if (sanitizedQuery?.userWalletAddress) {
        const userWalletAddress = z.string()
          .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user wallet address format')
          .parse(sanitizedQuery.userWalletAddress);
        
        await validateOwnership(id, userWalletAddress);
      }

      return reply.send({
        message: 'Invoice retrieved successfully',
        data: invoice
      });

    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Invalid input format', 
          details: err.errors 
        });
      }

      if (err instanceof Error) {
        if (err.message === 'Invoice not found') {
          return reply.status(404).send({ error: err.message });
        }

        if (err.message.includes('Unauthorized')) {
          return reply.status(403).send({ error: err.message });
        }
      }

      const dbError = handleDatabaseError(err);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  // ✅ PUT /api/v1/invoices/:id
  fastify.put('/:id', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const sanitizedBody = sanitizeObject(request.body);
      const { id } = invoiceIdSchema.parse(sanitizedParams);
      const parsed = updateInvoiceSchema.parse(sanitizedBody);

      const existingInvoice = await validateOwnership(id, parsed.userWalletAddress);

      if (existingInvoice.status === 'PAID') {
        return reply.status(400).send({ 
          error: 'Cannot update a paid invoice' 
        });
      }

      let updateData: any = {
        updatedAt: new Date(),
      };

      if (parsed.amount !== undefined) {
        const ethPrice = await getETHUSDPrice();
        const ethAmount = convertUSDToETH(parsed.amount, ethPrice);
        const weiAmount = ethToWei(ethAmount);

        updateData = {
          ...updateData,
          amount: parsed.amount,
          ethAmount: ethAmount,
          weiAmount: weiAmount,
          ethPrice: ethPrice,
        };
      }

      if (parsed.dueDate) {
        updateData.dueDate = new Date(parsed.dueDate);
      }

      if (parsed.tokenAddress !== undefined) {
        updateData.tokenAddress = parsed.tokenAddress;
      }

      if (parsed.escrowAddress !== undefined) {
        updateData.escrowAddress = parsed.escrowAddress;
      }

      const updatedInvoice = await prisma.invoice.update({
        where: { id },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              walletAddress: true,
              blockchainId: true,
            },
          },
          transactions: {
            select: {
              id: true,
              amount: true,
              type: true,
              status: true,
              hash: true,
              createdAt: true,
            },
          },
        },
      });

      return reply.send({
        message: 'Invoice updated successfully',
        data: {
          invoice: updatedInvoice,
          conversion: {
            usdAmount: updatedInvoice.amount,
            ethAmount: updatedInvoice.ethAmount,
            weiAmount: updatedInvoice.weiAmount,
            ethPrice: updatedInvoice.ethPrice,
            displayText: updatedInvoice.ethAmount ? `This is ~${updatedInvoice.ethAmount.toFixed(6)} ETH` : null,
          }
        }
      });

    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Validation failed', 
          details: error.errors 
        });
      }

      if (error instanceof Error) {
        if (error.message === 'Invoice not found') {
          return reply.status(404).send({ error: error.message });
        }

        if (error.message.includes('Unauthorized')) {
          return reply.status(403).send({ error: error.message });
        }
      }

      const dbError = handleDatabaseError(error);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ✅ DELETE /api/v1/invoices/:id
  fastify.delete('/:id', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedParams = sanitizeObject(request.params);
      const sanitizedQuery = sanitizeObject(request.query);
      const { id } = invoiceIdSchema.parse(sanitizedParams);
      const userWalletAddress = z.string()
        .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user wallet address format')
        .parse(sanitizedQuery.userWalletAddress);

      const existingInvoice = await validateOwnership(id, userWalletAddress);

      if (existingInvoice.status === 'PAID') {
        return reply.status(400).send({ 
          error: 'Cannot delete a paid invoice' 
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.transaction.deleteMany({
          where: { invoiceId: id },
        });

        await tx.invoice.delete({
          where: { id },
        });

        try {
          await tx.user.update({
            where: { id: existingInvoice.userId },
            data: {
              invoiceCount: {
                decrement: 1,
              },
            },
          });
        } catch (updateError) {
          // Invoice count update failed, continue
        }
      });

      return reply.status(204).send();

    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Invalid input format', 
          details: error.errors 
        });
      }

      if (error instanceof Error) {
        if (error.message === 'Invoice not found') {
          return reply.status(404).send({ error: error.message });
        }

        if (error.message.includes('Unauthorized')) {
          return reply.status(403).send({ error: error.message });
        }
      }

      const dbError = handleDatabaseError(error);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ✅ GET /api/v1/invoices
  fastify.get('/', {
    preHandler: [authenticationHook, queryLimitHook],
  }, async (request, reply) => {
    try {
      const sanitizedQuery = sanitizeObject(request.query);
      const { page, limit, status, userId, userWalletAddress, blockchainId } = paginationSchema
        .extend({
          userWalletAddress: z.string()
            .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid user wallet address format')
            .optional(),
          blockchainId: z.string().optional().default('ethereum'),
        })
        .parse(sanitizedQuery);

      let invoices: InvoiceWithUser[];
      let totalCount: number;

      if (userWalletAddress) {
        let allWalletInvoices = await InvoiceService.getByWalletAddress(userWalletAddress, blockchainId);
        
        if (status) {
          allWalletInvoices = allWalletInvoices.filter(invoice => invoice.status === status);
        }
        if (userId) {
          allWalletInvoices = allWalletInvoices.filter(invoice => invoice.userId === userId);
        }

        totalCount = allWalletInvoices.length;
        
        const skip = (page - 1) * limit;
        invoices = allWalletInvoices.slice(skip, skip + limit);
        
      } else {
        const skip = (page - 1) * limit;
        const where: any = {};

        if (status) where.status = status;
        if (userId) where.userId = userId;

        [invoices, totalCount] = await Promise.all([
          prisma.invoice.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  walletAddress: true,
                  blockchainId: true,
                },
              },
              transactions: {
                select: {
                  id: true,
                  amount: true,
                  type: true,
                  status: true,
                  hash: true,
                  createdAt: true,
                },
              },
              crossChainIdentity: {
                select: {
                  id: true,
                  walletAddress: true,
                  blockchainId: true,
                }
              }
            },
          }),
          prisma.invoice.count({ where }),
        ]);
      }

      const totalPages = Math.ceil(totalCount / limit);

      const invoicesWithConversion = invoices.map(invoice => ({
        ...invoice,
        conversion: {
          usdAmount: invoice.amount,
          ethAmount: invoice.ethAmount,
          weiAmount: invoice.weiAmount,
          ethPrice: invoice.ethPrice,
          displayText: invoice.ethAmount ? `This is ~${invoice.ethAmount.toFixed(6)} ETH` : null,
        }
      }));

      return reply.send({
        message: userWalletAddress ? 
          'Wallet-specific invoices retrieved successfully' : 
          'Invoices retrieved successfully',
        data: {
          invoices: invoicesWithConversion,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            limit,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
          },
        },
        debug: userWalletAddress ? {
          searchedWallet: userWalletAddress,
          searchedChain: blockchainId,
          foundCount: invoicesWithConversion.length
        } : undefined
      });

    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ 
          error: 'Invalid query parameters', 
          details: error.errors 
        });
      }

      const dbError = handleDatabaseError(error);
      return reply.status(dbError.status).send({ 
        error: dbError.message,
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
