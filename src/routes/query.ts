import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabaseClient.js';
import { walletValidationHook } from '../middleware/validateWallet.js';
import { generateUUID } from '../utils/ubid.js';
import { isTrialActive } from '../utils/isTrialActive.js';

export async function queryRoutes(fastify: FastifyInstance) {
  // Helper: get current month and year
  const getCurrentMonthYear = () => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  };

  // Helper: get Free user usage from last 5 days
  const getFreeUserUsage = async (userId: string) => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const { data: recentQueries, error } = await supabase
      .from('QueryUsage')
      .select('used, createdAt')
      .eq('userId', userId)
      .gte('createdAt', fiveDaysAgo.toISOString());

    if (error) throw error;

    const totalUsed = recentQueries?.reduce((sum, record) => sum + record.used, 0) || 0;
    
    return {
      used: totalUsed,
      limit: 100,
      remaining: Math.max(0, 100 - totalUsed)
    };
  };

  // Helper: get team usage for organizations
  const getTeamUsage = async (userId: string, month: number, year: number) => {
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id, orgId')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    if (!user.orgId) {
      // Individual usage
      const { data: usage, error: usageError } = await supabase
        .from('QueryUsage')
        .select('used')
        .eq('userId', userId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (usageError) throw usageError;
      return usage?.used || 0;
    }

    // Team usage
    const { data: teamMembers, error: membersError } = await supabase
      .from('User')
      .select('id')
      .eq('orgId', user.orgId);

    if (membersError) throw membersError;

    const teamIds = teamMembers.map(member => member.id);
    const { data: teamUsage, error: teamUsageError } = await supabase
      .from('QueryUsage')
      .select('used')
      .in('userId', teamIds)
      .eq('month', month)
      .eq('year', year);

    if (teamUsageError) throw teamUsageError;

    return teamUsage?.reduce((sum, record) => sum + record.used, 0) || 0;
  };

  // GET /usage/:walletAddress/:blockchainId
  fastify.get('/usage/:walletAddress/:blockchainId', {
    preHandler: [walletValidationHook]
  }, async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as {
        walletAddress: string;
        blockchainId: string;
      };

      if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.status(400).send({ error: 'Invalid wallet address' });
      }

      const { month, year } = getCurrentMonthYear();

      // Get user with basic plan info
      const { data: user, error: userError } = await supabase
        .from('User')
        .select(`
          id,
          planId,
          orgId,
          trialStartDate,
          trialUsed,
          Plan (
            name,
            queryLimit
          )
        `)
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .maybeSingle();

      if (userError) throw userError;
      if (!user) return reply.status(404).send({ success: false, error: 'User not found' });

      // Determine effective plan
      let effectivePlan;
      if (user.orgId) {
        // Team member - get plan from organization owner
        const { data: organization, error: orgError } = await supabase
          .from('Organization')
          .select('ownerId')
          .eq('id', user.orgId)
          .single();

        if (orgError) throw orgError;

        // Get owner's plan
        const { data: orgOwner, error: ownerError } = await supabase
          .from('User')
          .select(`
            Plan (
              name,
              queryLimit
            )
          `)
          .eq('id', organization.ownerId)
          .single();

        if (ownerError || !orgOwner?.Plan) {
          throw new Error('Organization owner plan not found');
        }

        effectivePlan = Array.isArray(orgOwner.Plan) ? orgOwner.Plan[0] : orgOwner.Plan;
      } else if (user.planId && user.Plan) {
        // Individual user with plan
        effectivePlan = Array.isArray(user.Plan) ? user.Plan[0] : user.Plan;
      } else {
        // Default to Free plan
        const { data: freePlan, error: freePlanError } = await supabase
          .from('Plan')
          .select('name, queryLimit')
          .eq('name', 'Free')
          .single();
        if (freePlanError || !freePlan) throw new Error('Free plan not found');
        effectivePlan = freePlan;
      }

      const trialActive = isTrialActive(user.trialStartDate);
      const isFreePlan = effectivePlan.name === 'Free';

      let queriesUsed, queriesLimit;

      if (isFreePlan && trialActive) {
        // Free user with active trial - 5-day rolling window
        const freeUsage = await getFreeUserUsage(user.id);
        queriesUsed = freeUsage.used;
        queriesLimit = 100;
      } else if (isFreePlan && !trialActive) {
        // Free user with expired trial
        return reply.status(403).send({
          success: false,
          error: 'Free trial expired. Please upgrade your plan.',
          code: 'TRIAL_EXPIRED'
        });
      } else {
        // Paid plan - monthly usage
        queriesLimit = effectivePlan.queryLimit || 0;
        
        if (user.orgId && (effectivePlan.name === 'Pro' || effectivePlan.name === 'Premium')) {
          queriesUsed = await getTeamUsage(user.id, month, year);
        } else {
          const { data: usage, error: usageError } = await supabase
            .from('QueryUsage')
            .select('used')
            .eq('userId', user.id)
            .eq('month', month)
            .eq('year', year)
            .maybeSingle();

          if (usageError) throw usageError;
          queriesUsed = usage?.used || 0;
        }
      }

      return reply.send({
        success: true,
        data: {
          walletAddress,
          blockchainId,
          queriesUsed,
          queriesLimit,
          queriesRemaining: Math.max(0, queriesLimit - queriesUsed),
          plan: effectivePlan.name,
          trialActive: isFreePlan ? trialActive : false,
          trialDaysRemaining: isFreePlan && trialActive ? 
      Math.max(0, 5 - Math.floor((Date.now() - new Date(user.trialStartDate).getTime()) / (1000 * 60 * 60 * 24))) : 
      undefined,
          month,
          year,
        },
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to fetch usage',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /usage/:walletAddress/:blockchainId 
  fastify.post('/usage/:walletAddress/:blockchainId', {
    preHandler: [walletValidationHook]
  }, async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as {
        walletAddress: string;
        blockchainId: string;
      };

      if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.status(400).send({ error: 'Invalid wallet address' });
      }

      const { month, year } = getCurrentMonthYear();

      const { data: user, error: userError } = await supabase
        .from('User')
        .select('id, planId, trialStartDate, Plan(name)')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .single();

      if (userError) throw userError;

      const plan = user.Plan ? (Array.isArray(user.Plan) ? user.Plan[0] : user.Plan) : { name: 'Free' };
      const trialActive = isTrialActive(user.trialStartDate);
      const isFreePlan = plan.name === 'Free';

      // Handle Free users differently
      if (isFreePlan && trialActive) {
        // For Free users, create daily usage record
        const today = new Date().toISOString().split('T')[0];
        const { data: todayUsage, error: fetchError } = await supabase
          .from('QueryUsage')
          .select('id, used')
          .eq('userId', user.id)
          .gte('createdAt', `${today}T00:00:00.000Z`)
          .lt('createdAt', `${today}T23:59:59.999Z`)
          .maybeSingle();

        if (fetchError) throw fetchError;

        let newUsageCount;
        
        if (todayUsage) {
          const { data: updated, error: updateError } = await supabase
            .from('QueryUsage')
            .update({ used: todayUsage.used + 1 })
            .eq('id', todayUsage.id)
            .select('used')
            .single();
            
          if (updateError) throw updateError;
          newUsageCount = updated.used;
        } else {
          const { data: created, error: insertError } = await supabase
            .from('QueryUsage')
            .insert({
              id: generateUUID(),
              userId: user.id,
              month,
              year,
              used: 1,
              createdAt: new Date().toISOString(),
            })
            .select('used')
            .single();
            
          if (insertError) throw insertError;
          newUsageCount = created.used;
        }

        return reply.send({
          success: true,
          data: {
            walletAddress,
            blockchainId,
            queriesUsed: newUsageCount,
            message: 'Free trial usage updated successfully',
          },
        });
      }

      // Handle paid plans with monthly usage
      const { data: currentUsage, error: fetchError } = await supabase
        .from('QueryUsage')
        .select('id, used')
        .eq('userId', user.id)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (fetchError) throw fetchError;

      let newUsageCount;
      
      if (currentUsage) {
        const { data: updated, error: updateError } = await supabase
          .from('QueryUsage')
          .update({ used: currentUsage.used + 1 })
          .eq('id', currentUsage.id)
          .select('used')
          .single();
          
        if (updateError) throw updateError;
        newUsageCount = updated.used;
      } else {
        const newId = generateUUID();
        const { data: created, error: insertError } = await supabase
          .from('QueryUsage')
          .insert({
            id: newId,
            userId: user.id,
            month,
            year,
            used: 1,
            createdAt: new Date().toISOString(),
          })
          .select('used')
          .single();
          
        if (insertError) throw insertError;
        newUsageCount = created.used;
      }

      return reply.send({
        success: true,
        data: {
          walletAddress,
          blockchainId,
          queriesUsed: newUsageCount,
          message: 'Query usage updated successfully',
        },
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to update usage',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // DELETE /usage/:walletAddress/:blockchainId (reset usage to 0)
  fastify.delete('/usage/:walletAddress/:blockchainId', {
    preHandler: [walletValidationHook]
  }, async (request, reply) => {
    try {
      const { walletAddress, blockchainId } = request.params as {
        walletAddress: string;
        blockchainId: string;
      };

      if (!walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply.status(400).send({ error: 'Invalid wallet address' });
      }

      const { month, year } = getCurrentMonthYear();

      const { data: user, error: userError } = await supabase
        .from('User')
        .select('id')
        .eq('walletAddress', walletAddress)
        .eq('blockchainId', blockchainId)
        .single();

      if (userError) throw userError;

      // Reset current month usage to 0
      const { data: existing, error: fetchError } = await supabase
        .from('QueryUsage')
        .select('id')
        .eq('userId', user.id)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (fetchError) throw fetchError;

      const upsertData = {
        id: existing?.id || generateUUID(),
        userId: user.id,
        month,
        year,
        used: 0,
        createdAt: existing ? undefined : new Date().toISOString(),
      };

      const { error: resetError } = await supabase
        .from('QueryUsage')
        .upsert(upsertData);

      if (resetError) throw resetError;

      return reply.send({
        success: true,
        data: {
          walletAddress,
          blockchainId,
          queriesUsed: 0,
          message: 'Query usage reset successfully',
        },
      });

    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to reset usage',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
