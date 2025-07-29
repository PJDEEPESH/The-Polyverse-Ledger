import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import dotenv from 'dotenv';
import formbody from '@fastify/formbody';

dotenv.config();

import { paypalRoutes } from './routes/paypal.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { blockchainRoutes } from './routes/blockchain.js';
import { userRoutes } from './routes/user.js';
import { invoiceRoutes } from './routes/invoice.js';
import { creditScoreRoutes } from './routes/creditScore.js';
import { crossChainIdentityRoutes } from './routes/crossChainIdentity.js';
import { crossChainTransactionRoutes } from './routes/crossChainTransaction.js';
import { planRoutes } from './routes/plan.js';
import { queryRoutes } from './routes/query.js';
import { transactionRoutes } from './routes/transaction.js';
import { organizationRoutes } from './routes/organization.js';

const fastify = Fastify({
  logger: true,
  bodyLimit: 1048576, // 1MB
  trustProxy: true,
  ignoreTrailingSlash: true,
});

// Register plugins
await fastify.register(cors, {
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
});

await fastify.register(formbody);

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecret',
});

await fastify.register(swagger, {
  swagger: {
    info: {
      title: 'MythosNet Universal Registry Protocol API',
      description: 'API documentation',
      version: '1.0.0',
    },
    host: 'localhost:3000',
    schemes: ['http'],
    consumes: ['application/json'],
    produces: ['application/json'],
  },
});

// ✅ CORRECTED: Register routes with proper prefixes
await fastify.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
await fastify.register(blockchainRoutes, { prefix: '/api/v1/blockchain' });
await fastify.register(userRoutes, { prefix: '/api/v1/user' });
await fastify.register(organizationRoutes, { prefix: '/api/v1/organization' });
await fastify.register(invoiceRoutes, { prefix: '/api/v1/invoices' });

// ✅ FIXED: Correct credit score prefix (matches conversation history)
await fastify.register(creditScoreRoutes, { prefix: '/api/v1/credit-score' });

// ✅ FIXED: CrossChain identity prefix (matches conversation history)
await fastify.register(crossChainIdentityRoutes, { prefix: '/api/v1/crosschain-identity' });

await fastify.register(crossChainTransactionRoutes, { prefix: '/api/v1/transaction/cross-chain' });
await fastify.register(queryRoutes, { prefix: '/api/v1/query' });

// ✅ FIXED: Add proper prefixes for these routes
await fastify.register(transactionRoutes, { prefix: '/api/v1/transaction' });
await fastify.register(planRoutes, { prefix: '/api/v1/plan' });
await fastify.register(paypalRoutes, { prefix: '/api/v1/paypal' });

// Health check
fastify.get('/health', async () => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(500).send({
    error: 'Internal Server Error',
    message: error.message,
    timestamp: new Date().toISOString(),
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('✅ Server running at http://localhost:3000');
    console.log('📚 Swagger docs: http://localhost:3000/documentation');
    
    // ✅ ADDED: Log all registered routes for debugging
    console.log('\n🛣️  Registered API Routes:');
    console.log('  GET /health');
    console.log('  📊 /api/v1/dashboard/*');
    console.log('  ⛓️  /api/v1/blockchain/*');
    console.log('  👤 /api/v1/user/*');
    console.log('  🏢 /api/v1/organization/*');
    console.log('  📄 /api/v1/invoices/*');
    console.log('  📈 /api/v1/credit-score/*');
    console.log('  🔗 /api/v1/crosschain-identity/*');
    console.log('  💸 /api/v1/transaction/*');
    console.log('  📋 /api/v1/plan/*');
    console.log('  💳 /api/v1/paypal/*');
    console.log('  🔍 /api/v1/query/*');
    console.log('');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
