import { FastifyRequest, FastifyReply } from 'fastify';

export const authenticationHook = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // For now, this is a placeholder - implement your actual auth logic
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // For development, we'll allow requests without auth
      // In production, uncomment the line below:
      // return reply.status(401).send({ error: 'Authentication required' });
      console.warn('⚠️ No authentication header provided - allowing for development');
      return;
    }

    const token = authHeader.substring(7);
    
    // TODO: Implement actual JWT validation here
    if (!token) {
      return reply.status(401).send({ error: 'Invalid authentication token' });
    }

    // Add user info to request object if needed
    // request.user = decodedUser;
    
  } catch (error) {
    console.error('Authentication error:', error);
    return reply.status(401).send({ error: 'Authentication failed' });
  }
};
