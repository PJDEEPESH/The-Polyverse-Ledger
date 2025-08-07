// src/services/invoice.ts - PRODUCTION VERSION: Fixed all TypeScript errors
import { PrismaClient } from '@prisma/client';
import { create } from 'ipfs-http-client';

const prisma = new PrismaClient();
const ipfs = create({ url: process.env.IPFS_URL || 'http://localhost:5001' });

// ✅ Updated type to match actual schema
export type InvoiceWithUser = {
  id: string;
  userId: string;
  blockchainId: string;
  walletAddress: string;
  crossChainIdentityId?: string | null;
  amount: number;
  ethAmount: number | null;
  weiAmount: string | null;
  ethPrice: number | null;
  paymentHash: string | null;
  paidAt: Date | null;
  description: string | null;
  currency: string;
  dueDate: Date;
  status: string;
  ipfsHash: string | null;
  tokenized: boolean;
  tokenAddress: string | null;
  escrowAddress: string | null;
  subscriptionId: string | null;
  fee: number | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    walletAddress: string;
    blockchainId: string;
  };
  transactions?: {
    id: string;
    amount: number;
    type: string;
    status: string;
    hash: string | null;
    createdAt: Date;
  }[];
};

export class InvoiceService {
  static async create(data: {
    userId: string;
    blockchainId: string;
    walletAddress: string;
    crossChainIdentityId?: string | null; 
    amount: number;
    ethAmount: number;
    weiAmount: string;
    ethPrice: number;
    description?: string;
    dueDate: Date;
    tokenized?: boolean;
    tokenAddress?: string | null;
    escrowAddress?: string | null;
    subscriptionId?: string | null;
    blockchainTxHash?: string | null;
    blockchainInvoiceId?: string | null;
    blockchainStatus?: string;
  }): Promise<InvoiceWithUser> {
    try {
      // Prepare data for IPFS with additional metadata
      const ipfsData = { 
        ...data, 
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'invoice',
      };

      let ipfsHash: string | null = null;
      try {
        const ipfsResult = await ipfs.add(JSON.stringify(ipfsData));
        ipfsHash = ipfsResult.path;
      } catch (ipfsError: unknown) {
        // IPFS upload failed, continue without IPFS hash
      }
      
      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries) {
        try {
          // Create invoice data
          const invoiceData: any = {
            userId: data.userId,
            blockchainId: data.blockchainId,
            walletAddress: data.walletAddress,
            amount: data.amount,
            ethAmount: data.ethAmount,
            weiAmount: data.weiAmount,
            ethPrice: data.ethPrice,
            description: data.description || '',
            dueDate: data.dueDate,
            currency: 'USD',
            ipfsHash,
            tokenized: data.tokenized ?? false,
            tokenAddress: data.tokenAddress ?? null,
            escrowAddress: data.escrowAddress ?? null,
            subscriptionId: data.subscriptionId ?? null,
            paymentHash: data.blockchainTxHash,
            status: 'UNPAID',
          };

          if (data.crossChainIdentityId) {
            invoiceData.crossChainIdentityId = data.crossChainIdentityId;
          }

          const invoice = await prisma.invoice.create({
            data: invoiceData,
            include: {
              user: {
                select: {
                  id: true,
                  walletAddress: true,
                  blockchainId: true,
                },
              },
              crossChainIdentity: {
                select: {
                  id: true,
                  walletAddress: true,
                  blockchainId: true,
                },
              },
            },
          });

          return invoice as InvoiceWithUser;

        } catch (dbError: unknown) {
          attempt++;
          if (attempt >= maxRetries) {
            throw dbError;
          }
          
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }

      throw new Error('Failed to create invoice after maximum retries');

    } catch (error: unknown) {
      throw error;
    }
  }

  static async getById(id: string): Promise<InvoiceWithUser | null> {
    try {
      const invoice = await prisma.invoice.findUnique({ 
        where: { id },
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

      return invoice as InvoiceWithUser | null;
    } catch (error: unknown) {
      throw error;
    }
  }

  static async getByUserId(userId: string): Promise<InvoiceWithUser[]> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { userId },
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
        },
      });

      return invoices as InvoiceWithUser[];
    } catch (error: unknown) {
      throw error;
    }
  }

  static async getByWalletAddress(walletAddress: string, blockchainId: string): Promise<InvoiceWithUser[]> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: {
          OR: [
            // Invoices created by this wallet (user's primary wallet)
            {
              user: {
                walletAddress: walletAddress,
                blockchainId: blockchainId
              }
            },
            // Invoices sent TO this wallet (recipient)
            {
              walletAddress: walletAddress,
              blockchainId: blockchainId
            },
            // Invoices from cross-chain identity
            {
              crossChainIdentity: {
                walletAddress: walletAddress,
                blockchainId: blockchainId
              }
            }
          ]
        },
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
        orderBy: { createdAt: 'desc' }
      });

      return invoices as InvoiceWithUser[];
    } catch (error: unknown) {
      throw error;
    }
  }

  static async updateStatus(
    id: string, 
    status: 'UNPAID' | 'PAID' | 'CANCELED', 
    paymentHash?: string
  ): Promise<InvoiceWithUser> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      // Set paidAt and paymentHash when marking as paid
      if (status === 'PAID') {
        updateData.paidAt = new Date();
        if (paymentHash) {
          updateData.paymentHash = paymentHash;
        }
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

      return updatedInvoice as InvoiceWithUser;
    } catch (error: unknown) {
      throw error;
    }
  }

  static async getWithConversionDetails(id: string): Promise<InvoiceWithUser & { conversion: any } | null> {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id },
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

      if (!invoice) return null;

      return {
        ...(invoice as InvoiceWithUser),
        conversion: {
          usdAmount: invoice.amount,
          ethAmount: invoice.ethAmount,
          weiAmount: invoice.weiAmount,
          ethPrice: invoice.ethPrice,
          displayText: invoice.ethAmount ? `This is ~${invoice.ethAmount.toFixed(6)} ETH` : null,
        },
      };
    } catch (error: unknown) {
      throw error;
    }
  }

  static async updateWithNewConversion(
    id: string, 
    amount: number, 
    ethAmount: number, 
    weiAmount: string, 
    ethPrice: number
  ): Promise<InvoiceWithUser> {
    try {
      const updatedInvoice = await prisma.invoice.update({
        where: { id },
        data: {
          amount,
          ethAmount,
          weiAmount,
          ethPrice,
          updatedAt: new Date(),
        },
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

      return updatedInvoice as InvoiceWithUser;
    } catch (error: unknown) {
      throw error;
    }
  }

  static async getByStatus(status: 'UNPAID' | 'PAID' | 'CANCELED'): Promise<InvoiceWithUser[]> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { status },
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
        },
      });

      return invoices as InvoiceWithUser[];
    } catch (error: unknown) {
      throw error;
    }
  }

  static async getByCrossChainIdentityId(crossChainIdentityId: string): Promise<InvoiceWithUser[]> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { crossChainIdentityId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              walletAddress: true,
              blockchainId: true,
            },
          },
          crossChainIdentity: {
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

      return invoices as InvoiceWithUser[];
    } catch (error: unknown) {
      throw error;
    }
  }
}
