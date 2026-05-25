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
import type { Connector, Platform, Topic, TopicMonitoringBrief } from '../../types.js';

const requiredTitle = z.string().trim().min(2);
const requiredDescription = z.string().trim().min(1);
const stringList = z.array(z.string().trim().min(1)).default([]);
const subjectTypeSchema = z.enum(['public_figure', 'organization', 'issue', 'group', 'brand', 'event', 'normal_user', 'general']);
const objectiveSchema = z.enum(['reputation', 'early_warning', 'sentiment', 'misinformation', 'campaign', 'competitor', 'complaints']);
const perspectiveRoleSchema = z.enum(['topic_owner', 'government', 'opposition', 'public', 'competitor', 'media', 'neutral_observer', 'custom']);
const geoModeSchema = z.enum(['mentioned', 'author', 'both']);
const relevanceModeSchema = z.enum(['broad', 'balanced', 'strict']);
const costModeSchema = z.enum(['free_only', 'balanced', 'manual_paid']);

const monitoringBriefSchema = z.object({
  setupMode: z.enum(['simple', 'advanced']).optional(),
  subjectType: subjectTypeSchema.default('general'),
  objectives: z.array(objectiveSchema).default(['reputation']),
  perspective: z.object({
    role: perspectiveRoleSchema.default('neutral_observer'),
    name: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    favorableSignals: stringList,
    unfavorableSignals: stringList,
  }).default({ role: 'neutral_observer', favorableSignals: [], unfavorableSignals: [] }),
  query: z.object({
    includeKeywords: stringList,
    exactPhrases: stringList,
    hashtags: stringList,
    handles: stringList,
    relatedEntities: stringList,
    excludeKeywords: stringList,
    excludeHashtags: stringList,
    excludeHandles: stringList,
    excludeDomains: stringList,
  }).default({
    includeKeywords: [], exactPhrases: [], hashtags: [], handles: [], relatedEntities: [],
    excludeKeywords: [], excludeHashtags: [], excludeHandles: [], excludeDomains: [],
  }),
  sources: z.object({
    platforms: z.array(z.string()).default(['gdelt', 'rss', 'web']),
    languages: z.array(z.string()).default(['en', 'id']),
    countries: stringList,
    provinces: stringList,
    cities: stringList,
    geoMode: geoModeSchema.default('mentioned'),
  }).default({ platforms: ['gdelt', 'rss', 'web'], languages: ['en', 'id'], countries: [], provinces: [], cities: [], geoMode: 'mentioned' }),
  audience: z.object({
    types: stringList,
    minimumFollowers: z.number().int().min(0).optional().nullable(),
    verifiedOnly: z.boolean().default(false),
    includeLowFollowerAccounts: z.boolean().default(true),
  }).default({ types: [], minimumFollowers: null, verifiedOnly: false, includeLowFollowerAccounts: true }),
  relevance: z.object({
    mode: relevanceModeSchema.default('balanced'),
    aiReviewEnabled: z.boolean().default(true),
  }).default({ mode: 'balanced', aiReviewEnabled: true }),
  collection: z.object({
    lookbackDays: z.number().int().min(1).max(90).default(30),
    refreshMinutes: z.number().int().min(5).max(1440).default(60),
    maxItemsPerConnector: z.number().int().min(1).max(250).default(50),
    costMode: costModeSchema.default('balanced'),
  }).default({ lookbackDays: 30, refreshMinutes: 60, maxItemsPerConnector: 50, costMode: 'balanced' }),
  alerts: z.object({ triggers: stringList }).default({ triggers: [] }),
});

const topicSchema = z.object({
  title: requiredTitle,
  description: requiredDescription,
  category: z.string().optional().nullable(),
  keywords: z.array(z.string()).min(1),
  excludeKeywords: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default(['gdelt', 'rss', 'web']),
  languages: z.array(z.string()).default(['en', 'id']),
  regions: z.array(z.string()).default([]),
  monitoringBrief: monitoringBriefSchema.optional().nullable(),
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

const topicUpdateSchema = topicSchema.partial();

type TopicInput = z.infer<typeof topicSchema>;
type TopicUpdateInput = z.infer<typeof topicUpdateSchema>;

const platformAliases: Record<string, Platform> = {
  'x / twitter': 'x',
  twitter: 'x',
  x: 'x',
  threads: 'threads',
  tiktok: 'tiktok',
  instagram: 'instagram',
  youtube: 'youtube',
  facebook: 'facebook',
  reddit: 'reddit',
  'news / web': 'web',
  news: 'news',
  web: 'web',
  rss: 'rss',
  gdelt: 'gdelt',
};

const cleanList = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

const normalizePlatform = (value: string): Platform => {
  const key = String(value).trim().toLowerCase();
  return platformAliases[key] ?? key as Platform;
};

const normalizeMonitoringBrief = (brief: z.infer<typeof monitoringBriefSchema>): TopicMonitoringBrief => ({
  setupMode: brief.setupMode,
  subjectType: brief.subjectType,
  objectives: [...new Set(brief.objectives)],
  perspective: {
    role: brief.perspective.role,
    name: brief.perspective.name?.trim() || null,
    description: brief.perspective.description?.trim() || null,
    favorableSignals: cleanList(brief.perspective.favorableSignals),
    unfavorableSignals: cleanList(brief.perspective.unfavorableSignals),
  },
  query: {
    includeKeywords: cleanList(brief.query.includeKeywords),
    exactPhrases: cleanList(brief.query.exactPhrases),
    hashtags: cleanList(brief.query.hashtags),
    handles: cleanList(brief.query.handles),
    relatedEntities: cleanList(brief.query.relatedEntities),
    excludeKeywords: cleanList(brief.query.excludeKeywords),
    excludeHashtags: cleanList(brief.query.excludeHashtags),
    excludeHandles: cleanList(brief.query.excludeHandles),
    excludeDomains: cleanList(brief.query.excludeDomains),
  },
  sources: {
    platforms: cleanList(brief.sources.platforms).map(normalizePlatform),
    languages: cleanList(brief.sources.languages),
    countries: cleanList(brief.sources.countries),
    provinces: cleanList(brief.sources.provinces),
    cities: cleanList(brief.sources.cities),
    geoMode: brief.sources.geoMode,
  },
  audience: {
    types: cleanList(brief.audience.types),
    minimumFollowers: brief.audience.minimumFollowers ?? null,
    verifiedOnly: brief.audience.verifiedOnly,
    includeLowFollowerAccounts: brief.audience.includeLowFollowerAccounts,
  },
  relevance: {
    mode: brief.relevance.mode,
    aiReviewEnabled: brief.relevance.aiReviewEnabled,
  },
  collection: {
    lookbackDays: brief.collection.lookbackDays,
    refreshMinutes: brief.collection.refreshMinutes,
    maxItemsPerConnector: brief.collection.maxItemsPerConnector,
    costMode: brief.collection.costMode,
  },
  alerts: { triggers: cleanList(brief.alerts.triggers) },
});

const normalizeTopicPayload = (data: TopicInput | TopicUpdateInput, existing?: Topic): Partial<Topic> => {
  const monitoringBrief = data.monitoringBrief === null
    ? null
    : data.monitoringBrief
      ? normalizeMonitoringBrief(data.monitoringBrief)
      : existing?.monitoringBrief ?? null;
  const query = monitoringBrief?.query;
  const sources = monitoringBrief?.sources;
  const title = data.title ?? existing?.title ?? '';
  const keywords = cleanList([
    ...(data.keywords ?? existing?.keywords ?? []),
    ...(query?.includeKeywords ?? []),
    ...(query?.exactPhrases ?? []),
    ...(query?.hashtags ?? []),
    ...(query?.handles ?? []),
    ...(query?.relatedEntities ?? []),
  ]);
  const excludeKeywords = cleanList([
    ...(data.excludeKeywords ?? existing?.excludeKeywords ?? []),
    ...(query?.excludeKeywords ?? []),
    ...(query?.excludeHashtags ?? []),
    ...(query?.excludeHandles ?? []),
    ...(query?.excludeDomains ?? []),
  ]);
  const platforms = cleanList([
    ...(data.platforms ?? existing?.platforms ?? []),
    ...(sources?.platforms ?? []),
  ]).map(normalizePlatform);
  const languages = cleanList([
    ...(data.languages ?? existing?.languages ?? []),
    ...(sources?.languages ?? []),
  ]);
  const regions = cleanList([
    ...(data.regions ?? existing?.regions ?? []),
    ...(sources?.countries ?? []),
    ...(sources?.provinces ?? []),
    ...(sources?.cities ?? []),
  ]);

  return {
    ...data,
    category: data.category ?? monitoringBrief?.subjectType ?? existing?.category ?? null,
    keywords: keywords.length ? keywords : cleanList([title]),
    excludeKeywords,
    platforms: platforms.length ? platforms : existing?.platforms ?? ['gdelt', 'rss', 'web'],
    languages: languages.length ? languages : existing?.languages ?? ['en', 'id'],
    regions,
    monitoringBrief,
    collectionFrequencyMinutes: monitoringBrief?.collection.refreshMinutes ?? data.collectionFrequencyMinutes ?? existing?.collectionFrequencyMinutes ?? 60,
  };
};

const topicIntelligenceSettings = (topic: Pick<Topic, 'monitoringBrief'>, existing?: Topic['intelligenceSettings'], defaults?: { historyDays?: number; maxItemsPerConnector?: number; ingestTrendingNews?: boolean }) => ({
  ...existing,
  lookbackDays: topic.monitoringBrief?.collection.lookbackDays ?? existing?.lookbackDays ?? defaults?.historyDays ?? 30,
  maxItemsPerConnector: topic.monitoringBrief?.collection.maxItemsPerConnector ?? existing?.maxItemsPerConnector ?? defaults?.maxItemsPerConnector ?? 50,
  dailyAnalysisEnabled: existing?.dailyAnalysisEnabled ?? true,
  dailyAnalysisTime: existing?.dailyAnalysisTime,
  timezone: existing?.timezone,
  trendingNewsEnabled: defaults?.ingestTrendingNews ?? existing?.trendingNewsEnabled ?? false,
  lastCycleRunAt: existing?.lastCycleRunAt ?? null,
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
    const normalizedTopicData = normalizeTopicPayload(topicData) as Omit<Topic, 'id' | 'tenantId' | 'createdBy' | 'createdAt' | 'updatedAt'>;
    const topic: Topic = {
      id, tenantId: req.tenant!.id, createdBy: req.user!.id,
      ...normalizedTopicData,
      intelligenceSettings: topicIntelligenceSettings(normalizedTopicData, undefined, {
        historyDays,
        maxItemsPerConnector: trendingNewsMaxItems,
        ingestTrendingNews,
      }),
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
    const parsed = topicUpdateSchema.safeParse(req.body);
    if (!parsed.success) return errorResponse(reply, 400, 'INVALID_INPUT', 'Invalid update', { issues: parsed.error.issues });
    const normalizedTopicData = normalizeTopicPayload(parsed.data, existing);
    const updated: Topic = {
      ...existing,
      ...normalizedTopicData,
      intelligenceSettings: topicIntelligenceSettings({ monitoringBrief: normalizedTopicData.monitoringBrief ?? existing.monitoringBrief }, existing.intelligenceSettings),
      updatedAt: new Date().toISOString(),
    };
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
