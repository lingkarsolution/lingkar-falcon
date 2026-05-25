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
import type { PreIngestionReviewedItem, PreIngestionReviewStreamEvent } from './preIngestionReview.js';
import { enqueueMediaEnrichment } from './mediaEnrichment.js';
import { topicExcludeTerms, topicIncludeTerms } from './topicBriefContext.js';
import type { CanonicalMentionDraft } from '../connectors/types.js';
import type {
  Connector, IngestionJob, IngestionJobItemOutcome, IngestionJobItemOutcomeReasonCode, IngestionJobItemOutcomeStatus, IngestionJobProgress, IngestionJobProgressItem, IngestionJobType, Mention, MentionMediaAsset, Platform, Topic,
} from '../types.js';

const now = () => new Date().toISOString();
const ENSEMBLE_PAGINATED_PLATFORMS = new Set<Platform>(['youtube', 'tiktok', 'instagram', 'x']);
const ENSEMBLE_RETRIEVAL_LIMIT = 100;

type DraftPersistenceOutcome = {
  draft: ReviewedMentionDraft;
  status: IngestionJobItemOutcomeStatus;
  reasonCode: Extract<IngestionJobItemOutcomeReasonCode, 'stored' | 'duplicate' | 'irrelevant'>;
  reason: string;
  mentionId?: string | null;
  duplicateOfMentionId?: string | null;
};

const isEnsemblePaginatedConnector = (connector: Connector): boolean =>
  ENSEMBLE_PAGINATED_PLATFORMS.has(connector.platform) && (connector.mode === 'paid_api' || String(connector.name ?? '').toLowerCase().includes('ensembledata'));

const progressItemPreview = (draft: CanonicalMentionDraft | ReviewedMentionDraft): Pick<IngestionJobProgressItem, 'title' | 'textPreview'> => {
  const text = [draft.title, draft.text].map((value) => value?.trim()).filter(Boolean).join(' - ').replace(/\s+/g, ' ');
  return { title: draft.title ?? null, textPreview: text ? text.slice(0, 240) : null };
};

const progressItemFromDraft = (draft: CanonicalMentionDraft | ReviewedMentionDraft, index: number, status: IngestionJobProgressItem['status'], reason?: string | null): IngestionJobProgressItem => ({
  id: draft.sourceId ?? draft.sourceUrlHash ?? `candidate_${index + 1}`,
  platform: draft.platform,
  sourceType: draft.sourceType,
  sourceUrl: draft.sourceUrl ?? null,
  status,
  reason: reason ?? (draft as ReviewedMentionDraft).preIngestionReview?.reason ?? null,
  relevanceScore: (draft as ReviewedMentionDraft).preIngestionReview?.relevanceScore ?? null,
  reviewSource: (draft as ReviewedMentionDraft).preIngestionReview?.source ?? null,
  ...progressItemPreview(draft),
});

const progressFor = (job: IngestionJob, connector: Connector, maxItemsPerSource: number, retrievedLimit: number): IngestionJobProgress => {
  const existing = job.metadata?.ingestionProgress as IngestionJobProgress | undefined;
  return existing ?? {
    stage: 'queued',
    platform: connector.platform,
    currentPage: 0,
    maxItemsPerSource,
    retrievedLimit,
    retrievedCount: 0,
    processedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    storedCount: 0,
    duplicateCount: 0,
    currentItems: [],
    batches: [],
    updatedAt: now(),
  };
};

const updateProgress = (jobId: string, connector: Connector, maxItemsPerSource: number, retrievedLimit: number, patch: Partial<IngestionJobProgress>) => {
  const job = store.get('ingestionJobs', jobId) as IngestionJob | undefined;
  if (!job) return;
  const current = progressFor(job, connector, maxItemsPerSource, retrievedLimit);
  store.put('ingestionJobs', jobId, {
    ...job,
    metadata: {
      ...job.metadata,
      ingestionProgress: {
        ...current,
        ...patch,
        batches: patch.batches ?? current.batches,
        currentItems: patch.currentItems ?? current.currentItems,
        updatedAt: now(),
      },
    },
  });
};

const updateLlmStream = (jobId: string, connector: Connector, maxItemsPerSource: number, retrievedLimit: number, event: PreIngestionReviewStreamEvent) => {
  const job = store.get('ingestionJobs', jobId) as IngestionJob | undefined;
  const progress = job?.metadata?.ingestionProgress as IngestionJobProgress | undefined;
  updateProgress(jobId, connector, maxItemsPerSource, retrievedLimit, {
    llmStream: {
      status: event.status,
      phase: 'pre_ingestion_review',
      title: event.status === 'fallback' ? 'Heuristic relevance review' : 'Streaming pre-ingestion AI review',
      batch: event.batch,
      totalBatches: event.totalBatches,
      candidates: event.candidates,
      text: event.text,
      error: event.error ?? null,
      startedAt: progress?.llmStream?.startedAt ?? now(),
      updatedAt: now(),
    },
  });
};

const failedLlmStream = (job: IngestionJob | undefined, message: string): IngestionJobProgress['llmStream'] => {
  const progress = job?.metadata?.ingestionProgress as IngestionJobProgress | undefined;
  const existing = progress?.llmStream;
  return {
    status: 'failed',
    phase: existing?.phase ?? 'pre_ingestion_review',
    title: existing?.title ?? 'Collection failed before AI review',
    batch: existing?.batch ?? 0,
    totalBatches: existing?.totalBatches ?? 0,
    candidates: existing?.candidates ?? 0,
    text: existing?.text ?? '',
    error: message,
    startedAt: existing?.startedAt ?? now(),
    updatedAt: now(),
  };
};

const updateFailedProgress = (jobId: string, connector: Connector, maxItemsPerSource: number, retrievedLimit: number, message: string) => {
  const latestJob = store.get('ingestionJobs', jobId) as IngestionJob | undefined;
  updateProgress(jobId, connector, maxItemsPerSource, retrievedLimit, { stage: 'failed', llmStream: failedLlmStream(latestJob, message) });
};

const draftKey = (draft: CanonicalMentionDraft): string =>
  draft.sourceUrlHash ?? draft.sourceUrl ?? `${draft.platform}:${draft.sourceId ?? ''}:${(draft.text ?? draft.title ?? '').slice(0, 160)}`;

const cleanTextValue = (value?: string | null): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const isMissingTextValue = (value?: string | null): boolean => {
  const text = cleanTextValue(value);
  return !text || /^(unknown|unknown author|n\/a)$/i.test(text);
};

const finiteMetric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const firstFiniteMetric = (metrics: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = finiteMetric(metrics[key]);
    if (value !== null) return value;
  }
  return null;
};

const mergeAuthor = (current: Mention['author'], incoming: CanonicalMentionDraft['author']): { author: Mention['author']; changed: boolean } => {
  if (!incoming) return { author: current ?? null, changed: false };
  const next = { ...(current ?? {}) } as NonNullable<Mention['author']>;
  let changed = false;
  const applyText = (key: 'id' | 'username' | 'displayName' | 'profileUrl') => {
    const value = cleanTextValue(incoming[key]);
    if (value && isMissingTextValue(next[key])) {
      next[key] = value;
      changed = true;
    }
  };
  applyText('id');
  applyText('username');
  applyText('displayName');
  applyText('profileUrl');
  if (typeof incoming.followersCount === 'number' && Number.isFinite(incoming.followersCount)) {
    if (typeof next.followersCount !== 'number' || next.followersCount <= 0 || incoming.followersCount > next.followersCount) {
      next.followersCount = incoming.followersCount;
      changed = true;
    }
  }
  if (incoming.verified === true && next.verified !== true) {
    next.verified = true;
    changed = true;
  } else if (typeof incoming.verified === 'boolean' && next.verified == null) {
    next.verified = incoming.verified;
    changed = true;
  }
  return { author: Object.keys(next).length > 0 ? next : null, changed };
};

const mergeMetrics = (current: Mention['metrics'] | undefined, incoming: CanonicalMentionDraft['metrics'] | undefined): { metrics: Mention['metrics']; changed: boolean } => {
  const next = { ...(current ?? {}) } as Mention['metrics'];
  if (!incoming) {
    const engagementTotal = computeEngagementTotal(next);
    return { metrics: { ...next, engagementTotal }, changed: next.engagementTotal !== engagementTotal };
  }
  const incomingMetrics = incoming as Record<string, unknown>;
  let changed = false;
  const metricSources: Array<[keyof Mention['metrics'], string[]]> = [
    ['views', ['views', 'viewCount']],
    ['likes', ['likes', 'likeCount']],
    ['comments', ['comments', 'commentCount']],
    ['shares', ['shares', 'shareCount']],
    ['reposts', ['reposts']],
    ['quotes', ['quotes']],
    ['saves', ['saves']],
    ['reachEstimate', ['reachEstimate']],
  ];
  for (const [key, aliases] of metricSources) {
    const incomingValue = firstFiniteMetric(incomingMetrics, aliases);
    if (incomingValue === null) continue;
    const currentValue = finiteMetric(next[key]);
    if (currentValue === null || currentValue <= 0 || incomingValue > currentValue) {
      next[key] = incomingValue;
      changed = true;
    }
  }
  const engagementTotal = computeEngagementTotal(next);
  if (next.engagementTotal !== engagementTotal) {
    next.engagementTotal = engagementTotal;
    changed = true;
  }
  return { metrics: next, changed };
};

const mergeMedia = (current: MentionMediaAsset[] | undefined, incoming: MentionMediaAsset[] | undefined, collectedAt: string, status: MentionMediaAsset['status']): { media: MentionMediaAsset[] | undefined; added: number } => {
  const existing = [...(current ?? [])];
  const seen = new Set(existing.map((asset) => asset.sourceUrl).filter(Boolean));
  const additions = normalizeMediaAssets(incoming ?? [], collectedAt, status).filter((asset) => !seen.has(asset.sourceUrl));
  if (additions.length === 0) return { media: current, added: 0 };
  return { media: [...existing, ...additions].slice(0, 6), added: additions.length };
};

const refreshExistingMentionFromDraft = (mentionId: string, item: PreIngestionReviewedItem): { updated: boolean; mediaAdded: number } => {
  const existing = store.get('mentions', mentionId) as Mention | undefined;
  if (!existing) return { updated: false, mediaAdded: 0 };
  const draft = item.draft;
  const collectedAt = now();
  const author = mergeAuthor(existing.author ?? null, draft.author);
  const metrics = mergeMetrics(existing.metrics, draft.metrics);
  const media = mergeMedia(existing.media, draft.media, collectedAt, item.kept ? 'queued' : 'skipped');
  let updated: Mention = existing;
  let changed = false;
  const review = draft.preIngestionReview;
  if (author.changed) {
    updated = { ...updated, author: author.author };
    changed = true;
  }
  if (metrics.changed) {
    updated = { ...updated, metrics: metrics.metrics };
    changed = true;
  }
  if (media.added > 0) {
    updated = { ...updated, media: media.media };
    changed = true;
  }
  if (!updated.title && draft.title) {
    updated = { ...updated, title: draft.title };
    changed = true;
  }
  if (!updated.publishedAt && draft.publishedAt) {
    updated = { ...updated, publishedAt: draft.publishedAt };
    changed = true;
  }
  if (!updated.sourceId && draft.sourceId) {
    updated = { ...updated, sourceId: draft.sourceId };
    changed = true;
  }
  if (review) {
    const nextQuality = {
      ...updated.quality,
      isIrrelevant: item.kept ? false : updated.quality.isIrrelevant,
      relevanceScore: Math.max(updated.quality.relevanceScore ?? 0, review.relevanceScore),
      reviewSource: review.source,
      reviewReason: review.reason ?? updated.quality.reviewReason ?? null,
      rejectionReason: item.kept ? null : updated.quality.rejectionReason ?? skippedByReviewReason(review),
    };
    if (JSON.stringify(nextQuality) !== JSON.stringify(updated.quality)) {
      updated = { ...updated, quality: nextQuality };
      changed = true;
    }
  }
  if (!changed) return { updated: false, mediaAdded: 0 };
  store.put('mentions', mentionId, { ...updated, updatedAt: collectedAt });
  return { updated: true, mediaAdded: media.added };
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
    fetchedCount: 0, insertedCount: 0, acceptedCount: 0, rejectedCount: 0, skippedCount: 0, errorCount: 0,
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
  await store.flush();
  if (!params.runInline) setImmediate(() => { void runIngestionJob(id); });
  return job;
};

export const runIngestionJob = async (jobId: string): Promise<void> => {
  const job = store.get('ingestionJobs', jobId);
  if (!job) return;
  // Re-check status: another caller may have cancelled this queued job before we picked it up.
  if (job.status === 'cancelled') return;
  const topic = store.get('topics', job.topicId);
  const connector = store.get('connectors', job.connectorId) as Connector | undefined;
  if (!topic || !connector) {
    finalize(jobId, 'failed', { errorMessage: 'Topic or connector not found', errorCount: 1 });
    await store.flush();
    return;
  }
  if (!connector.enabled || connector.status === 'disabled' || connector.status === 'budget_exceeded') {
    const errorMessage = `Connector ${connector.platform} is ${connector.status}`;
    const maxItems = Number((job.metadata as any)?.maxItems ?? 50);
    updateFailedProgress(jobId, connector, maxItems, isEnsemblePaginatedConnector(connector) ? ENSEMBLE_RETRIEVAL_LIMIT : maxItems, errorMessage);
    finalize(jobId, 'failed', { errorMessage, errorCount: 1 });
    await store.flush();
    return;
  }
  const impl = getConnector(connector.platform);
  if (!impl) {
    const errorMessage = `No connector implementation for ${connector.platform}`;
    const maxItems = Number((job.metadata as any)?.maxItems ?? 50);
    updateFailedProgress(jobId, connector, maxItems, isEnsemblePaginatedConnector(connector) ? ENSEMBLE_RETRIEVAL_LIMIT : maxItems, errorMessage);
    finalize(jobId, 'failed', { errorMessage, errorCount: 1 });
    await store.flush();
    return;
  }

  store.put('ingestionJobs', jobId, { ...job, status: 'running', startedAt: now() });
  await store.flush();
  const maxItems = Number((job.metadata as any)?.maxItems ?? 50);
  const ensemblePaginated = isEnsemblePaginatedConnector(connector);
  const retrievalLimit = ensemblePaginated ? ENSEMBLE_RETRIEVAL_LIMIT : maxItems;
  let retrievedTotal = 0;
  let acceptedTotal = 0;
  let rejectedTotal = 0;
  let insertedTotal = 0;
  let skippedTotal = 0;
  let errorTotal = 0;
  try {
    const days = Number((job.metadata as any)?.days ?? (connector.config as any)?.historicalDays ?? (connector.config as any)?.timespanDays ?? 30);
    const pageSize = ensemblePaginated ? Math.min(maxItems, retrievalLimit) : maxItems;
    const dateFrom = (job.metadata as any)?.dateFrom
      ?? (Number.isFinite(days) && days > 0 ? new Date(Date.now() - Math.min(90, days) * 24 * 3600_000).toISOString() : undefined);
    const dateTo = (job.metadata as any)?.dateTo;
    const itemOutcomes: IngestionJobItemOutcome[] = [];
    const preReviewSummary = { llmEnabled: false, requested: 0, kept: 0, rejected: 0, failed: 0, errors: [] as string[] };
    const geoResults: Array<Awaited<ReturnType<typeof enrichMentionsGeo>>> = [];
    const sentimentResults: Array<Awaited<ReturnType<typeof analyzeMentionsSentimentBulk>>> = [];
    const seenRunDrafts = new Set<string>();
    const batches: IngestionJobProgress['batches'] = [];

    updateProgress(jobId, connector, maxItems, retrievalLimit, { stage: 'queued', maxItemsPerSource: maxItems, retrievedLimit: retrievalLimit });

    for (let page = 1; ; page++) {
      const remainingRetrieval = retrievalLimit - retrievedTotal;
      const batchLimit = ensemblePaginated ? Math.min(pageSize, remainingRetrieval) : maxItems;
      if (batchLimit <= 0) break;
      const batchStartedAt = now();
      updateProgress(jobId, connector, maxItems, retrievalLimit, {
        stage: 'fetching', currentPage: page, retrievedCount: retrievedTotal, processedCount: preReviewSummary.requested,
        acceptedCount: acceptedTotal, rejectedCount: rejectedTotal, storedCount: insertedTotal, duplicateCount: skippedTotal,
        batches, currentItems: [],
      });
      const drafts = await impl.fetchMentions({
        tenantId: topic.tenantId, topicId: topic.id, connectorId: connector.id, jobId,
        keywords: topic.keywords, excludeKeywords: topic.excludeKeywords,
        languages: topic.languages, regions: topic.regions,
        dateFrom, dateTo,
        maxItems: batchLimit,
        pageOffset: ensemblePaginated ? retrievedTotal : 0,
        pageSize: batchLimit,
        rawLimit: retrievalLimit,
        connectorConfig: { ...(connector.config ?? {}), ...(job.metadata ?? {}), ensemblePagination: ensemblePaginated, pageOffset: ensemblePaginated ? retrievedTotal : 0, pageSize: batchLimit, rawLimit: retrievalLimit },
      });
      retrievedTotal += drafts.length;
      const uniqueDrafts = drafts.filter((draft) => {
        const key = draftKey(draft);
        if (seenRunDrafts.has(key)) return false;
        seenRunDrafts.add(key);
        return true;
      });
      updateProgress(jobId, connector, maxItems, retrievalLimit, {
        stage: 'reviewing', currentPage: page, retrievedCount: retrievedTotal,
        currentItems: uniqueDrafts.map((draft, index) => progressItemFromDraft(draft, index, 'reviewing')),
      });
      if (uniqueDrafts.length === 0) {
        batches.push({ page, requested: batchLimit, retrieved: drafts.length, processed: 0, accepted: 0, rejected: 0, stored: 0, duplicates: 0, startedAt: batchStartedAt, finishedAt: now() });
        if (!ensemblePaginated || drafts.length === 0 || drafts.length < batchLimit) break;
        continue;
      }
      const preReview = await reviewDraftsBeforeIngestion(topic, uniqueDrafts, {
        onLlmStream: (event) => updateLlmStream(jobId, connector, maxItems, retrievalLimit, event),
      });
      preReviewSummary.llmEnabled = preReview.llmEnabled;
      preReviewSummary.requested += preReview.requested;
      preReviewSummary.kept += preReview.kept;
      preReviewSummary.rejected += preReview.rejected;
      preReviewSummary.failed += preReview.failed;
      preReviewSummary.errors.push(...preReview.errors);
      acceptedTotal += preReview.kept;
      rejectedTotal += preReview.rejected;
      updateProgress(jobId, connector, maxItems, retrievalLimit, {
        stage: 'persisting', currentPage: page, processedCount: preReviewSummary.requested,
        acceptedCount: acceptedTotal, rejectedCount: rejectedTotal,
        currentItems: preReview.items.map((item, index) => progressItemFromDraft(item.draft, index, item.kept ? 'accepted' : 'rejected', item.review.reason)),
      });
      const result = ingestReviewedItems(topic, preReview.items);
      itemOutcomes.push(...buildItemOutcomes(preReview.items, result.outcomes, itemOutcomes.length));
      insertedTotal += result.inserted;
      skippedTotal += result.skipped;
      errorTotal += result.processingErrors;
      await store.flush();

      let geoResult: Awaited<ReturnType<typeof enrichMentionsGeo>> | null = null;
      let sentimentResult: Awaited<ReturnType<typeof analyzeMentionsSentimentBulk>> | null = null;
      updateProgress(jobId, connector, maxItems, retrievalLimit, { stage: 'enriching', storedCount: insertedTotal, duplicateCount: skippedTotal });
      if (result.relevantInsertedIds.length > 0) {
        geoResult = await enrichMentionsGeo({ tenantId: topic.tenantId, topicId: topic.id, mentionIds: result.relevantInsertedIds });
        geoResults.push(geoResult);
      }
      if (result.needsSentimentIds.length > 0) {
        sentimentResult = await analyzeMentionsSentimentBulk({ tenantId: topic.tenantId, topicId: topic.id, mentionIds: result.needsSentimentIds });
        sentimentResults.push(sentimentResult);
      }
      if (result.mediaMentionIds.length > 0) enqueueMediaEnrichment(topic.tenantId, result.mediaMentionIds);

      const batch = { page, requested: batchLimit, retrieved: drafts.length, processed: preReview.requested, accepted: preReview.kept, rejected: preReview.rejected, stored: result.inserted, duplicates: result.skipped, startedAt: batchStartedAt, finishedAt: now() };
      batches.push(batch);
      updateProgress(jobId, connector, maxItems, retrievalLimit, {
        stage: ensemblePaginated && acceptedTotal < maxItems && retrievedTotal < retrievalLimit ? 'fetching' : 'completed',
        currentPage: page, retrievedCount: retrievedTotal, processedCount: preReviewSummary.requested,
        acceptedCount: acceptedTotal, rejectedCount: rejectedTotal, storedCount: insertedTotal, duplicateCount: skippedTotal,
        batches,
        currentItems: itemOutcomes.slice(-Math.max(preReview.items.length, 1)).map((item) => ({
          id: item.id, platform: item.platform, sourceType: item.sourceType, title: item.title ?? null, textPreview: item.textPreview ?? null,
          sourceUrl: item.sourceUrl ?? null, status: item.reasonCode === 'duplicate' ? 'duplicate' : item.reasonCode === 'irrelevant' ? 'rejected' : 'stored',
          reason: item.reason, relevanceScore: item.relevanceScore ?? null, reviewSource: item.reviewSource ?? null,
        })),
      });
      await store.flush();
      if (!ensemblePaginated) break;
      if (acceptedTotal >= maxItems) break;
      if (retrievedTotal >= retrievalLimit) break;
      if (drafts.length < batchLimit) break;
    }

    recordUsage(connector, jobId, retrievedTotal);
    updateProgress(jobId, connector, maxItems, retrievalLimit, {
      stage: 'completed', retrievedCount: retrievedTotal, processedCount: preReviewSummary.requested,
      acceptedCount: acceptedTotal, rejectedCount: rejectedTotal, storedCount: insertedTotal, duplicateCount: skippedTotal,
      batches,
    });
    finalize(jobId, 'completed', {
      fetchedCount: retrievedTotal,
      insertedCount: insertedTotal,
      acceptedCount: acceptedTotal,
      rejectedCount: rejectedTotal,
      skippedCount: skippedTotal,
      errorCount: errorTotal,
      metadata: { itemOutcomes, ensemblePagination: { enabled: ensemblePaginated, retrievalLimit, maxItemsPerSource: maxItems, accepted: acceptedTotal, retrieved: retrievedTotal }, preIngestionReview: preReviewSummary, ...(geoResults.length ? { geo: geoResults } : {}), ...(sentimentResults.length ? { sentiment: sentimentResults } : {}) },
    });
    await store.flush();
  } catch (e) {
    const err = e as Error;
    const errId = newId('jerr');
    store.put('ingestionJobErrors', errId, {
      id: errId, tenantId: job.tenantId, ingestionJobId: jobId,
      errorCode: null, message: err.message, rawContext: null, createdAt: now(),
    });
    updateFailedProgress(jobId, connector, maxItems, retrievalLimit, err.message);
    finalize(jobId, 'failed', {
      fetchedCount: retrievedTotal,
      insertedCount: insertedTotal,
      acceptedCount: acceptedTotal,
      rejectedCount: rejectedTotal,
      skippedCount: skippedTotal,
      errorCount: errorTotal + 1,
      errorMessage: err.message,
    });
    await store.flush();
  }
};

export const recoverInterruptedIngestionJobs = (): number => {
  let recovered = 0;
  for (const job of store.list('ingestionJobs') as IngestionJob[]) {
    if (job.status !== 'queued' && job.status !== 'running') continue;
    const message = job.status === 'running'
      ? 'Ingestion was interrupted before completion, most likely because the server stopped or restarted while the job was running. Start a new collection run to retry.'
      : 'Ingestion was queued but no worker is attached after server startup. Start a new collection run to retry.';
    const connector = store.get('connectors', job.connectorId) as Connector | undefined;
    if (connector) {
      const maxItems = Number((job.metadata as any)?.maxItems ?? 50);
      updateFailedProgress(job.id, connector, maxItems, isEnsemblePaginatedConnector(connector) ? ENSEMBLE_RETRIEVAL_LIMIT : maxItems, message);
    }
    const errId = newId('jerr');
    store.put('ingestionJobErrors', errId, {
      id: errId, tenantId: job.tenantId, ingestionJobId: job.id,
      errorCode: 'INTERRUPTED', message, rawContext: null, createdAt: now(),
    });
    finalize(job.id, 'failed', { errorCount: Math.max(1, job.errorCount), errorMessage: message });
    recovered++;
  }
  return recovered;
};

const ingestReviewedItems = (topic: Topic, items: PreIngestionReviewedItem[]): { inserted: number; skipped: number; processingErrors: number; relevantInsertedIds: string[]; needsSentimentIds: string[]; mediaMentionIds: string[]; mediaAssetCount: number; outcomes: DraftPersistenceOutcome[] } => {
  // Dedupe via sourceUrlHash within topic
  const existingHashes = new Map(
    store.list('mentions')
      .filter((m: any) => m.topicId === topic.id && m.sourceUrlHash)
      .map((m: any) => [m.sourceUrlHash, m.id] as const),
  );
  let inserted = 0, skipped = 0, processingErrors = 0;
  const relevantInsertedIds: string[] = [];
  const needsSentimentIds: string[] = [];
  const mediaMentionIds: string[] = [];
  const outcomes: DraftPersistenceOutcome[] = [];
  let mediaAssetCount = 0;
  for (const item of items) {
    const draft = item.draft;
    const kept = item.kept;
    if (draft.sourceUrlHash && existingHashes.has(draft.sourceUrlHash)) {
      const duplicateOfMentionId = existingHashes.get(draft.sourceUrlHash) ?? null;
      const refresh = duplicateOfMentionId ? refreshExistingMentionFromDraft(duplicateOfMentionId, item) : { updated: false, mediaAdded: 0 };
      if (duplicateOfMentionId && kept && refresh.mediaAdded > 0) {
        mediaMentionIds.push(duplicateOfMentionId);
        mediaAssetCount += refresh.mediaAdded;
      }
      skipped++;
      outcomes.push({
        draft,
        status: 'skipped',
        reasonCode: 'duplicate',
        reason: refresh.updated
          ? 'Skipped because this source was already stored for this topic. Refreshed the existing mention with newer author, metric, or media data.'
          : 'Skipped because this source was already stored for this topic.',
        duplicateOfMentionId,
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
    const media = normalizeMediaAssets(draft.media ?? [], collectedAt, kept ? 'queued' : 'skipped');
    const finalSentiment = review?.sentiment && review.sentiment !== 'unknown' ? review.sentiment : sent.sentiment;
    const finalConfidence = review?.sentimentConfidence ?? sent.confidence;
    const relevanceScore = review?.relevanceScore ?? computeRelevanceScore(text, topicIncludeTerms(topic), topicExcludeTerms(topic));
    const rejectionReason = kept ? null : skippedByReviewReason(review);
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
        isDuplicate: false, isIrrelevant: !kept,
        relevanceScore,
        automationLikelihood: computeAutomationLikelihood(text, metrics),
        sourceReliability: 0.7,
        reviewSource: review?.source ?? 'heuristic',
        reviewReason: review?.reason ?? null,
        rejectionReason,
      },
      createdAt: collectedAt, updatedAt: collectedAt,
    };
    store.put('mentions', id, mention);
    if (draft.sourceUrlHash) existingHashes.set(draft.sourceUrlHash, id);
    inserted++;
    if (kept) relevantInsertedIds.push(id);
    outcomes.push({
      draft,
      status: 'inserted',
      reasonCode: kept ? 'stored' : 'irrelevant',
      reason: kept ? insertedReason(review) : `Stored as rejected evidence. ${rejectionReason ?? 'Rejected by pre-ingestion relevance review.'}`,
      mentionId: id,
    });
    if (kept && media.length > 0) {
      mediaMentionIds.push(id);
      mediaAssetCount += media.length;
    }
    if (kept && review?.source !== 'llm') needsSentimentIds.push(id);
  }
  return { inserted, skipped, processingErrors, relevantInsertedIds, needsSentimentIds, mediaMentionIds, mediaAssetCount, outcomes };
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
  startIndex = 0,
): IngestionJobItemOutcome[] => {
  const persistedByDraft = new Map<ReviewedMentionDraft, DraftPersistenceOutcome>();
  for (const outcome of persistenceOutcomes) persistedByDraft.set(outcome.draft, outcome);
  return reviewedItems.map((item, index) => {
    const persisted = persistedByDraft.get(item.draft);
    if (persisted) {
      return buildOutcome(item.draft, startIndex + index, persisted.status, persisted.reasonCode, persisted.reason, {
        mentionId: persisted.mentionId ?? null,
        duplicateOfMentionId: persisted.duplicateOfMentionId ?? null,
      });
    }
    if (!item.kept) return buildOutcome(item.draft, startIndex + index, 'skipped', 'irrelevant', skippedByReviewReason(item.draft.preIngestionReview));
    return buildOutcome(item.draft, startIndex + index, 'skipped', 'processing_error', 'Skipped because the item was kept by review but was not persisted.');
  });
};

const normalizeMediaAssets = (media: MentionMediaAsset[], createdAt: string, status: MentionMediaAsset['status'] = 'queued'): MentionMediaAsset[] => {
  const seen = new Set<string>();
  const normalized: MentionMediaAsset[] = [];
  for (const asset of media) {
    if (!asset.sourceUrl || seen.has(asset.sourceUrl)) continue;
    seen.add(asset.sourceUrl);
    normalized.push({
      ...asset,
      id: asset.id || newId('media'),
      status,
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
  patch: Partial<Pick<IngestionJob, 'fetchedCount' | 'insertedCount' | 'acceptedCount' | 'rejectedCount' | 'skippedCount' | 'errorCount'>> & { errorMessage?: string; metadata?: Record<string, unknown> },
) => {
  const job = store.get('ingestionJobs', jobId);
  if (!job) return;
  store.put('ingestionJobs', jobId, {
    ...job, status, finishedAt: now(),
    fetchedCount: patch.fetchedCount ?? job.fetchedCount,
    insertedCount: patch.insertedCount ?? job.insertedCount,
    acceptedCount: patch.acceptedCount ?? job.acceptedCount ?? 0,
    rejectedCount: patch.rejectedCount ?? job.rejectedCount ?? 0,
    skippedCount: patch.skippedCount ?? job.skippedCount,
    errorCount: patch.errorCount ?? job.errorCount,
    metadata: { ...job.metadata, ...(patch.metadata ?? {}), ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}) },
  });
};
