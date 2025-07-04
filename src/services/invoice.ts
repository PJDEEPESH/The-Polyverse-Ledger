import { PrismaClient } from '@prisma/client';
import { create } from 'ipfs-http-client';
import { ethers } from 'ethers';

const prisma = new PrismaClient();
const ipfs = create({ url: process.env.IPFS_URL || 'http://localhost:5001' });

export class InvoiceService {
  static async create(data: {
    userId: string;
    blockchainId: string;
    amount: number;
    dueDate: Date;
  }) {
    try {
      // Store invoice data in IPFS
      const ipfsResult = await ipfs.add(JSON.stringify({
        ...data,
        timestamp: new Date().toISOString()
      }));

      // Extract the hash from IPFS result
      const hash = ipfsResult.path;

      const invoice = await prisma.invoice.create({
  data: {
    status: 'pending',
    ipfsHash: ipfsResult.path, // Use ipfsResult.path instead of hash
    userId: data.userId,       // Use data instead of invoiceData
    blockchainId: data.blockchainId,
    amount: data.amount,
    dueDate: data.dueDate,
    currency: 'USD'
  }
});

      return invoice;
    } catch (error) {
      console.error('Error creating invoice:', error);
      throw new Error('Failed to create invoice');
    }
  }

  static async tokenize(invoiceId: string) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId }
      });

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (invoice.tokenized) {
        throw new Error('Invoice already tokenized');
      }

      // Here you would implement the actual tokenization logic
      // using smart contracts on the respective blockchain
      
      // Example blockchain interaction (you'll need to implement this based on your smart contract)
      // const contract = await getTokenizationContract(invoice.blockchainId);
      // const tokenId = await contract.tokenizeInvoice(invoice.id, invoice.amount);

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { 
          tokenized: true,
          status: 'tokenized'
          // tokenId: tokenId // Add this if you have a tokenId field
        }
      });

      return updatedInvoice;
    } catch (error) {
      console.error('Error tokenizing invoice:', error);
      throw new Error('Failed to tokenize invoice');
    }
  }

  static async getById(invoiceId: string) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          user: {
            select: {
              id: true,
              walletAddress: true,
              blockchainId: true
            }
          }
        }
      });

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      return invoice;
    } catch (error) {
      console.error('Error fetching invoice:', error);
      throw new Error('Failed to fetch invoice');
    }
  }

  static async getByUserId(userId: string) {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });

      return invoices;
    } catch (error) {
      console.error('Error fetching user invoices:', error);
      throw new Error('Failed to fetch user invoices');
    }
  }

  static async updateStatus(invoiceId: string, status: string) {
    try {
      const validStatuses = ['pending', 'paid', 'overdue', 'tokenized', 'cancelled'];
      
      if (!validStatuses.includes(status)) {
        throw new Error('Invalid status');
      }

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status }
      });

      return updatedInvoice;
    } catch (error) {
      console.error('Error updating invoice status:', error);
      throw new Error('Failed to update invoice status');
    }
  }

  static async getFromIPFS(ipfsHash: string) {
    try {
      const chunks = [];
      for await (const chunk of ipfs.cat(ipfsHash)) {
        chunks.push(chunk);
      }
      
      const data = Buffer.concat(chunks).toString();
      return JSON.parse(data);
    } catch (error) {
      console.error('Error fetching from IPFS:', error);
      throw new Error('Failed to fetch invoice data from IPFS');
    }
  }
}