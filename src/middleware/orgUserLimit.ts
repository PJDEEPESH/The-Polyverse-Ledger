// src/middleware/orgUserLimit.ts
import { supabase } from '../lib/supabaseClient.js';

export async function orgUserLimitHook(request: any, reply: any) {
  try {
    const { orgId } = request.body || {};
    if (!orgId) return; // Skip if no organization

    // Get organization's plan
    const { data: org, error: orgError } = await supabase
      .from('Organization')
      .select('planId, Plan(userLimit)')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return reply.status(404).send({ error: 'Organization not found' });
    }

    // Count current users in organization
    const { count, error: countError } = await supabase
      .from('User')
      .select('*', { count: 'exact', head: true })
      .eq('orgId', orgId);

    if (countError) throw countError;

    const currentUsers = count || 0;
    const userLimit = org.Plan?.[0]?.userLimit || 1;

    if (currentUsers >= userLimit) {
      return reply.status(403).send({
        error: `Organization has reached user limit (${userLimit} users)`,
        code: 'USER_LIMIT_EXCEEDED'
      });
    }

    request.orgContext = { currentUsers, userLimit, org };
  } catch (error) {
    return reply.status(500).send({ error: 'Failed to check organization limits' });
  }
}
