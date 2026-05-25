// Domain types — mirror packages/shared from §9 of plan.md
export type Platform =
  | 'news' | 'rss' | 'web' | 'gdelt'
  | 'facebook' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'threads'
  | 'reddit' | 'bluesky' | 'mastodon';

export type SourceType =
  | 'social_post' | 'news_article' | 'video' | 'comment' | 'web_page' | 'rss_item';

export type Sentiment = 'positive' | 'negative' | 'neutral' | 'mixed' | 'unknown';
export type TopicStatus = 'active' | 'paused' | 'archived';
export type Role = 'admin' | 'analyst' | 'viewer';
export type TopicSubjectType = 'public_figure' | 'organization' | 'issue' | 'group' | 'brand' | 'event' | 'normal_user' | 'general';
export type TopicMonitoringObjective = 'reputation' | 'early_warning' | 'sentiment' | 'misinformation' | 'campaign' | 'competitor' | 'complaints';
export type TopicPerspectiveRole = 'topic_owner' | 'government' | 'opposition' | 'public' | 'competitor' | 'media' | 'neutral_observer' | 'custom';
export type TopicGeoMode = 'mentioned' | 'author' | 'both';
export type TopicRelevanceMode = 'broad' | 'balanced' | 'strict';
export type TopicCostMode = 'free_only' | 'balanced' | 'manual_paid';

export type ConnectorMode = 'free' | 'official_api' | 'paid_api' | 'scraper' | 'manual_import' | 'disabled';
export type ConnectorStatus = 'active' | 'limited' | 'disabled' | 'failed' | 'budget_exceeded' | 'not_configured';

export type EntityType = 'person' | 'organization' | 'location' | 'event' | 'product' | 'other';

export type GeoTargetType = 'mentioned_location' | 'author_location';
export type GeoSource = 'api' | 'profile' | 'text_inference' | 'ai_inferred' | 'mixed' | 'unknown';

export type RiskCategory = 'reputation' | 'legal' | 'fiscal' | 'operational' | 'security' | 'political' | 'other';
export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RiskEventStatus = 'new' | 'reviewing' | 'acknowledged' | 'resolved' | 'dismissed';

export type Tenant = { id: string; name: string; slug: string; createdAt: string; updatedAt: string };

export type User = {
  id: string; tenantId: string; email: string; name: string;
  role: Role; passwordHash: string; createdAt: string; updatedAt: string;
};

export type TopicMonitoringBrief = {
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
  alerts: {
    triggers: string[];
  };
};

export type Topic = {
  id: string; tenantId: string; title: string;
  description?: string | null; category?: string | null;
  keywords: string[]; excludeKeywords: string[];
  platforms: Platform[]; languages: string[]; regions: string[];
  monitoringBrief?: TopicMonitoringBrief | null;
  status: TopicStatus;
  collectionFrequencyMinutes?: number | null;
  intelligenceSettings?: {
    lookbackDays?: number;
    maxItemsPerConnector?: number;
    dailyAnalysisEnabled?: boolean;
    dailyAnalysisTime?: string;
    timezone?: string;
    trendingNewsEnabled?: boolean;
    lastCycleRunAt?: string | null;
  };
  createdBy?: string | null;
  createdAt: string; updatedAt: string;
};

export type Connector = {
  id: string; tenantId: string;
  platform: Platform; name: string;
  mode: ConnectorMode; status: ConnectorStatus; enabled: boolean;
  credentialConfigured: boolean;
  rateLimitPerMinute?: number | null;
  dailyRequestLimit?: number | null;
  monthlyBudgetUsd?: number | null;
  currentMonthSpendUsd: number;
  currentMonthRequests: number;
  lastHealthCheckAt?: string | null;
  lastHealthMessage?: string | null;
  config?: Record<string, unknown>;
  createdAt: string; updatedAt: string;
};

export type ConnectorCredential = {
  id: string; tenantId: string; connectorId: string;
  encryptedPayload: string; createdAt: string; updatedAt: string;
};

export type ConnectorUsageEvent = {
  id: string; tenantId: string; connectorId: string;
  ingestionJobId?: string | null;
  requestCount: number;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  endpoint?: string | null;
  createdAt: string;
};

export type Location = {
  id: string;
  countryCode: string;
  province?: string | null;
  city: string;
  aliases: string[];
  latitude?: number | null;
  longitude?: number | null;
  population?: number | null;
  timezone?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GeoEstimateAlternative = {
  locationId?: string | null;
  city: string;
  province?: string | null;
  countryCode?: string | null;
  confidence: number;
};

export type GeoEstimate = {
  locationId?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  confidence: number;
  source: GeoSource;
  signals: string[];
  alternatives: GeoEstimateAlternative[];
};

export type MentionGeoSummary = {
  mentioned?: GeoEstimate | null;
  author?: GeoEstimate | null;
  enrichedAt?: string | null;
  model?: string | null;
};

export type MentionGeoEnrichment = {
  id: string;
  tenantId: string;
  mentionId: string;
  topicId: string;
  targetType: GeoTargetType;
  estimate: GeoEstimate;
  model?: string | null;
  rawSignals?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type TopicCityBaseline = {
  id: string;
  tenantId: string;
  topicId: string;
  locationId?: string | null;
  city: string;
  province?: string | null;
  countryCode: string;
  window: 'hour' | 'day' | 'week';
  baselineMentions: number;
  baselineEngagement: number;
  baselineNegativeRate?: number | null;
  sampleSize: number;
  computedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TopicCityTrend = {
  id: string;
  tenantId: string;
  topicId: string;
  locationId?: string | null;
  city: string;
  province?: string | null;
  countryCode: string;
  windowStart: string;
  windowEnd: string;
  mentionCount: number;
  engagementTotal: number;
  sentimentBreakdown: Partial<Record<Sentiment, number>>;
  baselineMentions?: number | null;
  trendScore?: number | null;
  confidence: number;
  topKeywords: string[];
  topEntities: string[];
  createdAt: string;
  updatedAt: string;
};

export type SchemaMigration = {
  id: string;
  name: string;
  appliedAt: string;
};

export type TrendDiscoverySource = 'cached_mentions' | 'public_search' | 'connector' | 'ensembledata' | 'mixed';

export type MediaAssetType = 'image' | 'video' | 'other';
export type MediaProcessingStatus = 'queued' | 'stored' | 'analyzing' | 'completed' | 'failed' | 'skipped';

export type MentionMediaAsset = {
  id: string;
  type: MediaAssetType;
  sourceUrl: string;
  blobName?: string | null;
  blobUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbnailBlobName?: string | null;
  thumbnailBlobUrl?: string | null;
  frameBlobUrls?: string[];
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  transcript?: string | null;
  ocrText?: string | null;
  summary?: string | null;
  sentiment?: Sentiment | null;
  sentimentConfidence?: number | null;
  model?: string | null;
  status: MediaProcessingStatus;
  error?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  analyzedAt?: string | null;
};

export type TrendSample = {
  title?: string | null;
  text: string;
  sourceUrl?: string | null;
  authorName?: string | null;
  publishedAt?: string | null;
};

export type TrendItem = {
  id: string;
  platform: Platform;
  title: string;
  keywords: string[];
  description?: string | null;
  mentionCount: number;
  sourceCount: number;
  engagementTotal: number;
  score: number;
  firstSeenAt?: string | null;
  latestSeenAt?: string | null;
  sourceType: TrendDiscoverySource;
  matchedTopicId?: string | null;
  samples: TrendSample[];
};

export type TrendSnapshot = {
  id: string;
  tenantId: string;
  status: 'ready' | 'partial' | 'failed';
  platforms: Platform[];
  trendsByPlatform: Partial<Record<Platform, TrendItem[]>>;
  errors: Array<{ platform: Platform; message: string }>;
  generatedAt: string;
  expiresAt?: string | null;
  source: TrendDiscoverySource;
};

export type IngestionJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type IngestionJobType = 'manual' | 'scheduled' | 'backfill' | 'refresh_metrics';

export type IngestionJob = {
  id: string; tenantId: string; topicId: string; connectorId: string;
  jobType: IngestionJobType; status: IngestionJobStatus;
  requestedBy?: string | null;
  startedAt?: string | null; finishedAt?: string | null;
  fetchedCount: number; insertedCount: number; skippedCount: number; errorCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type IngestionJobProgressItem = {
  id: string;
  platform: Platform;
  sourceType: SourceType;
  title?: string | null;
  textPreview?: string | null;
  sourceUrl?: string | null;
  status: 'retrieved' | 'reviewing' | 'accepted' | 'rejected' | 'stored' | 'duplicate' | 'error';
  reason?: string | null;
  relevanceScore?: number | null;
  reviewSource?: 'llm' | 'heuristic' | null;
};

export type IngestionJobProgressBatch = {
  page: number;
  requested: number;
  retrieved: number;
  processed: number;
  accepted: number;
  rejected: number;
  stored: number;
  duplicates: number;
  startedAt: string;
  finishedAt?: string | null;
};

export type IngestionJobLlmStream = {
  status: 'idle' | 'streaming' | 'completed' | 'failed' | 'fallback';
  phase: 'pre_ingestion_review' | 'sentiment';
  title: string;
  batch: number;
  totalBatches: number;
  candidates: number;
  text: string;
  error?: string | null;
  startedAt?: string | null;
  updatedAt: string;
};

export type IngestionJobProgress = {
  stage: 'queued' | 'fetching' | 'reviewing' | 'persisting' | 'enriching' | 'completed' | 'failed';
  platform: Platform;
  currentPage: number;
  maxItemsPerSource: number;
  retrievedLimit: number;
  retrievedCount: number;
  processedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  storedCount: number;
  duplicateCount: number;
  currentItems: IngestionJobProgressItem[];
  batches: IngestionJobProgressBatch[];
  llmStream?: IngestionJobLlmStream | null;
  updatedAt: string;
};

export type IngestionJobError = {
  id: string; tenantId: string; ingestionJobId: string;
  errorCode?: string | null; message: string;
  rawContext?: Record<string, unknown> | null; createdAt: string;
};

export type ExtractedEntity = {
  text: string; normalizedName?: string | null;
  type: EntityType; confidence: number; sentiment?: Sentiment;
};

export type Author = {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
  followersCount?: number | null;
  verified?: boolean | null;
};

export type Mention = {
  id: string; tenantId: string; topicId: string;
  platform: Platform; sourceType: SourceType;
  sourceId?: string | null; sourceUrl?: string | null; sourceUrlHash?: string | null;
  title?: string | null; text: string; language?: string | null;
  author?: Author | null;
  publishedAt?: string | null; collectedAt: string;
  media?: MentionMediaAsset[];
  metrics: {
    views?: number | null; likes?: number | null; comments?: number | null;
    shares?: number | null; reposts?: number | null; quotes?: number | null;
    saves?: number | null; engagementTotal?: number | null; reachEstimate?: number | null;
  };
  nlp: {
    sentiment: Sentiment; sentimentConfidence?: number | null;
    sentimentSource?: 'heuristic' | 'llm' | null; sentimentAnalyzedAt?: string | null;
    emotions?: string[]; intent?: string | null;
    entities?: ExtractedEntity[]; topics?: string[]; summary?: string | null;
  };
  quality: {
    isDuplicate: boolean; duplicateOfId?: string | null;
    isIrrelevant: boolean; relevanceScore?: number | null;
    automationLikelihood?: number | null; sourceReliability?: number | null;
    reviewSource?: 'llm' | 'heuristic' | null;
    reviewReason?: string | null;
    rejectionReason?: string | null;
  };
  geo?: MentionGeoSummary | null;
  rawPayloadRef?: string | null;
  createdAt: string; updatedAt: string;
};

export type IngestionJobItemOutcomeStatus = 'inserted' | 'skipped';
export type IngestionJobItemOutcomeReasonCode = 'stored' | 'duplicate' | 'irrelevant' | 'processing_error';

export type IngestionJobItemOutcome = {
  id: string;
  status: IngestionJobItemOutcomeStatus;
  reasonCode: IngestionJobItemOutcomeReasonCode;
  reason: string;
  mentionId?: string | null;
  duplicateOfMentionId?: string | null;
  platform: Platform;
  sourceType: SourceType;
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
};

export type InsightType = 'summary' | 'issue' | 'risk_event' | 'opportunity' | 'entity' | 'daily_brief' | 'sentiment_strategy';

export type TopicSentimentStrategy = {
  topicId: string;
  generatedAt: string;
  mentionsAnalyzed: number;
  llmEnabled: boolean;
  negative: {
    title: string;
    summary: string;
    concerns: string[];
    evidenceMentionIds: string[];
  };
  positive: {
    title: string;
    summary: string;
    excitementDrivers: string[];
    evidenceMentionIds: string[];
  };
  prStrategy: {
    title: string;
    recommendation: string;
    actions: string[];
    tone: string;
  };
};

export type Insight = {
  id: string; tenantId: string; topicId: string;
  type: InsightType; title: string; summary: string;
  whyItMatters?: string | null; impact?: string | null; recommendation?: string | null;
  metrics: Record<string, number | undefined>;
  evidenceMentionIds: string[];
  payload?: Record<string, unknown> | null;
  confidence: number; generatedBy: 'system' | 'user';
  generatedAt: string; createdAt: string;
};

export type IssueCluster = {
  id: string; tenantId: string; topicId: string;
  title: string; summary: string;
  sentiment: Sentiment; trendDirection: 'rising' | 'flat' | 'falling';
  mentionCount: number; engagementTotal: number; reachEstimate: number;
  confidence: number; status: 'active' | 'dismissed';
  sampleMentionIds: string[];
  createdAt: string; updatedAt: string;
};

export type RiskEvent = {
  id: string; tenantId: string; topicId: string;
  issueClusterId?: string | null;
  code: string; title: string; summary: string;
  category: RiskCategory; severity: RiskSeverity;
  sentiment: 'negative' | 'mixed' | 'neutral';
  score: number; keyTrigger: string; narrativeTags: string[];
  metrics: {
    mentions: number; impressions?: number; reachEstimate?: number;
    engagementTotal?: number; velocityScore?: number;
  };
  firstSeenAt: string; lastSeenAt: string;
  evidenceMentionIds: string[]; status: RiskEventStatus;
  createdAt: string; updatedAt: string;
};

export type Actor = {
  id: string; tenantId: string;
  platform: Platform; username: string;
  displayName?: string | null; profileUrl?: string | null;
  monitoringReason?: string | null; tags: string[];
  status: 'pending' | 'active' | 'limited' | 'failed';
  riskScore?: number | null; riskLevel?: 'critical' | 'high' | 'moderate' | 'low' | null;
  riskExplanation?: string | null;
  opportunityScore?: number | null; opportunityLevel?: 'excellent' | 'good' | 'fair' | 'poor' | null;
  opportunityExplanation?: string | null;
  lastRefreshedAt?: string | null;
  createdAt: string; updatedAt: string;
};

export type AlertRuleType =
  | 'volume_spike' | 'negative_sentiment_spike' | 'risk_event' | 'actor_mention' | 'keyword';

export type AlertRule = {
  id: string; tenantId: string; topicId?: string | null;
  name: string; type: AlertRuleType; enabled: boolean;
  severity?: RiskSeverity | null;
  config: Record<string, unknown>; channels: string[];
  createdBy?: string | null; createdAt: string; updatedAt: string;
};

export type AlertEvent = {
  id: string; tenantId: string;
  alertRuleId?: string | null; topicId?: string | null;
  title: string; message: string; severity: RiskSeverity;
  evidence: Array<{ mentionId: string; text: string }>;
  status: 'new' | 'acknowledged' | 'dismissed';
  triggeredAt: string;
  acknowledgedAt?: string | null; acknowledgedBy?: string | null;
};

export type Report = {
  id: string; tenantId: string; topicId?: string | null;
  reportType: string; title: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  dateFrom?: string | null; dateTo?: string | null;
  fileUrl?: string | null; errorMessage?: string | null;
  sections?: string[]; format?: 'pdf' | 'html';
  htmlContent?: string;
  requestedBy?: string | null;
  createdAt: string; finishedAt?: string | null;
};

export type AuditLog = {
  id: string; tenantId: string; actorUserId?: string | null;
  action: string; entityType: string; entityId?: string | null;
  before?: unknown; after?: unknown; createdAt: string;
};

export type Conversation = {
  id: string; tenantId: string; userId: string;
  title?: string | null; createdAt: string; updatedAt: string;
};

export type ConversationTurn = {
  id: string; tenantId: string; conversationId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: unknown;
  tokenCountInput?: number | null; tokenCountOutput?: number | null;
  estimatedCostUsd?: number | null;
  createdAt: string;
};

export type ToolInvocation = {
  id: string; tenantId: string; conversationId: string;
  turnId?: string | null;
  toolName: string; input: unknown; output?: unknown;
  status: 'ok' | 'error' | 'rejected_budget' | 'rejected_rbac';
  durationMs?: number | null; estimatedCostUsd?: number | null;
  errorMessage?: string | null; createdAt: string;
};

export type Session = {
  token: string; userId: string; tenantId: string; createdAt: string; expiresAt: string;
};
