// Commander tool registry — each tool has zod schema, definition, executor.
import { z } from 'zod';
import { store } from '../db/store.js';
import { listMentionsForTopic, sentimentTimeseries, sentimentDistribution, platformDistribution, topEntities, dashboardSummary } from '../services/analytics.js';
import { webFetch, webSearch, searchProvidersStatus } from '../connectors/search/router.js';
import { searchGdeltArticles, searchGdeltArticlesFallback } from '../connectors/gdelt.js';
import { enqueueIngestion } from '../services/ingestion.js';
import { generateTopicReport } from '../services/reports.js';
import { clusterTopic } from '../services/clustering.js';
import { detectRiskEvents } from '../services/risk.js';
import { generateDailyBrief } from '../services/insights.js';
import { analyzeMentionsSentimentBulk } from '../services/sentiment.js';
import { runIntelligenceCycle } from '../services/intelligenceCycle.js';
import { evaluateAlerts } from '../services/alerts.js';
import { refreshActorScores } from '../services/actors.js';
import { newId } from '../lib/crypto.js';
import { audit } from '../services/audit.js';
import type { Mention, Topic, Connector, RiskEvent, AlertRule, Actor } from '../types.js';

export type ToolContext = {
  tenantId: string; userId: string; userRole: 'admin' | 'analyst' | 'viewer';
};

export type ToolHandler<I> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  parameters: Record<string, unknown>;
  requiresRole?: 'admin' | 'analyst';
  execute: (input: I, ctx: ToolContext) => Promise<unknown>;
};

const findTopic = (tenantId: string, idOrTitle: string): Topic | undefined => {
  if (!idOrTitle) return undefined;
  const direct = store.get('topics', idOrTitle);
  if (direct && (direct as Topic).tenantId === tenantId) return direct as Topic;
  return (store.list('topics') as Topic[]).find((t) =>
    t.tenantId === tenantId && t.title.toLowerCase() === idOrTitle.toLowerCase());
};

// 1. search_mentions
const searchMentions: ToolHandler<{ topicId?: string; query?: string; limit?: number; platform?: string; sentiment?: string }> = {
  name: 'search_mentions',
  description: 'Search mentions in the CivicFalcon database by topic, text query, platform, or sentiment.',
  inputSchema: z.object({
    topicId: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    platform: z.string().optional(),
    sentiment: z.string().optional(),
  }),
  parameters: {
    type: 'object',
    properties: {
      topicId: { type: 'string', description: 'Optional topic ID or title to scope to' },
      query: { type: 'string', description: 'Text substring to match in mentions' },
      limit: { type: 'integer', default: 20 },
      platform: { type: 'string', description: 'Filter by platform (e.g. news, reddit, x)' },
      sentiment: { type: 'string', description: 'positive|negative|neutral|mixed' },
    },
  },
  execute: async (input, ctx) => {
    let list = (store.list('mentions') as Mention[]).filter((m) => m.tenantId === ctx.tenantId);
    if (input.topicId) {
      const topic = findTopic(ctx.tenantId, input.topicId);
      if (topic) list = list.filter((m) => m.topicId === topic.id);
    }
    if (input.platform) list = list.filter((m) => m.platform === input.platform);
    if (input.sentiment) list = list.filter((m) => m.nlp.sentiment === input.sentiment);
    if (input.query) {
      const q = input.query.toLowerCase();
      list = list.filter((m) => m.text.toLowerCase().includes(q));
    }
    list = list.sort((a, b) =>
      new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime(),
    );
    return {
      count: list.length,
      items: list.slice(0, input.limit ?? 20).map((m) => ({
        id: m.id, platform: m.platform, sentiment: m.nlp.sentiment, publishedAt: m.publishedAt,
        author: m.author?.displayName ?? m.author?.username,
        text: m.text.slice(0, 280), url: m.sourceUrl,
      })),
    };
  },
};

// 2. search_web
type SearchProviderName = 'auto' | 'searxng' | 'ddg_html' | 'ddg_ia' | 'brave' | 'tavily';

const searchProviderSchema = z.enum(['auto', 'searxng', 'ddg_html', 'ddg_ia', 'brave', 'tavily']).default('auto');

const searchWeb: ToolHandler<{ query: string; maxResults?: number; freshnessDays?: number; provider?: SearchProviderName }> = {
  name: 'search_web',
  description: 'Live web search via self-hosted SearXNG first, then DuckDuckGo HTML/Instant Answer as the last automatic fallback. Brave/Tavily are only used when provider is explicitly set. Pass provider="searxng" to force SEARXNG_BASE_URL. Follow with web_fetch when a page needs to be read.',
  inputSchema: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).default(10),
    freshnessDays: z.number().int().min(1).max(365).optional(),
    provider: searchProviderSchema.optional(),
  }),
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' }, maxResults: { type: 'integer', default: 10 },
      freshnessDays: { type: 'integer' },
      provider: { type: 'string', enum: ['auto', 'searxng', 'ddg_html', 'ddg_ia', 'brave', 'tavily'], default: 'auto' },
    },
  },
  execute: async (input) => webSearch(input.query, { maxResults: input.maxResults, freshnessDays: input.freshnessDays, provider: input.provider }),
};

const webSearchAlias: ToolHandler<{ query: string; max_results?: number; freshnessDays?: number; provider?: SearchProviderName }> = {
  name: 'web_search',
  description: 'Search the public web and return ranked {title, url, snippet} results. Auto mode uses configured self-hosted SearXNG first and DuckDuckGo only as the final fallback; pass provider="searxng" to force SEARXNG_BASE_URL. Follow up with web_fetch for the most relevant URL.',
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(15).default(5),
    freshnessDays: z.number().int().min(1).max(365).optional(),
    provider: searchProviderSchema.optional(),
  }),
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      max_results: { type: 'integer', default: 5 },
      freshnessDays: { type: 'integer' },
      provider: { type: 'string', enum: ['auto', 'searxng', 'ddg_html', 'ddg_ia', 'brave', 'tavily'], default: 'auto' },
    },
  },
  execute: async (input) => webSearch(input.query, { maxResults: input.max_results, freshnessDays: input.freshnessDays, provider: input.provider }),
};

const fetchWebPage: ToolHandler<{ url: string; max_chars?: number }> = {
  name: 'web_fetch',
  description: 'Fetch an http(s) URL with browser-like headers and return page text with HTML/scripts/styles removed. Use after web_search/search_web to inspect a specific result page.',
  inputSchema: z.object({
    url: z.string().url(),
    max_chars: z.number().int().min(500).max(40000).default(8000),
  }),
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
      max_chars: { type: 'integer', default: 8000 },
    },
  },
  execute: async (input) => webFetch(input.url, input.max_chars),
};

// 3. search_news (alias for web with news intent)
const searchNews: ToolHandler<{ query: string; maxResults?: number }> = {
  name: 'search_news',
  description: 'Search recent news articles via the web search waterfall biased toward news domains.',
  inputSchema: z.object({ query: z.string().min(1), maxResults: z.number().int().min(1).max(20).default(10) }),
  parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, maxResults: { type: 'integer', default: 10 } } },
  execute: async (input) => webSearch(`${input.query} news`, { maxResults: input.maxResults, freshnessDays: 30, category: 'news' }),
};

const searchGdeltNews: ToolHandler<{ query: string; maxResults?: number; days?: number; dateFrom?: string; dateTo?: string }> = {
  name: 'search_gdelt_news',
  description: 'Search GDELT DOC 2.0 global news full-text index. Free/no-key OSINT source across translated global coverage; ingestion falls back to SearXNG-first web news search if GDELT is slow or unavailable.',
  inputSchema: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(250).default(50),
    days: z.number().int().min(1).max(90).default(30),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'GDELT query; supports phrases, OR blocks, domain:, sourcelang:, sourcecountry:, theme:, tone filters' },
      maxResults: { type: 'integer', default: 50 },
      days: { type: 'integer', default: 30, description: 'Lookback window in calendar days, max 90' },
      dateFrom: { type: 'string', description: 'Optional ISO start datetime; GDELT only supports recent rolling history' },
      dateTo: { type: 'string', description: 'Optional ISO end datetime' },
    },
  },
  execute: async (input) => {
    try {
      const result = await searchGdeltArticles({
        query: input.query,
        maxRecords: input.maxResults,
        timespanDays: input.days,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        sort: 'datedesc',
      });
      if (result.count > 0) return result;
      const fallback = await searchGdeltArticlesFallback({ query: input.query, maxRecords: input.maxResults, timespanDays: input.days });
      return { ...fallback, fallback: true, primaryCount: 0 };
    } catch (error) {
      const fallback = await searchGdeltArticlesFallback({ query: input.query, maxRecords: input.maxResults, timespanDays: input.days });
      return { ...fallback, fallback: true, primaryError: (error as Error).message };
    }
  },
};

// 4. get_sentiment_timeseries
const sentimentSeries: ToolHandler<{ topicId: string; bucket?: 'hour' | 'day'; days?: number }> = {
  name: 'get_sentiment_timeseries',
  description: 'Return sentiment counts bucketed by hour or day for a topic over the last N days.',
  inputSchema: z.object({ topicId: z.string(), bucket: z.enum(['hour', 'day']).default('day'), days: z.number().int().min(1).max(90).default(7) }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' }, bucket: { type: 'string', enum: ['hour', 'day'] }, days: { type: 'integer' } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    const from = new Date(Date.now() - (input.days ?? 7) * 24 * 3600_000).toISOString();
    const mentions = listMentionsForTopic(ctx.tenantId, topic.id, { from });
    return { topic: topic.title, series: sentimentTimeseries(mentions, input.bucket ?? 'day') };
  },
};

// 5. get_platform_distribution
const platformDist: ToolHandler<{ topicId: string }> = {
  name: 'get_platform_distribution',
  description: 'Return mention count by platform for a topic.',
  inputSchema: z.object({ topicId: z.string() }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    const mentions = listMentionsForTopic(ctx.tenantId, topic.id);
    return { topic: topic.title, distribution: platformDistribution(mentions) };
  },
};

// 6. get_top_entities
const topEntitiesTool: ToolHandler<{ topicId: string; limit?: number }> = {
  name: 'get_top_entities',
  description: 'Return the most-mentioned entities (people, orgs, places) for a topic with sentiment breakdown.',
  inputSchema: z.object({ topicId: z.string(), limit: z.number().int().min(1).max(50).default(10) }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' }, limit: { type: 'integer', default: 10 } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    return { topic: topic.title, entities: topEntities(listMentionsForTopic(ctx.tenantId, topic.id), input.limit ?? 10) };
  },
};

// 7. summarize_topic
const summarizeTopic: ToolHandler<{ topicId: string }> = {
  name: 'summarize_topic',
  description: 'Generate (or fetch latest) AI daily brief for a topic. Returns title, summary, evidence mention IDs.',
  inputSchema: z.object({ topicId: z.string() }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    return await generateDailyBrief(ctx.tenantId, topic.id);
  },
};

// 8. cluster_narratives
const clusterTool: ToolHandler<{ topicId: string }> = {
  name: 'cluster_narratives',
  description: 'Cluster a topic\'s mentions into narrative groups (issue clusters).',
  inputSchema: z.object({ topicId: z.string() }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    return { clusters: clusterTopic(ctx.tenantId, topic.id) };
  },
};

// 9. detect_risk_events
const detectRisks: ToolHandler<{ topicId: string }> = {
  name: 'detect_risk_events',
  description: 'Re-run risk-event detection for a topic. Requires clusters; will cluster first if needed.',
  inputSchema: z.object({ topicId: z.string() }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    clusterTopic(ctx.tenantId, topic.id);
    return { events: detectRiskEvents(ctx.tenantId, topic.id) };
  },
};

// 10. list_topics
const listTopics: ToolHandler<{}> = {
  name: 'list_topics',
  description: 'List all topics for the current tenant.',
  inputSchema: z.object({}),
  parameters: { type: 'object', properties: {} },
  execute: async (_input, ctx) => ({
    topics: (store.list('topics') as Topic[])
      .filter((t) => t.tenantId === ctx.tenantId)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, keywords: t.keywords, platforms: t.platforms })),
  }),
};

// 11. list_connectors
const listConnectors: ToolHandler<{}> = {
  name: 'list_connectors',
  description: 'List all connectors with status, mode, budget.',
  inputSchema: z.object({}),
  parameters: { type: 'object', properties: {} },
  execute: async (_input, ctx) => ({
    connectors: (store.list('connectors') as Connector[])
      .filter((c) => c.tenantId === ctx.tenantId)
      .map((c) => ({ id: c.id, platform: c.platform, status: c.status, mode: c.mode, enabled: c.enabled, requests: c.currentMonthRequests, spendUsd: c.currentMonthSpendUsd })),
  }),
};

// 12. list_risk_events
const listRisks: ToolHandler<{ topicId?: string; severity?: string }> = {
  name: 'list_risk_events',
  description: 'List risk events, optionally filtered by topic or minimum severity.',
  inputSchema: z.object({ topicId: z.string().optional(), severity: z.string().optional() }),
  parameters: { type: 'object', properties: { topicId: { type: 'string' }, severity: { type: 'string' } } },
  execute: async (input, ctx) => {
    let list = (store.list('riskEvents') as RiskEvent[]).filter((r) => r.tenantId === ctx.tenantId);
    if (input.topicId) {
      const t = findTopic(ctx.tenantId, input.topicId);
      if (t) list = list.filter((r) => r.topicId === t.id);
    }
    if (input.severity) list = list.filter((r) => r.severity === input.severity);
    return { count: list.length, events: list };
  },
};

// 13. trigger_ingestion
const triggerIngestion: ToolHandler<{ topicId: string; platform: string; maxItems?: number; days?: number; dateFrom?: string; dateTo?: string }> = {
  name: 'trigger_ingestion',
  description: 'Start a manual ingestion job for a topic via a specific connector platform. Supports historical lookback for connectors like GDELT; days defaults to 30 and is capped to 90.',
  inputSchema: z.object({
    topicId: z.string(),
    platform: z.string(),
    maxItems: z.number().int().min(1).max(250).default(50),
    days: z.number().int().min(1).max(90).default(30),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  parameters: {
    type: 'object', required: ['topicId', 'platform'],
    properties: {
      topicId: { type: 'string' }, platform: { type: 'string' }, maxItems: { type: 'integer', default: 50 },
      days: { type: 'integer', default: 30, description: 'Historical lookback in calendar days, max 90' },
      dateFrom: { type: 'string', description: 'Optional ISO start datetime' },
      dateTo: { type: 'string', description: 'Optional ISO end datetime' },
    },
  },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    const connector = (store.list('connectors') as Connector[])
      .find((c) => c.tenantId === ctx.tenantId && c.platform === input.platform);
    if (!connector) return { error: 'connector_not_found', message: `No connector for platform ${input.platform}` };
    const job = await enqueueIngestion({
      tenantId: ctx.tenantId, topicId: topic.id, connectorId: connector.id,
      jobType: 'manual', requestedBy: ctx.userId, maxItems: input.maxItems ?? 50,
      days: input.days ?? 30, dateFrom: input.dateFrom, dateTo: input.dateTo,
    });
    audit({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'ingestion.trigger', entityType: 'ingestion_job', entityId: job.id, after: { topicId: topic.id, platform: input.platform, days: input.days ?? 30 } });
    return { jobId: job.id, status: job.status };
  },
};

// 14. create_topic
const createTopic: ToolHandler<{ title: string; keywords: string[]; platforms?: string[]; description?: string }> = {
  name: 'create_topic',
  description: 'Create a new monitoring topic.',
  inputSchema: z.object({
    title: z.string().min(2), keywords: z.array(z.string()).min(1),
    platforms: z.array(z.string()).default(['gdelt', 'rss', 'web']),
    description: z.string().optional(),
  }),
  parameters: {
    type: 'object', required: ['title', 'keywords'],
    properties: {
      title: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } },
      platforms: { type: 'array', items: { type: 'string' } }, description: { type: 'string' },
    },
  },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const id = newId('topic');
    const t = new Date().toISOString();
    const topic: Topic = {
      id, tenantId: ctx.tenantId, title: input.title,
      description: input.description ?? null, category: null,
      keywords: input.keywords, excludeKeywords: [],
      platforms: (input.platforms ?? ['gdelt', 'rss', 'web']) as any,
      languages: ['en', 'id'], regions: [],
      status: 'active', collectionFrequencyMinutes: 60,
      createdBy: ctx.userId, createdAt: t, updatedAt: t,
    };
    store.put('topics', id, topic);
    audit({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'topic.create', entityType: 'topic', entityId: id, after: topic });
    return { topic };
  },
};

// 15. create_alert_rule
const createAlertRule: ToolHandler<{ name: string; type: string; topicId?: string; config: Record<string, unknown>; severity?: string }> = {
  name: 'create_alert_rule',
  description: 'Create an alert rule (volume_spike, negative_sentiment_spike, risk_event, keyword).',
  inputSchema: z.object({
    name: z.string().min(2), type: z.enum(['volume_spike', 'negative_sentiment_spike', 'risk_event', 'keyword', 'actor_mention']),
    topicId: z.string().optional(), config: z.record(z.unknown()),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),
  parameters: {
    type: 'object', required: ['name', 'type', 'config'],
    properties: {
      name: { type: 'string' }, type: { type: 'string', enum: ['volume_spike', 'negative_sentiment_spike', 'risk_event', 'keyword', 'actor_mention'] },
      topicId: { type: 'string' }, config: { type: 'object' }, severity: { type: 'string' },
    },
  },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const id = newId('rule');
    const t = new Date().toISOString();
    const topicId = input.topicId ? findTopic(ctx.tenantId, input.topicId)?.id ?? null : null;
    const rule: AlertRule = {
      id, tenantId: ctx.tenantId, topicId,
      name: input.name, type: input.type as any, enabled: true,
      severity: (input.severity as any) ?? 'medium',
      config: input.config, channels: ['inapp'],
      createdBy: ctx.userId, createdAt: t, updatedAt: t,
    };
    store.put('alertRules', id, rule);
    audit({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'alert_rule.create', entityType: 'alert_rule', entityId: id, after: rule });
    return { rule };
  },
};

// 16. evaluate_alerts
const evalAlertsTool: ToolHandler<{ topicId?: string }> = {
  name: 'evaluate_alerts',
  description: 'Run all enabled alert rules and return triggered events.',
  inputSchema: z.object({ topicId: z.string().optional() }),
  parameters: { type: 'object', properties: { topicId: { type: 'string' } } },
  execute: async (input, ctx) => {
    const topicId = input.topicId ? findTopic(ctx.tenantId, input.topicId)?.id : undefined;
    return { events: evaluateAlerts(ctx.tenantId, topicId) };
  },
};

// 17. generate_report
const generateReportTool: ToolHandler<{ topicId: string; title?: string; dateFrom?: string; dateTo?: string }> = {
  name: 'generate_report',
  description: 'Generate an HTML report for a topic. Returns the report ID and download URL.',
  inputSchema: z.object({ topicId: z.string(), title: z.string().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional() }),
  parameters: {
    type: 'object', required: ['topicId'],
    properties: { topicId: { type: 'string' }, title: { type: 'string' }, dateFrom: { type: 'string' }, dateTo: { type: 'string' } },
  },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    const r = await generateTopicReport({
      tenantId: ctx.tenantId, topicId: topic.id, title: input.title,
      dateFrom: input.dateFrom, dateTo: input.dateTo, requestedBy: ctx.userId,
    });
    return { id: r.id, title: r.title, status: r.status, fileUrl: r.fileUrl };
  },
};

// 18. usage_status
const usageStatus: ToolHandler<{}> = {
  name: 'usage_status',
  description: 'Return current connector usage, web-search provider availability, and LLM config status.',
  inputSchema: z.object({}),
  parameters: { type: 'object', properties: {} },
  execute: async (_input, ctx) => ({
    connectors: (store.list('connectors') as Connector[])
      .filter((c) => c.tenantId === ctx.tenantId)
      .map((c) => ({ platform: c.platform, status: c.status, requests: c.currentMonthRequests, spendUsd: c.currentMonthSpendUsd })),
    webSearchProviders: searchProvidersStatus(),
  }),
};

// 19. explain_score — transparency tool
const explainScore: ToolHandler<{ entityType: 'risk_event' | 'actor'; id: string }> = {
  name: 'explain_score',
  description: 'Explain how a risk-event or actor risk/opportunity score was computed.',
  inputSchema: z.object({ entityType: z.enum(['risk_event', 'actor']), id: z.string() }),
  parameters: { type: 'object', required: ['entityType', 'id'], properties: { entityType: { type: 'string', enum: ['risk_event', 'actor'] }, id: { type: 'string' } } },
  execute: async (input, ctx) => {
    if (input.entityType === 'risk_event') {
      const r = store.get('riskEvents', input.id) as RiskEvent | undefined;
      if (!r || r.tenantId !== ctx.tenantId) return { error: 'not_found' };
      return {
        id: r.id, score: r.score, severity: r.severity,
        formula: 'S = 0.35*neg_share + 0.25*volume_norm + 0.20*velocity + 0.10*influence + 0.10*amplifier_diversity (rounded to 0-100)',
        metrics: r.metrics, evidenceCount: r.evidenceMentionIds.length,
      };
    }
    const a = store.get('actors', input.id) as Actor | undefined;
    if (!a || a.tenantId !== ctx.tenantId) return { error: 'not_found' };
    return {
      id: a.id, risk: { score: a.riskScore, level: a.riskLevel, explanation: a.riskExplanation },
      opportunity: { score: a.opportunityScore, level: a.opportunityLevel, explanation: a.opportunityExplanation },
      formula: 'risk = 0.5*neg + 0.3*automation + 0.2*reach_norm; opp = 0.6*pos + 0.4*reach_norm',
    };
  },
};

// 20. monitor_actor
const monitorActor: ToolHandler<{ platform: string; username: string; reason?: string }> = {
  name: 'monitor_actor',
  description: 'Add an actor (account) to the watchlist and compute initial risk/opportunity scores.',
  inputSchema: z.object({ platform: z.string(), username: z.string().min(1), reason: z.string().optional() }),
  parameters: { type: 'object', required: ['platform', 'username'], properties: { platform: { type: 'string' }, username: { type: 'string' }, reason: { type: 'string' } } },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const id = newId('actor');
    const t = new Date().toISOString();
    let actor: Actor = {
      id, tenantId: ctx.tenantId, platform: input.platform as any, username: input.username,
      displayName: input.username, profileUrl: null,
      monitoringReason: input.reason ?? null, tags: [], status: 'active',
      riskScore: null, riskLevel: null, riskExplanation: null,
      opportunityScore: null, opportunityLevel: null, opportunityExplanation: null,
      lastRefreshedAt: null, createdAt: t, updatedAt: t,
    };
    store.put('actors', id, actor);
    actor = refreshActorScores(actor);
    audit({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'actor.create', entityType: 'actor', entityId: id, after: actor });
    return { actor };
  },
};

// 21. find_amplifiers
const findAmplifiers: ToolHandler<{ topicId: string; limit?: number }> = {
  name: 'find_amplifiers',
  description: 'Identify top accounts amplifying a topic, sorted by total engagement contributed.',
  inputSchema: z.object({ topicId: z.string(), limit: z.number().int().min(1).max(50).default(10) }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' }, limit: { type: 'integer' } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    const mentions = listMentionsForTopic(ctx.tenantId, topic.id);
    const map = new Map<string, { count: number; engagement: number; platform: string; sentiment: Record<string, number> }>();
    for (const m of mentions) {
      const key = `${m.platform}:${m.author?.username ?? m.author?.displayName ?? 'unknown'}`;
      const cur = map.get(key) ?? { count: 0, engagement: 0, platform: m.platform, sentiment: { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 } };
      cur.count++;
      cur.engagement += m.metrics.engagementTotal ?? 0;
      cur.sentiment[m.nlp.sentiment]++;
      map.set(key, cur);
    }
    const amps = [...map.entries()].sort((a, b) => b[1].engagement - a[1].engagement).slice(0, input.limit ?? 10)
      .map(([key, v]) => ({ account: key, ...v }));
    return { amplifiers: amps };
  },
};

// 22. compare_entities
const compareEntities: ToolHandler<{ topicId: string; entities: string[] }> = {
  name: 'compare_entities',
  description: 'Compare mention volume and sentiment for two or more entities within a topic.',
  inputSchema: z.object({ topicId: z.string(), entities: z.array(z.string()).min(2).max(5) }),
  parameters: { type: 'object', required: ['topicId', 'entities'], properties: { topicId: { type: 'string' }, entities: { type: 'array', items: { type: 'string' } } } },
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    const mentions = listMentionsForTopic(ctx.tenantId, topic.id);
    const result = input.entities.map((e) => {
      const lower = e.toLowerCase();
      const matched = mentions.filter((m) => m.text.toLowerCase().includes(lower));
      return { entity: e, count: matched.length, sentiment: sentimentDistribution(matched) };
    });
    return { topic: topic.title, comparison: result };
  },
};

// 23. analyze_topic_sentiment
const analyzeTopicSentiment: ToolHandler<{ topicId: string; limit?: number }> = {
  name: 'analyze_topic_sentiment',
  description: 'Run bulk LLM sentiment analysis for saved mentions in a topic and persist the updated sentiment fields.',
  inputSchema: z.object({ topicId: z.string(), limit: z.number().int().min(1).max(250).default(100) }),
  parameters: { type: 'object', required: ['topicId'], properties: { topicId: { type: 'string' }, limit: { type: 'integer', default: 100 } } },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    return analyzeMentionsSentimentBulk({ tenantId: ctx.tenantId, topicId: topic.id, limit: input.limit ?? 100 });
  },
};

// 24. run_intelligence_cycle
const runCycleTool: ToolHandler<{ topicId: string; days?: number; maxItemsPerConnector?: number; includeTrendingNews?: boolean }> = {
  name: 'run_intelligence_cycle',
  description: 'Run the full OSINT intelligence cycle for a topic: ingestion, Indonesian trending-news web aggregation, bulk LLM sentiment, clustering, risk detection, and daily brief.',
  inputSchema: z.object({
    topicId: z.string(),
    days: z.number().int().min(1).max(90).default(30),
    maxItemsPerConnector: z.number().int().min(1).max(250).default(50),
    includeTrendingNews: z.boolean().default(true),
  }),
  parameters: {
    type: 'object', required: ['topicId'],
    properties: {
      topicId: { type: 'string' },
      days: { type: 'integer', default: 30 },
      maxItemsPerConnector: { type: 'integer', default: 50 },
      includeTrendingNews: { type: 'boolean', default: true },
    },
  },
  requiresRole: 'analyst',
  execute: async (input, ctx) => {
    const topic = findTopic(ctx.tenantId, input.topicId);
    if (!topic) return { error: 'topic_not_found' };
    return runIntelligenceCycle({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      topicId: topic.id,
      days: input.days ?? 30,
      maxItemsPerConnector: input.maxItemsPerConnector ?? 50,
      includeTrendingNews: input.includeTrendingNews ?? true,
    });
  },
};

// 25. dashboard_summary
const dashboardTool: ToolHandler<{}> = {
  name: 'get_dashboard_summary',
  description: 'Return cross-topic dashboard stats: total mentions, last 24h, last 7d, sentiment, platform mix.',
  inputSchema: z.object({}),
  parameters: { type: 'object', properties: {} },
  execute: async (_input, ctx) => dashboardSummary(ctx.tenantId),
};

export const TOOLS: ToolHandler<any>[] = [
  searchMentions, searchWeb, webSearchAlias, fetchWebPage, searchNews, searchGdeltNews,
  sentimentSeries, platformDist, topEntitiesTool,
  summarizeTopic, clusterTool, detectRisks,
  listTopics, listConnectors, listRisks,
  triggerIngestion, createTopic, createAlertRule, evalAlertsTool, generateReportTool,
  usageStatus, explainScore, monitorActor, findAmplifiers, compareEntities,
  analyzeTopicSentiment, runCycleTool, dashboardTool,
];

export const TOOL_DEFS = TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
