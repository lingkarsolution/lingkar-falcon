import type { FastifyInstance } from 'fastify';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { listMentionsForTopic, sentimentTimeseries, sentimentDistribution, platformDistribution, topEntities } from '../../services/analytics.js';
import type { Topic } from '../../types.js';

export const registerAnalyticsRoutes = (app: FastifyInstance) => {
  app.get('/topics/:id/timeseries', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const q = req.query as Record<string, string | undefined>;
    const bucket = (q.bucket === 'hour' ? 'hour' : 'day') as 'day' | 'hour';
    const days = Math.min(90, Math.max(1, Number(q.days ?? 7)));
    const from = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    return ok(reply, sentimentTimeseries(listMentionsForTopic(t.tenantId, t.id, { from }), bucket));
  });

  app.get('/topics/:id/platforms', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    return ok(reply, platformDistribution(listMentionsForTopic(t.tenantId, t.id)));
  });

  app.get('/topics/:id/sentiment', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    return ok(reply, sentimentDistribution(listMentionsForTopic(t.tenantId, t.id)));
  });

  app.get('/topics/:id/entities', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const limit = Math.min(50, Number((req.query as any)?.limit ?? 10));
    return ok(reply, topEntities(listMentionsForTopic(t.tenantId, t.id), limit));
  });
};
