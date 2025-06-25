// src/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import dotenv from 'dotenv';
import mongoose from 'mongoose';


import {blockchainRoutes} from './routes/blockchain.js';
import { userRoutes } from './routes/user.js';
import { invoiceRoutes } from './routes/invoice.js';
import { creditScoreRoutes } from './routes/creditScore.js';

dotenv.config(); // Load environment variables

const fastify = Fastify({ logger: true });



await fastify.register(cors, {
  origin: true,
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'supersecret',
});

await fastify.register(swagger, {
  routePrefix: '/documentation',
  swagger: {
    info: {
      title: 'MythosNet Universal Registry Protocol API',
      description: 'API documentation for the Universal Blockchain Registry Protocol',
      version: '1.0.0',
    },
    host: 'localhost:3000',
    schemes: ['http'],
    consumes: ['application/json'],
    produces: ['application/json'],
  },
  exposeRoute: true,
});

try {
  await mongoose.connect(process.env.MONGO_URI!);
  console.log('Connected to MongoDB');
} catch (err) {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
}


await fastify.register(blockchainRoutes, { prefix: '/api/v1/blockchain' });
await fastify.register(userRoutes, { prefix: '/api/v1/users' });
await fastify.register(invoiceRoutes, { prefix: '/api/v1/invoices' });
await fastify.register(creditScoreRoutes, { prefix: '/api/v1/credit-score' });

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log(`Server running at http://localhost:3000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
