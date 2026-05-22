import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { store } from '../../db/store.js';
import { newId } from '../../lib/crypto.js';
import { requireAuth } from '../../middleware/auth.js';
import { errorResponse, ok } from '../../lib/api.js';
import { audit } from '../../services/audit.js';
import { enqueueIngestion } from '../../services/ingestion.js';
import { searchIndonesianNews, INDONESIAN_NEWS_SOURCES } from '../../services/indonesianNews.js';
import { runIntelligenceCycle } from '../../services/intelligenceCycle.js';
import type { Connector, Topic } from '../../types.js';

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

const topicCreateSchema = topicSchema.extend({
  historyDays: z.number().int().min(1).max(90).default(30),
  ingestTrendingNews: z.boolean().default(true),
  trendingNewsQuery: z.string().optional(),
  trendingNewsMaxItems: z.number().int().min(1).max(50).default(24),
  trendingNewsSources: z.array(z.string()).default([...INDONESIAN_NEWS_SOURCES]),
});

const cycleSchema = z.object({
  days: z.number().int().min(1).max(90).default(30),
  maxItemsPerConnector: z.number().int().min(1).max(250).default(50),
  includeTrendingNews: z.boolean().default(true),
});

export const registerTopicRoutes = (app: FastifyInstance) => {
  app.get('/', { preHandler: requireAuth() }, async (req, reply) => {
    const list = (store.list('topics') as Topic[]).filter((t) => t.tenantId === req.tenant!.id);
    return ok(reply, list);
  });

  app.get('/trending-news', { preHandler: requireAuth() }, async (req, reply) => {
    const query = String((req.query as any)?.query ?? '').trim();
    const maxResults = Math.min(30, Math.max(1, Number((req.query as any)?.maxResults ?? 10)));
    if (!query) return ok(reply, { query, results: [], sources: INDONESIAN_NEWS_SOURCES, errors: [] });
    const result = await searchIndonesianNews({ query, maxResults, freshnessDays: 30 });
    return ok(reply, result);
  });

  app.get('/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = store.get('topics', id) as Topic | undefined;
    if (!t || t.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    return ok(reply, t);
  });

  app.post('/', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const parsed = topicCreateSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid topic', { issues: parsed.error.issues });
    const {
      historyDays, ingestTrendingNews, trendingNewsQuery, trendingNewsMaxItems, trendingNewsSources,
      ...topicData
    } = parsed.data;
    const id = newId('topic');
    const now = new Date().toISOString();
    const topic: Topic = {
      id, tenantId: req.tenant!.id, createdBy: req.user!.id,
      ...(topicData as any),
      intelligenceSettings: {
        lookbackDays: historyDays,
        maxItemsPerConnector: trendingNewsMaxItems,
        dailyAnalysisEnabled: true,
        trendingNewsEnabled: ingestTrendingNews,
      },
      createdAt: now, updatedAt: now,
    };
    store.put('topics', id, topic);
    audit({ tenantId: req.tenant!.id, actorUserId: req.user!.id, action: 'topic.create', entityType: 'topic', entityId: id, after: topic });
    if (ingestTrendingNews) {
      const webConnector = (store.list('connectors') as Connector[])
        .find((connector) => connector.tenantId === req.tenant!.id && connector.platform === 'web' && connector.enabled && connector.status !== 'disabled' && connector.status !== 'budget_exceeded');
      if (webConnector) {
        await enqueueIngestion({
          tenantId: req.tenant!.id,
          topicId: topic.id,
          connectorId: webConnector.id,
          jobType: 'manual',
          requestedBy: req.user!.id,
          maxItems: trendingNewsMaxItems,
          days: historyDays,
          metadata: {
            trendingNews: true,
            trendingNewsQuery: trendingNewsQuery?.trim() || topic.keywords.slice(0, 5).join(' '),
            newsSourceDomains: trendingNewsSources,
          },
        });
      }
    }
    return ok(reply, topic);
  });

  app.post('/:id/intelligence-cycle', { preHandler: requireAuth(['admin', 'analyst']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = store.get('topics', id) as Topic | undefined;
    if (!existing || existing.tenantId !== req.tenant!.id) return errorResponse(reply, 404, 'NOT_FOUND', 'Topic not found');
    const parsed = cycleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid cycle request', { issues: parsed.error.issues });
    const result = await runIntelligenceCycle({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      topicId: existing.id,
      days: parsed.data.days,
      maxItemsPerConnector: parsed.data.maxItemsPerConnector,
      includeTrendingNews: parsed.data.includeTrendingNews,
    });
    return ok(reply, result);
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
