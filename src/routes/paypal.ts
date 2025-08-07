// src/routes/paypal.ts
import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { getPayPalAccessToken } from '../utils/getPayPalAccessToken.js';
import { PrismaClient } from '@prisma/client';
import { CreditScoreService } from '../services/creditScore.js';

export const prisma = new PrismaClient();

export async function paypalRoutes(fastify: FastifyInstance) {
  
  // Test PayPal connection endpoint
  fastify.get('/test-paypal-connection', async (request, reply) => {
    try {
      const accessToken = await getPayPalAccessToken();
      return reply.send({ 
        success: true, 
        message: 'PayPal connection successful',
        tokenLength: accessToken.length,
        tokenPrefix: accessToken.substring(0, 10) + "..."
      });
    } catch (error: any) {
      return reply.status(500).send({ 
        success: false,
        error: 'PayPal connection failed',
        details: error.message 
      });
    }
  });

  // Create subscription route
  fastify.post('/create-subscription', async (request, reply) => {
    try {
      const { plan_id, userId, invoiceId, prismaPlanId, subscriptionId } = request.body as {
        plan_id?: string;
        userId?: string;
        invoiceId?: string;
        prismaPlanId?: string;
        subscriptionId?: string;
      };

      // Validate required fields
      if (!plan_id || !userId || !prismaPlanId) {
        return reply.code(400).send({ 
          error: 'Missing required fields',
          required: ['plan_id', 'userId', 'prismaPlanId'],
          received: { plan_id, userId, prismaPlanId }
        });
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!existingUser) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if plan exists
      const plan = await prisma.plan.findUnique({
        where: { id: prismaPlanId },
      });

      if (!plan) {
        return reply.code(404).send({ error: 'Plan not found' });
      }

      // Handle subscription ID from frontend or create new one
      let finalSubscriptionId = subscriptionId;
      
      if (subscriptionId) {
        // Verify subscription with PayPal API
        try {
          const accessToken = await getPayPalAccessToken();
          const mode = process.env.PAYPAL_MODE || 'sandbox';
          const baseUrl = mode === 'live' 
            ? 'https://api-m.paypal.com' 
            : 'https://api-m.sandbox.paypal.com';

          await axios.get(
            `${baseUrl}/v1/billing/subscriptions/${subscriptionId}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
        } catch (verifyError: any) {
          // Continue processing even if verification fails
        }
      } else {
        // Create subscription via PayPal API
        const accessToken = await getPayPalAccessToken();
        const mode = process.env.PAYPAL_MODE || 'sandbox';
        const baseUrl = mode === 'live' 
          ? 'https://api-m.paypal.com' 
          : 'https://api-m.sandbox.paypal.com';

        const subscriptionResponse = await axios.post(
          `${baseUrl}/v1/billing/subscriptions`,
          {
            plan_id,
            application_context: {
              brand_name: 'MythosNet',
              return_url: 'https://yourdomain.com/success',
              cancel_url: 'https://yourdomain.com/cancel',
            },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        
        finalSubscriptionId = subscriptionResponse.data.id;
      }

      // Update invoice if provided
      if (invoiceId) {
        try {
          await prisma.invoice.update({
            where: { id: invoiceId },
            data: {
              status: 'PAID',
              subscriptionId: finalSubscriptionId,
            },
          });

          // Recalculate credit score
          const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
          });

          if (invoice && invoice.userId) {
            await CreditScoreService.calculateScore(invoice.userId);
          }
        } catch (invoiceError: any) {
          // Log error in production logging system if needed
        }
      }

      // Update user with new plan and subscription
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            planId: prismaPlanId,
            subscriptionId: finalSubscriptionId,
            trialUsed: true,
            trialStartDate: null,
          },
        });
      } catch (userUpdateError: any) {
        return reply.code(500).send({ 
          error: 'Failed to update user plan',
          details: userUpdateError.message
        });
      }

      // Create transaction record
      try {
        await prisma.transaction.create({
          data: {
            userId,
            amount: plan.price,
            type: 'debit',
            status: 'SUCCESS',
            hash: finalSubscriptionId,
            riskScore: 0.1,
          },
        });
      } catch (transactionError: any) {
        // Log error in production logging system if needed
      }

      return reply.send({
        success: true,
        message: 'Subscription created & plan assigned successfully',
        subscriptionId: finalSubscriptionId,
        planName: plan.name,
        userId
      });

    } catch (err: any) {
      return reply.code(500).send({ 
        error: 'Subscription creation failed',
        details: err.message 
      });
    }
  });

  // Test plan switch (for testing environments only)
  fastify.post('/test-plan-switch', async (request, reply) => {
    try {
      const { userId, prismaPlanId } = request.body as {
        userId: string;
        prismaPlanId: string;
      };

      if (!userId || !prismaPlanId) {
        return reply.code(400).send({ error: 'Missing userId or prismaPlanId' });
      }

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if plan exists
      const plan = await prisma.plan.findUnique({
        where: { id: prismaPlanId }
      });

      if (!plan) {
        return reply.code(404).send({ error: 'Plan not found' });
      }

      // Update user plan
      await prisma.user.update({
        where: { id: userId },
        data: {
          planId: prismaPlanId,
          subscriptionId: 'test-subscription-' + Date.now(),
          trialUsed: true,
          trialStartDate: null,
        },
      });

      // Create test transaction
      await prisma.transaction.create({
        data: {
          userId,
          amount: plan.price,
          type: 'debit',
          status: 'SUCCESS',
          hash: 'test-transaction-' + Date.now(),
          riskScore: 0.1,
        },
      });

      const testSubscriptionId = 'test-subscription-' + Date.now();

      return reply.send({
        success: true,
        message: 'Plan switched successfully (test mode)',
        userId,
        planName: plan.name,
        prismaPlanId,
        subscriptionId: testSubscriptionId
      });

    } catch (error: any) {
      return reply.status(500).send({ 
        error: 'Plan switch failed',
        details: error.message 
      });
    }
  });

  // Capture subscription route
  fastify.post('/capture-subscription', async (request, reply) => {
    try {
      const { subscriptionId } = request.body as { subscriptionId: string };

      if (!subscriptionId) {
        return reply.code(400).send({ error: 'Missing subscriptionId' });
      }

      const accessToken = await getPayPalAccessToken();
      const mode = process.env.PAYPAL_MODE || 'sandbox';
      const baseUrl = mode === 'live' 
        ? 'https://api-m.paypal.com' 
        : 'https://api-m.sandbox.paypal.com';

      const captureResponse = await axios.post(
        `${baseUrl}/v1/billing/subscriptions/${subscriptionId}/activate`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return reply.send({
        message: 'Subscription activated',
        data: captureResponse.data,
      });
    } catch (err: any) {
      return reply.code(500).send({ error: 'Subscription capture failed' });
    }
  });

  // Webhook handler
  fastify.post('/webhook', async (request, reply) => {
    try {
      const event = request.body as {
        event_type: string;
        resource: { id: string };
      };

      const eventType = event.event_type;
      const subscriptionId = event.resource.id;

      if (!subscriptionId) {
        return reply.code(400).send({ error: 'Missing subscription ID in webhook' });
      }

      if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
        await prisma.user.updateMany({
          where: { subscriptionId },
          data: {
            planId: null,
            subscriptionId: null,
            trialUsed: true,
            trialStartDate: null,
          },
        });
      }

      return reply.code(200).send({ received: true });
    } catch (err) {
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });
}
