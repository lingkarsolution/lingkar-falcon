// Ingestion service: runs a connector, enriches NLP, dedupes, persists, accounts usage.
import { store } from '../db/store.js';
import { getConnector } from '../connectors/registry.js';
import { newId } from '../lib/crypto.js';
import {
  analyzeSentiment, computeAutomationLikelihood, computeEngagementTotal,
  computeRelevanceScore, detectEmotions, detectIntent, detectLanguage, extractEntities,
} from '../lib/nlp.js';
import type {
  Connector, IngestionJob, IngestionJobType, Mention, Topic,
} from '../types.js';

const now = () => new Date().toISOString();

export const enqueueIngestion = async (params: {
  tenantId: string; topicId: string; connectorId: string;
  jobType: IngestionJobType; requestedBy?: string | null;
  maxItems?: number;
}): Promise<IngestionJob> => {
  const id = newId('job');
  const job: IngestionJob = {
    id, tenantId: params.tenantId, topicId: params.topicId,
    connectorId: params.connectorId, jobType: params.jobType,
    status: 'queued', requestedBy: params.requestedBy ?? null,
    startedAt: null, finishedAt: null,
    fetchedCount: 0, insertedCount: 0, skippedCount: 0, errorCount: 0,
    metadata: { maxItems: params.maxItems ?? 50 },
    createdAt: now(),
  };
  store.put('ingestionJobs', id, job);
  // Run async (non-blocking)
  setImmediate(() => { void runJob(id); });
  return job;
};

const runJob = async (jobId: string): Promise<void> => {
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
    const drafts = await impl.fetchMentions({
      tenantId: topic.tenantId, topicId: topic.id, connectorId: connector.id, jobId,
      keywords: topic.keywords, excludeKeywords: topic.excludeKeywords,
      languages: topic.languages, regions: topic.regions,
      maxItems,
      connectorConfig: connector.config ?? {},
    });
    const result = ingestDrafts(topic, drafts);
    recordUsage(connector, jobId, drafts.length);
    finalize(jobId, 'completed', {
      fetchedCount: drafts.length,
      insertedCount: result.inserted,
      skippedCount: result.skipped,
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

const ingestDrafts = (topic: Topic, drafts: any[]): { inserted: number; skipped: number } => {
  // Dedupe via sourceUrlHash within topic
  const existingHashes = new Set(
    store.list('mentions').filter((m: any) => m.topicId === topic.id).map((m: any) => m.sourceUrlHash),
  );
  let inserted = 0, skipped = 0;
  for (const d of drafts) {
    if (d.sourceUrlHash && existingHashes.has(d.sourceUrlHash)) { skipped++; continue; }
    const text = d.text ?? '';
    const sent = analyzeSentiment(text);
    const lang = d.language ?? detectLanguage(text);
    const entities = extractEntities(text);
    const metrics = { ...(d.metrics ?? {}) };
    metrics.engagementTotal = computeEngagementTotal(metrics);
    const id = newId('mention');
    const collectedAt = now();
    const mention: Mention = {
      id, tenantId: topic.tenantId, topicId: topic.id,
      platform: d.platform, sourceType: d.sourceType,
      sourceId: d.sourceId ?? null, sourceUrl: d.sourceUrl ?? null, sourceUrlHash: d.sourceUrlHash ?? null,
      title: d.title ?? null, text, language: lang,
      author: d.author ?? null,
      publishedAt: d.publishedAt ?? null, collectedAt,
      metrics,
      nlp: {
        sentiment: sent.sentiment, sentimentConfidence: sent.confidence,
        emotions: detectEmotions(text), intent: detectIntent(text),
        entities, topics: [], summary: null,
      },
      quality: {
        isDuplicate: false, isIrrelevant: false,
        relevanceScore: computeRelevanceScore(text, topic.keywords, topic.excludeKeywords),
        automationLikelihood: computeAutomationLikelihood(text, metrics),
        sourceReliability: 0.7,
      },
      createdAt: collectedAt, updatedAt: collectedAt,
    };
    store.put('mentions', id, mention);
    if (d.sourceUrlHash) existingHashes.add(d.sourceUrlHash);
    inserted++;
  }
  return { inserted, skipped };
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
  patch: Partial<Pick<IngestionJob, 'fetchedCount' | 'insertedCount' | 'skippedCount' | 'errorCount'>> & { errorMessage?: string },
) => {
  const job = store.get('ingestionJobs', jobId);
  if (!job) return;
  store.put('ingestionJobs', jobId, {
    ...job, status, finishedAt: now(),
    fetchedCount: patch.fetchedCount ?? job.fetchedCount,
    insertedCount: patch.insertedCount ?? job.insertedCount,
    skippedCount: patch.skippedCount ?? job.skippedCount,
    errorCount: patch.errorCount ?? job.errorCount,
    metadata: { ...job.metadata, ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}) },
  });
};
