// src/routes/dashboard.ts
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function dashboardRoutes(fastify: FastifyInstance) {
  // Dashboard Stats
  fastify.get('/stats', async () => {
    const totalUsers = await prisma.user.count();
    const totalInvoices = await prisma.invoice.count();
    const totalBlockchains = await prisma.blockchain.count();

    const average = await prisma.user.aggregate({
      _avg: { creditScore: true }
    });

    return {
      totalUsers,
      totalInvoices,
      totalBlockchains,
      averageScore: Math.round(average._avg.creditScore ?? 0)
    };
  });

  // Recent Activity
  fastify.get('/activity', async (_, reply) => {
    try {
      const recentUsers = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      const recentInvoices = await prisma.invoice.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      const recentBlockchains = await prisma.blockchain.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      const activity = [
        ...recentUsers.map(user => ({
          type: 'user',
          description: 'New user registered',
          details: `Wallet: ${user.walletAddress}`,
          timestamp: user.createdAt
        })),
        ...recentInvoices.map(invoice => ({
          type: 'invoice',
          description: 'Invoice created',
          details: `By User ID: ${invoice.userId}`,
          timestamp: invoice.createdAt
        })),
        ...recentBlockchains.map(chain => ({
          type: 'blockchain',
          description: 'Blockchain connected',
          details: `${chain.name}`, // ✅ use 'name' not 'networkName'
          timestamp: chain.createdAt
        }))
      ];

      activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      reply.send(activity.slice(0, 6));
    } catch (err) {
      reply.status(500).send({ error: 'Failed to fetch activity' });
    }
  });
}
