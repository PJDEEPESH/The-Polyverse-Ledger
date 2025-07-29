// src/routes/organization.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabaseClient.js';
import { generateUUID } from '../utils/ubid.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  planId: z.string().min(1),
  ownerWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  description: z.string().optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  planId: z.string().min(1).optional(),
  description: z.string().optional(),
});

export async function organizationRoutes(fastify: FastifyInstance) {
  // Get all organizations
  fastify.get('/', async (request, reply) => {
    try {
      const { data: organizations, error } = await supabase
        .from('Organization')
        .select(`
          *,
          Plan (name, queryLimit, userLimit),
          User!Organization_ownerId_fkey (walletAddress)
        `)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      return reply.send({ success: true, data: organizations || [] });
    } catch (error) {
      console.error('Fetch organizations error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch organizations',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Create new organization
  fastify.post('/', async (request, reply) => {
    try {
      const parsed = createOrgSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const { name, planId, ownerWalletAddress, description } = parsed.data;

      // Verify plan exists
      const { data: plan, error: planError } = await supabase
        .from('Plan')
        .select('id, name, userLimit')
        .eq('id', planId)
        .single();

      if (planError || !plan) {
        return reply.status(400).send({ error: 'Invalid plan ID' });
      }

      // Find owner user (get most recent)
      const { data: ownerUser, error: userError } = await supabase
        .from('User')
        .select('id')
        .eq('walletAddress', ownerWalletAddress)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (userError || !ownerUser) {
        return reply.status(400).send({ error: 'Owner user not found' });
      }

      const now = new Date().toISOString();
      const orgData = {
        id: generateUUID(),
        name,
        planId,
        ownerId: ownerUser.id,
        description: description || null,
        createdAt: now,
        updatedAt: now,
      };

      // Create organization
      const { data: organization, error } = await supabase
        .from('Organization')
        .insert(orgData)
        .select(`
          *,
          Plan (name, queryLimit, userLimit),
          User!Organization_ownerId_fkey (walletAddress)
        `)
        .single();

      if (error) throw error;

      return reply.status(201).send({
        success: true,
        data: organization,
        message: 'Organization created successfully',
      });

    } catch (error) {
      console.error('Create organization error:', error);
      return reply.status(500).send({
        error: 'Failed to create organization',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get organization by ID
  fastify.get('/:orgId', async (request, reply) => {
    try {
      const { orgId } = request.params as { orgId: string };

      const { data: organization, error } = await supabase
        .from('Organization')
        .select(`
          *,
          Plan (name, queryLimit, userLimit),
          User!Organization_ownerId_fkey (walletAddress)
        `)
        .eq('id', orgId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Organization not found' });
        }
        throw error;
      }

      // Get member count
      const { count: memberCount, error: countError } = await supabase
        .from('User')
        .select('*', { count: 'exact', head: true })
        .eq('orgId', orgId);

      if (countError) throw countError;

      return reply.send({
        success: true,
        data: {
          ...organization,
          memberCount: memberCount || 0,
          canAddMembers: (memberCount || 0) < ((organization.Plan as any)?.userLimit || 1)
        }
      });

    } catch (error) {
      console.error('Fetch organization error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch organization',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Update organization
  fastify.patch('/:orgId', async (request, reply) => {
    try {
      const { orgId } = request.params as { orgId: string };
      
      const parsed = updateOrgSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const updateData = {
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      };

      // If updating planId, verify it exists
      if (parsed.data.planId) {
        const { data: plan, error: planError } = await supabase
          .from('Plan')
          .select('id')
          .eq('id', parsed.data.planId)
          .single();

        if (planError || !plan) {
          return reply.status(400).send({ error: 'Invalid plan ID' });
        }
      }

      const { data: organization, error } = await supabase
        .from('Organization')
        .update(updateData)
        .eq('id', orgId)
        .select(`
          *,
          Plan (name, queryLimit, userLimit),
          User!Organization_ownerId_fkey (walletAddress)
        `)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Organization not found' });
        }
        throw error;
      }

      return reply.send({
        success: true,
        data: organization,
        message: 'Organization updated successfully',
      });

    } catch (error) {
      console.error('Update organization error:', error);
      return reply.status(500).send({
        error: 'Failed to update organization',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Delete organization
  fastify.delete('/:orgId', async (request, reply) => {
    try {
      const { orgId } = request.params as { orgId: string };

      // Check if organization has members
      const { count: memberCount, error: countError } = await supabase
        .from('User')
        .select('*', { count: 'exact', head: true })
        .eq('orgId', orgId);

      if (countError) throw countError;

      if (memberCount && memberCount > 0) {
        return reply.status(400).send({
          error: 'Cannot delete organization with members. Remove all members first.',
          memberCount
        });
      }

      const { error } = await supabase
        .from('Organization')
        .delete()
        .eq('id', orgId);

      if (error) throw error;

      return reply.send({
        success: true,
        message: 'Organization deleted successfully',
      });

    } catch (error) {
      console.error('Delete organization error:', error);
      return reply.status(500).send({
        error: 'Failed to delete organization',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get organization members
  fastify.get('/:orgId/members', async (request, reply) => {
    try {
      const { orgId } = request.params as { orgId: string };

      // Verify organization exists
      const { data: org, error: orgError } = await supabase
        .from('Organization')
        .select(`
          id,
          name,
          Plan (name, userLimit)
        `)
        .eq('id', orgId)
        .single();

      if (orgError) {
        if (orgError.code === 'PGRST116') {
          return reply.status(404).send({ error: 'Organization not found' });
        }
        throw orgError;
      }

      // Get members
      const { data: members, error } = await supabase
        .from('User')
        .select(`
          id,
          walletAddress,
          metadataURI,
          createdAt,
          updatedAt,
          creditScore
        `)
        .eq('orgId', orgId)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      return reply.send({
        success: true,
        data: members || [],
        organization: org,
        memberCount: members?.length || 0,
        userLimit: (org.Plan as any)?.userLimit || 1,
        canAddMembers: (members?.length || 0) < ((org.Plan as any)?.userLimit || 1)
      });

    } catch (error) {
      console.error('Fetch organization members error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch organization members',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Get organizations by owner
  fastify.get('/owner/:walletAddress', async (request, reply) => {
    try {
      const { walletAddress } = request.params as { walletAddress: string };

      if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.status(400).send({ error: 'Invalid wallet address' });
      }

      // Find user first
      const { data: user, error: userError } = await supabase
        .from('User')
        .select('id')
        .eq('walletAddress', walletAddress)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (userError || !user) {
        return reply.send({ success: true, data: [] });
      }

      // Get organizations owned by this user
      const { data: organizations, error } = await supabase
        .from('Organization')
        .select(`
          *,
          Plan (name, queryLimit, userLimit)
        `)
        .eq('ownerId', user.id)
        .order('createdAt', { ascending: false });

      if (error) throw error;

      // Add member counts
      const orgsWithCounts = await Promise.all(
        (organizations || []).map(async (org) => {
          const { count } = await supabase
            .from('User')
            .select('*', { count: 'exact', head: true })
            .eq('orgId', org.id);

          return {
            ...org,
            memberCount: count || 0,
            canAddMembers: (count || 0) < ((org.Plan as any)?.userLimit || 1)
          };
        })
      );

      return reply.send({ success: true, data: orgsWithCounts });

    } catch (error) {
      console.error('Fetch organizations by owner error:', error);
      return reply.status(500).send({
        error: 'Failed to fetch organizations',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
