import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { newId } from '../../lib/crypto.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { audit } from '../../services/audit.js';
import type { Topic } from '../../types.js';

const topicSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  keywords: z.array(z.string()).min(1),
  excludeKeywords: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default(['gdelt', 'rss', 'web']),
  languages: z.array(z.string()).default(['en', 'id']),
  regions: z.array(z.string()).default([]),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  collectionFrequencyMinutes: z.number().int().min(5).max(1440).default(60),
});

export const registerTopicRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('topics') as Topic[]).filter((t) => t.tenantId === req.tenant!.id);
    return ok(reply, list);
  });

  app.get('/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    return ok(reply, t);
  });

  app.post('/', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid topic', { issues: parsed.error.issues });
    const id = newId('topic');
    const now = new Date().toISOString();
    const topic: Topic = {
      id, tenantId: req.tenant!.id, createdBy: req.user!.id,
      ...(parsed.data as any),
      createdAt: now, updatedAt: now,
    };
    store.put('topics', id, topic);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'topic.create', entityType: 'topic', entityId: id, after: topic });
    return ok(reply, topic);
  });

  app.patch('/:id', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get('topics', id) as Topic | undefined;
    if (!existing || existing.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const parsed = topicSchema.partial().safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid update', { issues: parsed.error.issues });
    const updated: Topic = { ...existing, ...(parsed.data as any), updatedAt: new Date().toISOString() };
    store.put('topics', id, updated);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'topic.update', entityType: 'topic', entityId: id, before: existing, after: updated });
    return ok(reply, updated);
  });

  app.delete('/:id', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get('topics', id) as Topic | undefined;
    if (!existing || existing.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    store.delete('topics', id);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'topic.delete', entityType: 'topic', entityId: id, before: existing });
    return ok(reply, { deleted: id });
  });
};
