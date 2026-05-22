import { store } from '../db/store.js';
import { enqueueIngestion, runIngestionJob } from './ingestion.js';
import { analyzeMentionsSentimentBulk, type BulkSentimentResult } from './sentiment.js';
import { clusterTopic } from './clustering.js';
import { detectRiskEvents } from './risk.js';
import { generateDailyBrief } from './insights.js';
import { INDONESIAN_NEWS_SOURCES } from './indonesianNews.js';
import type { Connector, IngestionJob, Insight, IssueCluster, RiskEvent, Topic } from '../types.js';

export type IntelligenceCycleResult = {
  topicId: string;
  days: number;
  jobs: IngestionJob[];
  sentiment: BulkSentimentResult;
  clusters: IssueCluster[];
  risks: RiskEvent[];
  brief: Insight | null;
  startedAt: string;
  finishedAt: string;
};

const OSINT_PLATFORMS = new Set(['gdelt', 'rss', 'web', 'news']);

export const runIntelligenceCycle = async (params: {
  tenantId: string;
  userId?: string | null;
  topicId: string;
  days?: number;
  maxItemsPerConnector?: number;
  includeTrendingNews?: boolean;
}): Promise<IntelligenceCycleResult> => {
  const startedAt = new Date().toISOString();
  const topic = store.get('topics', params.topicId) as Topic | undefined;
  if (!topic || topic.tenantId !== params.tenantId) throw new Error('Topic not found');

  const days = Math.min(90, Math.max(1, params.days ?? Number((topic as any).intelligenceSettings?.lookbackDays ?? 30)));
  const maxItems = Math.min(250, Math.max(1, params.maxItemsPerConnector ?? Number((topic as any).intelligenceSettings?.maxItemsPerConnector ?? 50)));
  const topicPlatforms = new Set((topic.platforms?.length ? topic.platforms : ['gdelt', 'rss', 'web']).filter((platform) => OSINT_PLATFORMS.has(platform)));
  if (params.includeTrendingNews !== false) topicPlatforms.add('web');

  const connectors = (store.list('connectors') as Connector[])
    .filter((connector) => connector.tenantId === params.tenantId && topicPlatforms.has(connector.platform))
    .filter((connector) => connector.enabled && connector.status !== 'disabled' && connector.status !== 'budget_exceeded');

  const jobs: IngestionJob[] = [];
  for (const connector of connectors) {
    const metadata = connector.platform === 'web' && params.includeTrendingNews !== false
      ? {
        trendingNews: true,
        trendingNewsQuery: topic.keywords.slice(0, 5).join(' '),
        newsSourceDomains: INDONESIAN_NEWS_SOURCES,
      }
      : undefined;
    const job = await enqueueIngestion({
      tenantId: params.tenantId,
      topicId: topic.id,
      connectorId: connector.id,
      jobType: 'manual',
      requestedBy: params.userId ?? null,
      maxItems,
      days,
      metadata,
      runInline: true,
    });
    await runIngestionJob(job.id);
    jobs.push((store.get('ingestionJobs', job.id) as IngestionJob | undefined) ?? job);
  }

  const sentiment = await analyzeMentionsSentimentBulk({ tenantId: params.tenantId, topicId: topic.id, limit: 200 });
  const clusters = clusterTopic(params.tenantId, topic.id);
  const risks = detectRiskEvents(params.tenantId, topic.id);
  const brief = await generateDailyBrief(params.tenantId, topic.id);

  store.put('topics', topic.id, {
    ...topic,
    intelligenceSettings: {
      ...((topic as any).intelligenceSettings ?? {}),
      lookbackDays: days,
      maxItemsPerConnector: maxItems,
      dailyAnalysisEnabled: true,
      lastCycleRunAt: startedAt,
    },
    updatedAt: new Date().toISOString(),
  } as Topic);

  return {
    topicId: topic.id,
    days,
    jobs,
    sentiment,
    clusters,
    risks,
    brief,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
};