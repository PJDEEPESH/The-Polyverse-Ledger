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
      console.error('PayPal connection test failed:', error);
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
      console.log('📥 Received subscription request:', JSON.stringify(request.body, null, 2));
      
      const { plan_id, userId, invoiceId, prismaPlanId } = request.body as {
        plan_id?: string;
        userId?: string;
        invoiceId?: string;
        prismaPlanId?: string;
      };

      // Validate required fields
      if (!plan_id || !userId || !prismaPlanId) {
        console.error('❌ Missing required fields:', { plan_id, userId, prismaPlanId });
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
        console.error('❌ User not found:', userId);
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if plan exists
      const plan = await prisma.plan.findUnique({
        where: { id: prismaPlanId },
      });

      if (!plan) {
        console.error('❌ Plan not found:', prismaPlanId);
        return reply.code(404).send({ error: 'Plan not found' });
      }

      console.log('✅ User and plan validation passed');

      // Get PayPal access token
      let accessToken;
      try {
        accessToken = await getPayPalAccessToken();
        console.log('✅ PayPal access token obtained');
      } catch (tokenError: any) {
        console.error('❌ PayPal token error:', tokenError.message);
        return reply.code(500).send({ 
          error: 'PayPal authentication failed',
          details: tokenError.message
        });
      }

      const mode = process.env.PAYPAL_MODE || 'sandbox';
      const baseUrl = mode === 'live' 
        ? 'https://api-m.paypal.com' 
        : 'https://api-m.sandbox.paypal.com';

      // Create PayPal subscription
      let subscriptionResponse;
      try {
        console.log('🔄 Creating PayPal subscription...');
        subscriptionResponse = await axios.post(
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
        console.log('✅ PayPal subscription created:', subscriptionResponse.data.id);
      } catch (paypalError: any) {
        console.error('❌ PayPal subscription creation failed:', paypalError?.response?.data || paypalError.message);
        return reply.code(500).send({ 
          error: 'PayPal subscription creation failed',
          details: paypalError?.response?.data || paypalError.message
        });
      }

      const subscriptionId = subscriptionResponse.data.id;

      // Update invoice if provided
      if (invoiceId) {
        try {
          await prisma.invoice.update({
            where: { id: invoiceId },
            data: {
              status: 'PAID',
              subscriptionId,
            },
          });

          // Recalculate credit score
          const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
          });

          if (invoice && invoice.userId) {
            await CreditScoreService.calculateScore(invoice.userId);
            console.log(`✅ Credit score recalculated for user: ${invoice.userId}`);
          }
        } catch (invoiceError: any) {
          console.error('⚠️ Error updating invoice or credit score:', invoiceError);
        }
      }

      // Update user with new plan
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            planId: prismaPlanId,
            subscriptionId,
            trialUsed: true,
            trialStartDate: new Date(),
          },
        });
        console.log('✅ User plan updated successfully');
      } catch (userUpdateError: any) {
        console.error('❌ Error updating user plan:', userUpdateError);
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
            hash: subscriptionId,
            riskScore: 0.1,
          },
        });
        console.log('✅ Transaction record created');
      } catch (transactionError: any) {
        console.error('⚠️ Error creating transaction record:', transactionError);
      }

      return reply.send({
        success: true,
        message: '✅ Subscription created & plan assigned successfully',
        subscriptionId,
        planName: plan.name,
        userId
      });

    } catch (err: any) {
      console.error('❌ Unexpected error in subscription creation:', err);
      return reply.code(500).send({ 
        error: 'Subscription creation failed',
        details: err.message 
      });
    }
  });

  // Test plan switch (bypass PayPal for testing)
  fastify.post('/test-plan-switch', async (request, reply) => {
    try {
      console.log('🧪 Test plan switch request:', request.body);
      
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

      // Update user plan (skip PayPal for testing)
      await prisma.user.update({
        where: { id: userId },
        data: {
          planId: prismaPlanId,
          subscriptionId: 'test-subscription-' + Date.now(),
          trialUsed: true,
          trialStartDate: new Date(),
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

      return reply.send({
        success: true,
        message: '✅ Plan switched successfully (test mode)',
        userId,
        planName: plan.name,
        prismaPlanId
      });

    } catch (error: any) {
      console.error('❌ Test plan switch error:', error);
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
        message: '✅ Subscription activated',
        data: captureResponse.data,
      });
    } catch (err: any) {
      console.error('❌ Capture error:', err?.response?.data || err.message);
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

      console.log(`📩 Received PayPal Webhook: ${eventType}`);

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
        console.log(`🔴 Subscription ${subscriptionId} cancelled. User downgraded.`);
      }

      return reply.code(200).send({ received: true });
    } catch (err) {
      console.error('❌ Webhook error:', err);
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });
}
