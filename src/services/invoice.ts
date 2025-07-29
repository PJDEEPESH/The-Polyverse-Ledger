// src/services/invoice.ts - CORRECTED: Fixed all TypeScript errors
import { PrismaClient } from '@prisma/client';
import { create } from 'ipfs-http-client';

const prisma = new PrismaClient();
const ipfs = create({ url: process.env.IPFS_URL || 'http://localhost:5001' });

// ✅ CORRECTED: Updated type to match actual schema
type InvoiceWithUser = {
  id: string;
  userId: string;
  blockchainId: string;
  walletAddress: string;
  crossChainIdentityId?: string | null; // ✅ This will be added after schema migration
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
        console.warn('⚠️ IPFS upload failed, proceeding without IPFS hash:', ipfsError);
      }

      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries) {
        try {
          // ✅ CORRECTED: Create invoice data without crossChainIdentityId for now
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
            status: 'UNPAID', // ✅ Use correct enum value
          };

          // ✅ TEMPORARY: Only add crossChainIdentityId if your schema supports it
          // Uncomment this line after running the migration:
          // if (data.crossChainIdentityId) {
          //   invoiceData.crossChainIdentityId = data.crossChainIdentityId;
          // }

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
              // ✅ CORRECTED: Removed crossChainIdentity include (add back after migration)
              // crossChainIdentity: {
              //   select: {
              //     id: true,
              //     walletAddress: true,
              //     blockchainId: true,
              //   },
              // },
            },
          });

          return invoice as InvoiceWithUser;

        } catch (dbError: unknown) {
          attempt++;
          if (attempt >= maxRetries) {
            console.error(`❌ Failed to create invoice after ${maxRetries} attempts:`, dbError);
            throw dbError;
          }
          
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }

      throw new Error('Failed to create invoice after maximum retries');

    } catch (error: unknown) {
      console.error('❌ Error in InvoiceService.create:', error);
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
      console.error('❌ Error in InvoiceService.getById:', error);
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
      console.error('❌ Error in InvoiceService.getByUserId:', error);
      throw error;
    }
  }

  static async getByWalletAddress(walletAddress: string): Promise<InvoiceWithUser[]> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: {
          walletAddress: walletAddress,
        },
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
      console.error('❌ Error in InvoiceService.getByWalletAddress:', error);
      throw error;
    }
  }

  // ✅ CORRECTED: Use correct status enum values
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

      // ✅ Set paidAt and paymentHash when marking as paid
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
      console.error('❌ Error in InvoiceService.updateStatus:', error);
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
      console.error('❌ Error in InvoiceService.getWithConversionDetails:', error);
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
      console.error('❌ Error in InvoiceService.updateWithNewConversion:', error);
      throw error;
    }
  }

  // ✅ CORRECTED: Use correct status enum values
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
      console.error('❌ Error in InvoiceService.getByStatus:', error);
      throw error;
    }
  }

  // ✅ NEW: Method to get invoices by CrossChainIdentity (add after migration)
  // static async getByCrossChainIdentityId(crossChainIdentityId: string): Promise<InvoiceWithUser[]> {
  //   try {
  //     const invoices = await prisma.invoice.findMany({
  //       where: { crossChainIdentityId },
  //       orderBy: { createdAt: 'desc' },
  //       include: {
  //         user: {
  //           select: {
  //             id: true,
  //             walletAddress: true,
  //             blockchainId: true,
  //           },
  //         },
  //         crossChainIdentity: {
  //           select: {
  //             id: true,
  //             walletAddress: true,
  //             blockchainId: true,
  //           },
  //         },
  //         transactions: {
  //           select: {
  //             id: true,
  //             amount: true,
  //             type: true,
  //             status: true,
  //             hash: true,
  //             createdAt: true,
  //           },
  //         },
  //       },
  //     });

  //     return invoices as InvoiceWithUser[];
  //   } catch (error: unknown) {
  //     console.error('❌ Error in InvoiceService.getByCrossChainIdentityId:', error);
  //     throw error;
  //   }
  // }
}
