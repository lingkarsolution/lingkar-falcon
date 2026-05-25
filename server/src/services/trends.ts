import { config } from '../config.js';
import { connectorRegistry } from '../connectors/registry.js';
import type { CanonicalMentionDraft, IngestionContext } from '../connectors/types.js';
import { store } from '../db/store.js';
import { newId, sha256 } from '../lib/crypto.js';
import { redactInfrastructureText } from '../lib/publicSources.js';
import { searchIndonesianNews } from './indonesianNews.js';
import type { Connector, Mention, Platform, Topic, TrendDiscoverySource, TrendItem, TrendSample, TrendSnapshot } from '../types.js';

const SOCIAL_PLATFORMS: Platform[] = ['x', 'threads', 'tiktok', 'instagram', 'youtube', 'facebook', 'reddit', 'news'];
const SNAPSHOT_TTL_MS = 6 * 60 * 60_000;
const DISCOVERY_KEYWORDS = ['viral indonesia', 'politik indonesia', 'ekonomi indonesia', 'rupiah', 'pemilu'];
const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'pada', 'dalam', 'akan', 'sudah', 'karena', 'sebagai',
  'indonesia', 'jakarta', 'berita', 'viral', 'terkini', 'terbaru', 'update', 'news', 'video', 'official',
  'the', 'and', 'for', 'from', 'this', 'that', 'with', 'about', 'after', 'before', 'into', 'over', 'under',
]);

type TrendSourceItem = {
  platform: Platform;
  title?: string | null;
  text: string;
  sourceUrl?: string | null;
  authorName?: string | null;
  publishedAt?: string | null;
  engagementTotal: number;
  sourceType: TrendDiscoverySource;
};

const snapshotId = (tenantId: string) => `trend_snapshot_${tenantId}`;

const now = () => new Date().toISOString();

const publicTrendSnapshot = (snapshot: TrendSnapshot | null): TrendSnapshot | null => snapshot
  ? {
      ...snapshot,
      errors: snapshot.errors.map((error) => ({
        ...error,
        message: redactInfrastructureText(error.message) ?? 'Source request failed.',
      })),
    }
  : null;

const connectorEnabled = (tenantId: string, platform: Platform): boolean => {
  const connector = (store.list('connectors') as Connector[]).find((item) => item.tenantId === tenantId && item.platform === platform);
  return !connector || (connector.enabled && connector.status !== 'disabled' && connector.status !== 'budget_exceeded');
};

const canRefreshPlatform = (tenantId: string, platform: Platform): boolean => {
  if (!connectorEnabled(tenantId, platform)) return false;
  if (platform === 'news' || platform === 'reddit') return true;
  if (platform === 'youtube') return Boolean(config.ensembleData.token || config.youtube.apiKey);
  if (platform === 'tiktok') return Boolean(config.ensembleData.token);
  if (platform === 'threads') return Boolean(config.ensembleData.token || config.threads.accessToken);
  if (platform === 'instagram') return Boolean(config.ensembleData.token || config.instagram.accessToken);
  if (platform === 'x') return Boolean(config.x.bearerToken || config.ensembleData.token);
  if (platform === 'facebook') return Boolean(config.facebook.pageAccessToken);
  return false;
};

const toTimestamp = (iso?: string | null): number => {
  const value = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
};

const titleCase = (value: string): string => value
  .split(' ')
  .map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part)
  .join(' ');

const cleanText = (value: string): string => value
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[^\p{L}\p{N}#\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokensFor = (value: string): string[] => cleanText(value)
  .split(' ')
  .map((token) => token.replace(/^#/, ''))
  .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

const phrasesFor = (item: TrendSourceItem): string[] => {
  const text = `${item.title ?? ''} ${item.text}`;
  const hashtags = [...text.matchAll(/#([\p{L}\p{N}_]{4,})/gu)].map((match) => match[1]!.toLowerCase().replace(/_/g, ' '));
  const tokens = tokensFor(text);
  const phrases = new Map<string, number>();
  for (const tag of hashtags) phrases.set(tag, (phrases.get(tag) ?? 0) + 6);
  for (let size = 3; size >= 1; size--) {
    for (let index = 0; index <= tokens.length - size; index++) {
      const phrase = tokens.slice(index, index + size).join(' ');
      if (phrase.length < 5) continue;
      phrases.set(phrase, (phrases.get(phrase) ?? 0) + size);
    }
  }
  return [...phrases.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 4)
    .map(([phrase]) => phrase);
};

const sourceItemFromMention = (mention: Mention): TrendSourceItem => ({
  platform: mention.platform,
  title: mention.title,
  text: mention.text,
  sourceUrl: mention.sourceUrl,
  authorName: mention.author?.displayName ?? mention.author?.username ?? null,
  publishedAt: mention.publishedAt ?? mention.collectedAt,
  engagementTotal: Number(mention.metrics.engagementTotal ?? mention.metrics.likes ?? 0),
  sourceType: 'cached_mentions',
});

const sourceItemFromDraft = (draft: CanonicalMentionDraft): TrendSourceItem => ({
  platform: draft.platform,
  title: draft.title,
  text: draft.text,
  sourceUrl: draft.sourceUrl,
  authorName: draft.author?.displayName ?? draft.author?.username ?? null,
  publishedAt: draft.publishedAt ?? draft.collectedAt ?? null,
  engagementTotal: Number(draft.metrics?.engagementTotal ?? draft.metrics?.likes ?? 0),
  sourceType: ['youtube', 'tiktok', 'instagram', 'threads', 'x'].includes(draft.platform) && config.ensembleData.token ? 'ensembledata' : 'connector',
});

const sampleFor = (item: TrendSourceItem): TrendSample => ({
  title: item.title,
  text: item.text.slice(0, 260),
  sourceUrl: item.sourceUrl,
  authorName: item.authorName,
  publishedAt: item.publishedAt,
});

const matchTopic = (tenantId: string, phrase: string, keywords: string[]): string | null => {
  const haystack = `${phrase} ${keywords.join(' ')}`.toLowerCase();
  const topics = (store.list('topics') as Topic[]).filter((topic) => topic.tenantId === tenantId);
  const found = topics.find((topic) => topic.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())) || haystack.includes(topic.title.toLowerCase()));
  return found?.id ?? null;
};

const buildTrends = (tenantId: string, platform: Platform, items: TrendSourceItem[], limit: number): TrendItem[] => {
  const groups = new Map<string, {
    phrase: string;
    items: TrendSourceItem[];
    sources: Set<string>;
    engagementTotal: number;
    sourceTypes: Set<TrendDiscoverySource>;
  }>();

  for (const item of items.filter((entry) => entry.platform === platform && entry.text.trim())) {
    for (const phrase of phrasesFor(item)) {
      const current = groups.get(phrase) ?? { phrase, items: [], sources: new Set<string>(), engagementTotal: 0, sourceTypes: new Set<TrendDiscoverySource>() };
      current.items.push(item);
      current.sources.add(item.sourceUrl ?? `${item.authorName ?? 'unknown'}:${item.publishedAt ?? current.items.length}`);
      current.engagementTotal += item.engagementTotal;
      current.sourceTypes.add(item.sourceType);
      groups.set(phrase, current);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const sortedItems = [...group.items].sort((a, b) => toTimestamp(a.publishedAt) - toTimestamp(b.publishedAt));
      const keywords = tokensFor(group.phrase).slice(0, 6);
      const score = (group.items.length * 3) + (group.sources.size * 4) + Math.log10(group.engagementTotal + 10);
      const sourceTypes = [...group.sourceTypes];
      return {
        id: `trend_${platform}_${sha256(group.phrase).slice(0, 12)}`,
        platform,
        title: titleCase(group.phrase),
        keywords: keywords.length > 0 ? keywords : group.phrase.split(' '),
        description: sortedItems[0]?.text.slice(0, 180) ?? null,
        mentionCount: group.items.length,
        sourceCount: group.sources.size,
        engagementTotal: group.engagementTotal,
        score: Number(score.toFixed(2)),
        firstSeenAt: sortedItems[0]?.publishedAt ?? null,
        latestSeenAt: sortedItems.at(-1)?.publishedAt ?? null,
        sourceType: sourceTypes.length > 1 ? 'mixed' : sourceTypes[0] ?? 'cached_mentions',
        matchedTopicId: matchTopic(tenantId, group.phrase, keywords),
        samples: sortedItems.slice(0, 3).map(sampleFor),
      } satisfies TrendItem;
    })
    .sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount || b.mentionCount - a.mentionCount)
    .slice(0, limit);
};

const recentCachedItems = (tenantId: string, platforms: Platform[]): TrendSourceItem[] => {
  const cutoff = Date.now() - 14 * 86_400_000;
  return (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === tenantId && platforms.includes(mention.platform))
    .filter((mention) => toTimestamp(mention.publishedAt ?? mention.collectedAt) >= cutoff)
    .map(sourceItemFromMention);
};

const fetchNewsItems = async (limit: number): Promise<TrendSourceItem[]> => {
  const result = await searchIndonesianNews({ query: 'berita terkini indonesia viral politik ekonomi', maxResults: Math.max(20, limit * 3), freshnessDays: 7 });
  return result.results.map((item) => ({
    platform: 'news',
    title: item.title,
    text: `${item.title}\n${item.snippet}`,
    sourceUrl: item.url,
    authorName: item.sourceDomain,
    publishedAt: item.publishedAt ?? null,
    engagementTotal: 0,
    sourceType: 'public_search',
  }));
};

const fetchConnectorItems = async (tenantId: string, platform: Platform, limit: number): Promise<TrendSourceItem[]> => {
  const connector = connectorRegistry[platform];
  if (!connector || !canRefreshPlatform(tenantId, platform)) return [];
  const connectorRecord = (store.list('connectors') as Connector[]).find((item) => item.tenantId === tenantId && item.platform === platform);
  const ctx: IngestionContext = {
    tenantId,
    topicId: `trend_${platform}`,
    connectorId: `trend_${platform}`,
    jobId: `trend_${Date.now()}`,
    keywords: DISCOVERY_KEYWORDS,
    excludeKeywords: [],
    languages: ['id', 'en'],
    regions: ['id'],
    dateFrom: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    maxItems: Math.max(25, limit * 3),
    connectorConfig: connectorRecord?.config,
  };
  const drafts = await connector.fetchMentions(ctx);
  return drafts.map(sourceItemFromDraft);
};

export const latestTrendSnapshot = (tenantId: string): TrendSnapshot | null =>
  publicTrendSnapshot((store.get('trendSnapshots', snapshotId(tenantId)) as TrendSnapshot | undefined) ?? null);

export const refreshTrendSnapshot = async (tenantId: string, options: { platforms?: Platform[]; limitPerPlatform?: number } = {}): Promise<TrendSnapshot> => {
  const platforms = options.platforms?.length ? options.platforms : SOCIAL_PLATFORMS;
  const limit = Math.min(20, Math.max(1, options.limitPerPlatform ?? 10));
  const errors: TrendSnapshot['errors'] = [];
  const liveItems: TrendSourceItem[] = [];

  for (const platform of platforms) {
    try {
      if (platform === 'news') liveItems.push(...await fetchNewsItems(limit));
      else liveItems.push(...await fetchConnectorItems(tenantId, platform, limit));
    } catch (error) {
      errors.push({ platform, message: redactInfrastructureText((error as Error).message) ?? 'Source request failed.' });
    }
  }

  const allItems = [...liveItems, ...recentCachedItems(tenantId, platforms)];
  const trendsByPlatform: TrendSnapshot['trendsByPlatform'] = {};
  for (const platform of platforms) trendsByPlatform[platform] = buildTrends(tenantId, platform, allItems, limit);

  for (const platform of platforms) {
    if (!canRefreshPlatform(tenantId, platform) && platform !== 'news' && platform !== 'reddit') {
      errors.push({
        platform,
        message: 'Source is not configured; showing cached mentions only.',
      });
    }
  }

  const generatedAt = now();
  const snapshot: TrendSnapshot = {
    id: snapshotId(tenantId),
    tenantId,
    status: errors.length === platforms.length ? 'failed' : errors.length > 0 ? 'partial' : 'ready',
    platforms,
    trendsByPlatform,
    errors,
    generatedAt,
    expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString(),
    source: liveItems.length > 0 ? 'mixed' : 'cached_mentions',
  };
  store.put('trendSnapshots', snapshot.id, snapshot);
  await store.flush();
  return snapshot;
};

export const trendToTopicDraft = (tenantId: string, trendId: string): { trend: TrendItem; topic?: Topic } | null => {
  const snapshot = latestTrendSnapshot(tenantId);
  const trend = snapshot?.platforms.flatMap((platform) => snapshot.trendsByPlatform[platform] ?? []).find((item) => item.id === trendId);
  if (!trend) return null;
  const topic = trend.matchedTopicId ? store.get('topics', trend.matchedTopicId) as Topic | undefined : undefined;
  return { trend, topic };
};

export const monitorTrend = async (tenantId: string, userId: string, trendId: string): Promise<Topic | null> => {
  const found = trendToTopicDraft(tenantId, trendId);
  if (!found) return null;
  if (found.topic) return found.topic;
  const timestamp = now();
  const topic: Topic = {
    id: newId('topic'),
    tenantId,
    title: found.trend.title,
    description: `Created from ${found.trend.platform} trend discovery. ${found.trend.description ?? ''}`.trim(),
    category: 'trend_discovery',
    keywords: found.trend.keywords,
    excludeKeywords: [],
    platforms: [found.trend.platform],
    languages: ['id', 'en'],
    regions: ['id'],
    status: 'active',
    collectionFrequencyMinutes: 60,
    intelligenceSettings: {
      lookbackDays: 30,
      maxItemsPerConnector: 50,
      dailyAnalysisEnabled: true,
      trendingNewsEnabled: false,
      lastCycleRunAt: null,
    },
    createdBy: userId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.put('topics', topic.id, topic);
  const snapshot = latestTrendSnapshot(tenantId);
  if (snapshot) {
    for (const platform of snapshot.platforms) {
      snapshot.trendsByPlatform[platform] = (snapshot.trendsByPlatform[platform] ?? []).map((item) => item.id === trendId ? { ...item, matchedTopicId: topic.id } : item);
    }
    store.put('trendSnapshots', snapshot.id, snapshot);
  }
  await store.flush();
  return topic;
};