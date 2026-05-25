// Typed API client against the OmniSense /api/v1 surface.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const BASE = '/api/v1';

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', res.statusText);
    return (await res.text()) as unknown as T;
  }
  const json = await res.json();
  if (!res.ok || json?.ok === false) {
    const err = json?.error ?? { code: 'HTTP_ERROR', message: res.statusText };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return json.data as T;
};

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  delete: <T>(p: string) => request<T>('DELETE', p),
};

// ---- Types (loose mirrors of server types — enough for UI) ----
export type Role = 'admin' | 'analyst' | 'viewer';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown';
export type Platform = string;
export type TopicSubjectType = 'public_figure' | 'organization' | 'issue' | 'group' | 'brand' | 'event' | 'normal_user' | 'general';
export type TopicMonitoringObjective = 'reputation' | 'early_warning' | 'sentiment' | 'misinformation' | 'campaign' | 'competitor' | 'complaints';
export type TopicPerspectiveRole = 'topic_owner' | 'government' | 'opposition' | 'public' | 'competitor' | 'media' | 'neutral_observer' | 'custom';
export type TopicGeoMode = 'mentioned' | 'author' | 'both';
export type TopicRelevanceMode = 'broad' | 'balanced' | 'strict';
export type TopicCostMode = 'free_only' | 'balanced' | 'manual_paid';

export interface TopicMonitoringBrief {
  setupMode?: 'simple' | 'advanced';
  subjectType?: TopicSubjectType;
  objectives: TopicMonitoringObjective[];
  perspective: {
    role: TopicPerspectiveRole;
    name?: string | null;
    description?: string | null;
    favorableSignals: string[];
    unfavorableSignals: string[];
  };
  query: {
    includeKeywords: string[];
    exactPhrases: string[];
    hashtags: string[];
    handles: string[];
    relatedEntities: string[];
    excludeKeywords: string[];
    excludeHashtags: string[];
    excludeHandles: string[];
    excludeDomains: string[];
  };
  sources: {
    platforms: Platform[];
    languages: string[];
    countries: string[];
    provinces: string[];
    cities: string[];
    geoMode: TopicGeoMode;
  };
  audience: {
    types: string[];
    minimumFollowers?: number | null;
    verifiedOnly: boolean;
    includeLowFollowerAccounts: boolean;
  };
  relevance: {
    mode: TopicRelevanceMode;
    aiReviewEnabled: boolean;
  };
  collection: {
    lookbackDays: number;
    refreshMinutes: number;
    maxItemsPerConnector: number;
    costMode: TopicCostMode;
  };
  alerts: { triggers: string[] };
}

export interface User { id: string; email: string; name: string; role: Role; }
export interface Tenant { id: string; name: string; slug: string; }
export interface Topic {
  id: string; tenantId: string; title: string; description?: string | null; category?: string | null;
  keywords: string[]; excludeKeywords: string[]; platforms: string[]; languages: string[]; regions: string[];
  monitoringBrief?: TopicMonitoringBrief | null;
  status: 'active' | 'paused' | 'archived'; collectionFrequencyMinutes: number;
  intelligenceSettings?: {
    lookbackDays?: number; maxItemsPerConnector?: number; dailyAnalysisEnabled?: boolean;
    trendingNewsEnabled?: boolean; lastCycleRunAt?: string | null;
  };
  createdAt: string; updatedAt: string;
}
export type TrendDiscoverySource = 'cached_mentions' | 'public_search' | 'connector' | 'ensembledata' | 'mixed';
export interface TrendSample {
  title?: string | null; text: string; sourceUrl?: string | null; authorName?: string | null; publishedAt?: string | null;
}
export interface TrendItem {
  id: string; platform: Platform; title: string; keywords: string[]; description?: string | null;
  mentionCount: number; sourceCount: number; engagementTotal: number; score: number;
  firstSeenAt?: string | null; latestSeenAt?: string | null; sourceType: TrendDiscoverySource;
  matchedTopicId?: string | null; samples: TrendSample[];
}
export interface TrendSnapshot {
  id: string; tenantId: string; status: 'ready' | 'partial' | 'failed'; platforms: Platform[];
  trendsByPlatform: Partial<Record<Platform, TrendItem[]>>;
  errors: Array<{ platform: Platform; message: string }>;
  generatedAt: string; expiresAt?: string | null; source: TrendDiscoverySource;
}
export interface Connector {
  id: string; tenantId: string; platform: Platform; name: string; displayName?: string; enabled: boolean;
  mode: 'free' | 'official_api' | 'paid_api' | 'scraper' | 'manual_import' | 'disabled';
  status: 'active' | 'limited' | 'disabled' | 'failed' | 'budget_exceeded' | 'not_configured';
  credentialConfigured: boolean;
  monthlyBudgetUsd?: number | null; currentMonthRequests?: number; currentMonthSpendUsd?: number;
  lastHealthCheckAt?: string | null; lastHealthMessage?: string | null;
}
export type MediaAssetType = 'image' | 'video' | 'other';
export type MediaProcessingStatus = 'queued' | 'stored' | 'analyzing' | 'completed' | 'failed' | 'skipped';
export interface MentionMediaAsset {
  id: string; type: MediaAssetType; sourceUrl: string;
  blobName?: string | null; blobUrl?: string | null;
  thumbnailUrl?: string | null; thumbnailBlobName?: string | null; thumbnailBlobUrl?: string | null;
  frameBlobUrls?: string[]; mimeType?: string | null; sizeBytes?: number | null; durationSeconds?: number | null;
  transcript?: string | null; ocrText?: string | null; summary?: string | null;
  sentiment?: Sentiment | null; sentimentConfidence?: number | null; model?: string | null;
  status: MediaProcessingStatus; error?: string | null; createdAt?: string | null; updatedAt?: string | null; analyzedAt?: string | null;
}
export interface Mention {
  id: string; tenantId: string; topicId: string; platform: Platform; sourceType?: string;
  text: string; publishedAt?: string | null; collectedAt: string; sourceUrl?: string | null;
  author?: { username?: string; displayName?: string; profileUrl?: string | null; followerCount?: number | null; followersCount?: number | null; verified?: boolean | null };
  media?: MentionMediaAsset[];
  nlp: { sentiment: Sentiment; sentimentConfidence?: number | null; sentimentScore?: number; sentimentSource?: 'heuristic' | 'llm' | null; entities: { text: string; type: string }[]; keywords: string[]; language?: string; summary?: string | null };
  metrics?: { likeCount?: number; shareCount?: number; commentCount?: number; viewCount?: number; likes?: number | null; shares?: number | null; comments?: number | null; views?: number | null; reposts?: number | null; quotes?: number | null; engagementTotal?: number | null };
  quality?: { relevanceScore: number; automationLikelihood: number };
}
export interface RiskEvent {
  id: string; tenantId: string; topicId: string; clusterId?: string | null; issueClusterId?: string | null;
  title: string; summary: string; score: number; severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewing' | 'acknowledged' | 'resolved' | 'dismissed' | 'mitigated'; category: string;
  detectedAt?: string; firstSeenAt?: string; lastSeenAt?: string; evidenceMentionIds: string[]; narrativeTags?: string[]; code?: string;
}
export interface AlertEvent {
  id: string; tenantId: string; ruleId: string; topicId?: string | null;
  title: string; description: string; severity: string; status: 'new' | 'acknowledged' | 'resolved';
  triggeredAt: string;
}
export interface Insight {
  id: string; tenantId: string; topicId: string; title: string; summary: string;
  whyItMatters: string; recommendation: string; evidenceMentionIds: string[]; generatedAt: string;
}
export interface TopicSentimentStrategy {
  topicId: string;
  generatedAt: string;
  mentionsAnalyzed: number;
  llmEnabled: boolean;
  negative: { title: string; summary: string; concerns: string[]; evidenceMentionIds: string[] };
  positive: { title: string; summary: string; excitementDrivers: string[]; evidenceMentionIds: string[] };
  prStrategy: { title: string; recommendation: string; actions: string[]; tone: string };
}
export interface IssueCluster {
  id: string; tenantId: string; topicId: string;
  title?: string; label?: string; summary?: string; sentiment?: Sentiment;
  mentionCount?: number; size?: number; engagementTotal?: number; reachEstimate?: number;
  sentimentBreakdown?: { positive: number; neutral: number; negative: number; mixed?: number; unknown?: number };
  representativeMentionIds?: string[]; sampleMentionIds?: string[]; keywords?: string[];
}
export interface Actor {
  id: string; tenantId: string; platform: Platform; username: string; displayName: string;
  status: 'active' | 'archived'; tags: string[];
  riskScore?: number | null; riskLevel?: 'low' | 'medium' | 'high' | 'critical' | null; riskExplanation?: string | null;
  opportunityScore?: number | null; opportunityLevel?: string | null; opportunityExplanation?: string | null;
}
export interface IngestionJob {
  id: string; tenantId: string; topicId: string; connectorId: string;
  jobType?: string; status: 'queued' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  fetchedCount?: number; insertedCount?: number; skippedCount?: number; errorCount?: number;
  itemsFetched?: number; itemsStored?: number; itemsDeduped?: number;
  metadata?: Record<string, unknown>;
  createdAt: string; startedAt?: string | null; finishedAt?: string | null;
}
export interface IngestionJobError { id: string; ingestionJobId: string; message: string; createdAt: string; }
export type IngestionRunItemStatus = 'inserted' | 'skipped';
export type IngestionRunItemReasonCode = 'stored' | 'duplicate' | 'irrelevant' | 'processing_error';
export interface IngestionProgressItem {
  id: string; platform: Platform; sourceType: string; title?: string | null; textPreview?: string | null; sourceUrl?: string | null;
  status: 'retrieved' | 'reviewing' | 'accepted' | 'rejected' | 'stored' | 'duplicate' | 'error';
  reason?: string | null; relevanceScore?: number | null; reviewSource?: 'llm' | 'heuristic' | null;
}
export interface IngestionProgressBatch {
  page: number; requested: number; retrieved: number; processed: number; accepted: number; rejected: number; stored: number; duplicates: number;
  startedAt: string; finishedAt?: string | null;
}
export interface IngestionLlmStream {
  status: 'idle' | 'streaming' | 'completed' | 'failed' | 'fallback';
  phase: 'pre_ingestion_review' | 'sentiment';
  title: string; batch: number; totalBatches: number; candidates: number; text: string; error?: string | null; startedAt?: string | null; updatedAt: string;
}
export interface IngestionProgress {
  stage: 'queued' | 'fetching' | 'reviewing' | 'persisting' | 'enriching' | 'completed' | 'failed';
  platform: Platform; currentPage: number; maxItemsPerSource: number; retrievedLimit: number; retrievedCount: number; processedCount: number;
  acceptedCount: number; rejectedCount: number; storedCount: number; duplicateCount: number; currentItems: IngestionProgressItem[];
  batches: IngestionProgressBatch[]; llmStream?: IngestionLlmStream | null; updatedAt: string;
}
export interface IngestionRunItem {
  id: string;
  status: IngestionRunItemStatus;
  reasonCode: IngestionRunItemReasonCode;
  reason: string;
  mentionId?: string | null;
  duplicateOfMentionId?: string | null;
  platform: Platform;
  sourceType: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  textPreview?: string | null;
  authorName?: string | null;
  publishedAt?: string | null;
  relevanceScore?: number | null;
  reviewSource?: 'llm' | 'heuristic' | null;
  sentiment?: Sentiment | null;
  metrics?: Mention['metrics'];
}
export interface IngestionJobDetail { job: IngestionJob; errors: IngestionJobError[]; items: IngestionRunItem[]; }
export interface Report {
  id: string; tenantId: string; topicId: string; title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  fileUrl?: string | null; createdAt: string; finishedAt?: string | null;
}
export interface AuditLog {
  id: string; tenantId: string; actorUserId?: string | null; action: string;
  entityType?: string | null; entityId?: string | null; createdAt: string;
}

export interface IndonesianNewsItem {
  title: string; url: string; snippet: string; source?: string; sourceDomain: string; searchQuery: string;
}
export interface IndonesianNewsSearchResult {
  query: string; sources: string[]; providerPriority: string[]; results: IndonesianNewsItem[]; errors: string[];
}
export interface BulkSentimentResult {
  llmEnabled: boolean; requested: number; analyzed: number; updated: number; failed: number; skipped: number; errors: string[];
}
export interface IntelligenceCycleResult {
  topicId: string; days: number; jobs: IngestionJob[]; sentiment: BulkSentimentResult;
  clusters: IssueCluster[]; risks: RiskEvent[]; brief: Insight | null; startedAt: string; finishedAt: string;
}

// ---- Endpoint helpers (typed wrappers) ----
export const auth = {
  login: (email: string, password: string) => api.post<{ user: User; tenantId: string }>('/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
  me: () => api.get<{ user: User | null; tenant: Tenant | null }>('/auth/me'),
};
