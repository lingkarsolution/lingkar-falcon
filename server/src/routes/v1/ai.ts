import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { generateDailyBrief } from '../../services/insights.js';
import { clusterTopic } from '../../services/clustering.js';
import { detectRiskEvents } from '../../services/risk.js';
import type { Topic, Insight, IssueCluster, RiskEvent } from '../../types.js';

const topicIdSchema = z.object({ topicId: z.string() });

export const registerAIRoutes = (app: FastifyInstance) => {
  app.post('/daily-brief', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicIdSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'topicId required');
    const t = store.get('topics', parsed.data.topicId) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const insight = await generateDailyBrief(req.tenant!.id, t.id);
    return ok(reply, insight);
  });

  app.get('/topics/:id/insights', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const list = (store.list('insights') as Insight[])
      .filter((i) => i.tenantId === req.tenant!.id && i.topicId === id)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    return ok(reply, list);
  });

  app.post('/cluster', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicIdSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'topicId required');
    const clusters = clusterTopic(req.tenant!.id, parsed.data.topicId);
    return ok(reply, clusters);
  });

  app.get('/topics/:id/clusters', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const list = (store.list('issueClusters') as IssueCluster[]).filter((c) => c.tenantId === req.tenant!.id && c.topicId === id);
    return ok(reply, list);
  });

  app.post('/detect-risk', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicIdSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'topicId required');
    clusterTopic(req.tenant!.id, parsed.data.topicId);
    const events = detectRiskEvents(req.tenant!.id, parsed.data.topicId);
    return ok(reply, events);
  });

  app.get('/topics/:id/risk-events', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const list = (store.list('riskEvents') as RiskEvent[]).filter((r) => r.tenantId === req.tenant!.id && r.topicId === id);
    return ok(reply, list);
  });
};
