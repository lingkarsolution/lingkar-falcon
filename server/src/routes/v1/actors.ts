import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { newId } from '../../lib/crypto.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { audit } from '../../services/audit.js';
import { refreshActorScores } from '../../services/actors.js';
import type { Actor, Platform } from '../../types.js';

const actorSchema = z.object({
  platform: z.string(),
  username: z.string().min(1),
  displayName: z.string().optional(),
  profileUrl: z.string().nullable().optional(),
  monitoringReason: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const registerActorRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) =>
    ok(reply, (store.list('actors') as Actor[]).filter((a) => a.tenantId === req.tenant!.id)));

  app.post('/', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = actorSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid actor', { issues: parsed.error.issues });
    const id = newId('actor');
    const now = new Date().toISOString();
    let actor: Actor = {
      id, tenantId: req.tenant!.id,
      platform: parsed.data.platform as Platform,
      username: parsed.data.username,
      displayName: parsed.data.displayName ?? parsed.data.username,
      profileUrl: parsed.data.profileUrl ?? null,
      monitoringReason: parsed.data.monitoringReason ?? null,
      tags: parsed.data.tags, status: 'active',
      riskScore: null, riskLevel: null, riskExplanation: null,
      opportunityScore: null, opportunityLevel: null, opportunityExplanation: null,
      lastRefreshedAt: null, createdAt: now, updatedAt: now,
    };
    store.put('actors', id, actor);
    actor = refreshActorScores(actor);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'actor.create', entityType: 'actor', entityId: id, after: actor });
    return ok(reply, actor);
  });

  app.post('/:id/refresh', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = store.get('actors', id) as Actor | undefined;
    if (!a || a.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Actor not found');
    return ok(reply, refreshActorScores(a));
  });

  app.delete('/:id', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = store.get('actors', id) as Actor | undefined;
    if (!a || a.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Actor not found');
    store.delete('actors', id);
    return ok(reply, { deleted: id });
  });
};
