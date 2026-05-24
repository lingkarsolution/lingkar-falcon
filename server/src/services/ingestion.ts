// Ingestion service: runs a connector, enriches NLP, dedupes, persists, accounts usage.
import { store } from '../db/store.js';
import { getConnector } from '../connectors/registry.js';
import { newId } from '../lib/crypto.js';
import {
  analyzeSentiment, computeAutomationLikelihood, computeEngagementTotal,
  computeRelevanceScore, detectEmotions, detectIntent, detectLanguage, extractEntities,
} from '../lib/nlp.js';
import { analyzeMentionsSentimentBulk } from './sentiment.js';
import { enrichMentionsGeo } from './geoEnrichment.js';
import { reviewDraftsBeforeIngestion, type ReviewedMentionDraft } from './preIngestionReview.js';
import { enqueueMediaEnrichment } from './mediaEnrichment.js';
import type {
  Connector, IngestionJob, IngestionJobItemOutcome, IngestionJobItemOutcomeReasonCode, IngestionJobItemOutcomeStatus, IngestionJobType, Mention, MentionMediaAsset, Topic,
} from '../types.js';

const now = () => new Date().toISOString();

type DraftPersistenceOutcome = {
  draft: ReviewedMentionDraft;
  status: IngestionJobItemOutcomeStatus;
  reasonCode: Extract<IngestionJobItemOutcomeReasonCode, 'stored' | 'duplicate'>;
  reason: string;
  mentionId?: string | null;
  duplicateOfMentionId?: string | null;
};

export const enqueueIngestion = async (params: {
  tenantId: string; topicId: string; connectorId: string;
  jobType: IngestionJobType; requestedBy?: string | null;
  maxItems?: number;
  days?: number;
  dateFrom?: string;
  dateTo?: string;
  metadata?: Record<string, unknown>;
  runInline?: boolean;
}): Promise<IngestionJob> => {
  const id = newId('job');
  const job: IngestionJob = {
    id, tenantId: params.tenantId, topicId: params.topicId,
    connectorId: params.connectorId, jobType: params.jobType,
    status: 'queued', requestedBy: params.requestedBy ?? null,
    startedAt: null, finishedAt: null,
    fetchedCount: 0, insertedCount: 0, skippedCount: 0, errorCount: 0,
    metadata: {
      ...(params.metadata ?? {}),
      maxItems: params.maxItems ?? 50,
      ...(params.days ? { days: params.days } : {}),
      ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo ? { dateTo: params.dateTo } : {}),
    },
    createdAt: now(),
  };
  store.put('ingestionJobs', id, job);
  if (!params.runInline) setImmediate(() => { void runIngestionJob(id); });
  return job;
};

export const runIngestionJob = async (jobId: string): Promise<void> => {
  const job = store.get('ingestionJobs', jobId);
  if (!job) return;
  const topic = store.get('topics', job.topicId);
  const connector = store.get('connectors', job.connectorId) as Connector | undefined;
  if (!topic || !connector) {
    finalize(jobId, 'failed', { errorMessage: 'Topic or connector not found' });
    return;
  }
  if (!connector.enabled || connector.status === 'disabled' || connector.status === 'budget_exceeded') {
    finalize(jobId, 'failed', { errorMessage: `Connector ${connector.platform} is ${connector.status}` });
    return;
  }
  const impl = getConnector(connector.platform);
  if (!impl) {
    finalize(jobId, 'failed', { errorMessage: `No connector implementation for ${connector.platform}` });
    return;
  }

  store.put('ingestionJobs', jobId, { ...job, status: 'running', startedAt: now() });
  try {
    const maxItems = Number((job.metadata as any)?.maxItems ?? 50);
    const days = Number((job.metadata as any)?.days ?? (connector.config as any)?.historicalDays ?? (connector.config as any)?.timespanDays ?? 30);
    const dateFrom = (job.metadata as any)?.dateFrom
      ?? (Number.isFinite(days) && days > 0 ? new Date(Date.now() - Math.min(90, days) * 24 * 3600_000).toISOString() : undefined);
    const dateTo = (job.metadata as any)?.dateTo;
    const drafts = await impl.fetchMentions({
      tenantId: topic.tenantId, topicId: topic.id, connectorId: connector.id, jobId,
      keywords: topic.keywords, excludeKeywords: topic.excludeKeywords,
      languages: topic.languages, regions: topic.regions,
      dateFrom, dateTo,
      maxItems,
      connectorConfig: { ...(connector.config ?? {}), ...(job.metadata ?? {}) },
    });
    const preReview = await reviewDraftsBeforeIngestion(topic, drafts);
    const result = ingestDrafts(topic, preReview.drafts);
    const itemOutcomes = buildItemOutcomes(preReview.items, result.outcomes);
    let geoResult: Awaited<ReturnType<typeof enrichMentionsGeo>> | null = null;
    if (result.insertedIds.length > 0) {
      geoResult = await enrichMentionsGeo({
        tenantId: topic.tenantId,
        topicId: topic.id,
        mentionIds: result.insertedIds,
      });
    }
    let sentimentResult: Awaited<ReturnType<typeof analyzeMentionsSentimentBulk>> | null = null;
    if (result.needsSentimentIds.length > 0) {
      sentimentResult = await analyzeMentionsSentimentBulk({
        tenantId: topic.tenantId,
        topicId: topic.id,
        mentionIds: result.needsSentimentIds,
      });
    }
    if (result.mediaMentionIds.length > 0) {
      enqueueMediaEnrichment(topic.tenantId, result.mediaMentionIds);
    }
    recordUsage(connector, jobId, drafts.length);
    finalize(jobId, 'completed', {
      fetchedCount: drafts.length,
      insertedCount: result.inserted,
      skippedCount: result.skipped + preReview.rejected,
      metadata: { itemOutcomes, preIngestionReview: { llmEnabled: preReview.llmEnabled, requested: preReview.requested, kept: preReview.kept, rejected: preReview.rejected, failed: preReview.failed, errors: preReview.errors }, media: { queuedMentions: result.mediaMentionIds.length, assetCount: result.mediaAssetCount }, ...(geoResult ? { geo: geoResult } : {}), ...(sentimentResult ? { sentiment: sentimentResult } : {}) },
    });
  } catch (e) {
    const err = e as Error;
    const errId = newId('jerr');
    store.put('ingestionJobErrors', errId, {
      id: errId, tenantId: job.tenantId, ingestionJobId: jobId,
      errorCode: null, message: err.message, rawContext: null, createdAt: now(),
    });
    finalize(jobId, 'failed', { errorCount: 1, errorMessage: err.message });
  }
};

const ingestDrafts = (topic: Topic, drafts: ReviewedMentionDraft[]): { inserted: number; skipped: number; insertedIds: string[]; needsSentimentIds: string[]; mediaMentionIds: string[]; mediaAssetCount: number; outcomes: DraftPersistenceOutcome[] } => {
  // Dedupe via sourceUrlHash within topic
  const existingHashes = new Map(
    store.list('mentions')
      .filter((m: any) => m.topicId === topic.id && m.sourceUrlHash)
      .map((m: any) => [m.sourceUrlHash, m.id] as const),
  );
  let inserted = 0, skipped = 0;
  const insertedIds: string[] = [];
  const needsSentimentIds: string[] = [];
  const mediaMentionIds: string[] = [];
  const outcomes: DraftPersistenceOutcome[] = [];
  let mediaAssetCount = 0;
  for (const draft of drafts) {
    if (draft.sourceUrlHash && existingHashes.has(draft.sourceUrlHash)) {
      skipped++;
      outcomes.push({
        draft,
        status: 'skipped',
        reasonCode: 'duplicate',
        reason: 'Skipped because this source was already stored for this topic.',
        duplicateOfMentionId: existingHashes.get(draft.sourceUrlHash) ?? null,
      });
      continue;
    }
    const text = draft.text ?? '';
    const review = draft.preIngestionReview;
    const sent = analyzeSentiment(text);
    const lang = draft.language ?? detectLanguage(text);
    const entities = extractEntities(text);
    const metrics = { ...(draft.metrics ?? {}) };
    metrics.engagementTotal = computeEngagementTotal(metrics);
    const id = newId('mention');
    const collectedAt = now();
    const media = normalizeMediaAssets(draft.media ?? [], collectedAt);
    const finalSentiment = review?.sentiment && review.sentiment !== 'unknown' ? review.sentiment : sent.sentiment;
    const finalConfidence = review?.sentimentConfidence ?? sent.confidence;
    const mention: Mention = {
      id, tenantId: topic.tenantId, topicId: topic.id,
      platform: draft.platform, sourceType: draft.sourceType,
      sourceId: draft.sourceId ?? null, sourceUrl: draft.sourceUrl ?? null, sourceUrlHash: draft.sourceUrlHash ?? null,
      title: draft.title ?? null, text, language: lang,
      author: draft.author ?? null,
      publishedAt: draft.publishedAt ?? null, collectedAt,
      ...(media.length > 0 ? { media } : {}),
      metrics,
      nlp: {
        sentiment: finalSentiment, sentimentConfidence: finalConfidence,
        sentimentSource: review?.source ?? 'heuristic', sentimentAnalyzedAt: collectedAt,
        emotions: detectEmotions(text), intent: detectIntent(text),
        entities, topics: [], summary: review?.summary ?? null,
      },
      quality: {
        isDuplicate: false, isIrrelevant: false,
        relevanceScore: review?.relevanceScore ?? computeRelevanceScore(text, topic.keywords, topic.excludeKeywords),
        automationLikelihood: computeAutomationLikelihood(text, metrics),
        sourceReliability: 0.7,
      },
      createdAt: collectedAt, updatedAt: collectedAt,
    };
    store.put('mentions', id, mention);
    if (draft.sourceUrlHash) existingHashes.set(draft.sourceUrlHash, id);
    inserted++;
    insertedIds.push(id);
    outcomes.push({
      draft,
      status: 'inserted',
      reasonCode: 'stored',
      reason: insertedReason(review),
      mentionId: id,
    });
    if (media.length > 0) {
      mediaMentionIds.push(id);
      mediaAssetCount += media.length;
    }
    if (review?.source !== 'llm') needsSentimentIds.push(id);
  }
  return { inserted, skipped, insertedIds, needsSentimentIds, mediaMentionIds, mediaAssetCount, outcomes };
};

const formatScore = (value?: number | null): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : null;

const insertedReason = (review?: ReviewedMentionDraft['preIngestionReview']): string => {
  if (!review) return 'Saved as a new mention.';
  const score = formatScore(review.relevanceScore);
  const scoreText = score ? ` with relevance score ${score}` : '';
  const reviewText = `Passed ${review.source} pre-ingestion review${scoreText}.`;
  return review.reason ? `${reviewText} ${review.reason}` : reviewText;
};

const skippedByReviewReason = (review?: ReviewedMentionDraft['preIngestionReview']): string => {
  if (!review) return 'Skipped by pre-ingestion relevance review.';
  const score = formatScore(review.relevanceScore);
  const scoreText = score ? ` with relevance score ${score}` : '';
  const reviewText = `Skipped by ${review.source} pre-ingestion review${scoreText}.`;
  return review.reason ? `${reviewText} ${review.reason}` : reviewText;
};

const textPreview = (draft: ReviewedMentionDraft): string | null => {
  const text = [draft.title, draft.text].map((value) => value?.trim()).filter(Boolean).join(' - ');
  return text ? text.replace(/\s+/g, ' ').slice(0, 240) : null;
};

const authorName = (draft: ReviewedMentionDraft): string | null =>
  draft.author?.displayName?.trim() || draft.author?.username?.trim() || null;

const buildOutcome = (
  draft: ReviewedMentionDraft,
  index: number,
  status: IngestionJobItemOutcomeStatus,
  reasonCode: IngestionJobItemOutcomeReasonCode,
  reason: string,
  extra: Partial<Pick<IngestionJobItemOutcome, 'mentionId' | 'duplicateOfMentionId'>> = {},
): IngestionJobItemOutcome => ({
  id: `item_${String(index + 1).padStart(3, '0')}`,
  status,
  reasonCode,
  reason,
  ...extra,
  platform: draft.platform,
  sourceType: draft.sourceType,
  sourceId: draft.sourceId ?? null,
  sourceUrl: draft.sourceUrl ?? null,
  title: draft.title ?? null,
  textPreview: textPreview(draft),
  authorName: authorName(draft),
  publishedAt: draft.publishedAt ?? null,
  relevanceScore: draft.preIngestionReview?.relevanceScore ?? null,
  reviewSource: draft.preIngestionReview?.source ?? null,
  sentiment: draft.preIngestionReview?.sentiment ?? null,
  metrics: draft.metrics ?? {},
});

const buildItemOutcomes = (
  reviewedItems: Array<{ draft: ReviewedMentionDraft; kept: boolean }>,
  persistenceOutcomes: DraftPersistenceOutcome[],
): IngestionJobItemOutcome[] => {
  const persistedByDraft = new Map<ReviewedMentionDraft, DraftPersistenceOutcome>();
  for (const outcome of persistenceOutcomes) persistedByDraft.set(outcome.draft, outcome);
  return reviewedItems.map((item, index) => {
    const persisted = persistedByDraft.get(item.draft);
    if (persisted) {
      return buildOutcome(item.draft, index, persisted.status, persisted.reasonCode, persisted.reason, {
        mentionId: persisted.mentionId ?? null,
        duplicateOfMentionId: persisted.duplicateOfMentionId ?? null,
      });
    }
    if (!item.kept) return buildOutcome(item.draft, index, 'skipped', 'irrelevant', skippedByReviewReason(item.draft.preIngestionReview));
    return buildOutcome(item.draft, index, 'skipped', 'processing_error', 'Skipped because the item was kept by review but was not persisted.');
  });
};

const normalizeMediaAssets = (media: MentionMediaAsset[], createdAt: string): MentionMediaAsset[] => {
  const seen = new Set<string>();
  const normalized: MentionMediaAsset[] = [];
  for (const asset of media) {
    if (!asset.sourceUrl || seen.has(asset.sourceUrl)) continue;
    seen.add(asset.sourceUrl);
    normalized.push({
      ...asset,
      id: asset.id || newId('media'),
      status: 'queued',
      error: null,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return normalized.slice(0, 6);
};

const recordUsage = (connector: Connector, jobId: string, requestCount: number) => {
  const id = newId('use');
  store.put('connectorUsageEvents', id, {
    id, tenantId: connector.tenantId, connectorId: connector.id, ingestionJobId: jobId,
    requestCount, estimatedCostUsd: 0, actualCostUsd: 0, endpoint: null,
    createdAt: now(),
  });
  store.put('connectors', connector.id, {
    ...connector,
    currentMonthRequests: connector.currentMonthRequests + requestCount,
    lastHealthCheckAt: now(), lastHealthMessage: 'ok',
    updatedAt: now(),
  });
};

const finalize = (
  jobId: string,
  status: IngestionJob['status'],
  patch: Partial<Pick<IngestionJob, 'fetchedCount' | 'insertedCount' | 'skippedCount' | 'errorCount'>> & { errorMessage?: string; metadata?: Record<string, unknown> },
) => {
  const job = store.get('ingestionJobs', jobId);
  if (!job) return;
  store.put('ingestionJobs', jobId, {
    ...job, status, finishedAt: now(),
    fetchedCount: patch.fetchedCount ?? job.fetchedCount,
    insertedCount: patch.insertedCount ?? job.insertedCount,
    skippedCount: patch.skippedCount ?? job.skippedCount,
    errorCount: patch.errorCount ?? job.errorCount,
    metadata: { ...job.metadata, ...(patch.metadata ?? {}), ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}) },
  });
};
