import { chatCompletion, llmAvailable } from '../commander/llm.js';
import type { CanonicalMentionDraft } from '../connectors/types.js';
import { analyzeSentiment, computeRelevanceScore } from '../lib/nlp.js';
import type { Sentiment, Topic } from '../types.js';
import { topicBriefForLlm, topicExcludeTerms, topicIncludeTerms, topicRelevanceThreshold } from './topicBriefContext.js';

export type PreIngestionReview = {
  related: boolean;
  relevanceScore: number;
  sentiment: Sentiment;
  sentimentConfidence: number;
  summary?: string | null;
  reason?: string | null;
  source: 'llm' | 'heuristic';
};

export type ReviewedMentionDraft = CanonicalMentionDraft & {
  preIngestionReview?: PreIngestionReview;
};

export type PreIngestionReviewedItem = {
  draft: ReviewedMentionDraft;
  kept: boolean;
  review: PreIngestionReview;
};

export type PreIngestionReviewResult = {
  llmEnabled: boolean;
  requested: number;
  kept: number;
  rejected: number;
  failed: number;
  errors: string[];
  items: PreIngestionReviewedItem[];
  drafts: ReviewedMentionDraft[];
};

const REVIEW_BATCH_SIZE = 15;
const RELEVANCE_THRESHOLD = 0.55;
const FALLBACK_RELEVANCE_THRESHOLD = 0.45;
const SENTIMENTS = new Set<Sentiment>(['positive', 'negative', 'neutral', 'mixed', 'unknown']);

const chunks = <T>(items: T[], size: number): T[][] => {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
};

const clamp = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
};

const normalizeSentiment = (value: unknown): Sentiment => {
  const text = String(value ?? '').toLowerCase();
  if (SENTIMENTS.has(text as Sentiment)) return text as Sentiment;
  if (text.includes('posit')) return 'positive';
  if (text.includes('negat')) return 'negative';
  if (text.includes('mix')) return 'mixed';
  if (text.includes('neutral')) return 'neutral';
  return 'unknown';
};

const parseJson = (content: string): unknown => {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const objectStart = stripped.indexOf('{');
  const objectEnd = stripped.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(stripped.slice(objectStart, objectEnd + 1));
  throw new Error('LLM returned non-JSON pre-ingestion review output');
};

const heuristicReview = (topic: Topic, draft: CanonicalMentionDraft): PreIngestionReview => {
  const text = `${draft.title ?? ''}\n${draft.text ?? ''}`;
  const sentiment = analyzeSentiment(text);
  const excludeTerms = topicExcludeTerms(topic);
  const includeTerms = topicIncludeTerms(topic);
  const keywordScore = computeRelevanceScore(text, topic.keywords, excludeTerms);
  const contextScore = computeRelevanceScore(text, includeTerms, excludeTerms);
  const relevanceScore = Math.max(keywordScore, contextScore);
  const threshold = topic.monitoringBrief ? topicRelevanceThreshold(topic) : FALLBACK_RELEVANCE_THRESHOLD;
  return {
    related: relevanceScore >= threshold,
    relevanceScore,
    sentiment: sentiment.sentiment,
    sentimentConfidence: sentiment.confidence,
    summary: null,
    reason: 'Heuristic fallback review because LLM pre-ingestion review was unavailable.',
    source: 'heuristic',
  };
};

const normalizeItems = (parsed: unknown, relevanceThreshold = RELEVANCE_THRESHOLD): Map<string, PreIngestionReview> => {
  const rawItems = Array.isArray((parsed as any)?.items) ? (parsed as any).items : [];
  const output = new Map<string, PreIngestionReview>();
  for (const rawItem of rawItems) {
    const itemId = String(rawItem?.id ?? '').trim();
    if (!itemId) continue;
    const relevanceScore = clamp(rawItem?.relevanceScore, rawItem?.related === true ? 0.7 : 0.2);
    const related = Boolean(rawItem?.related) && relevanceScore >= relevanceThreshold;
    output.set(itemId, {
      related,
      relevanceScore,
      sentiment: normalizeSentiment(rawItem?.sentiment),
      sentimentConfidence: clamp(rawItem?.confidence, 0.75),
      summary: rawItem?.summary == null ? null : String(rawItem.summary).slice(0, 600),
      reason: rawItem?.reason == null ? null : String(rawItem.reason).slice(0, 300),
      source: 'llm',
    });
  }
  return output;
};

export const reviewDraftsBeforeIngestion = async (topic: Topic, drafts: CanonicalMentionDraft[]): Promise<PreIngestionReviewResult> => {
  const aiReviewEnabled = topic.monitoringBrief?.relevance?.aiReviewEnabled ?? true;
  const result: PreIngestionReviewResult = {
    llmEnabled: llmAvailable() && aiReviewEnabled,
    requested: drafts.length,
    kept: 0,
    rejected: 0,
    failed: 0,
    errors: [],
    items: [],
    drafts: [],
  };
  if (drafts.length === 0) return result;

  if (!aiReviewEnabled || !llmAvailable()) {
    for (const draft of drafts) {
      const review = heuristicReview(topic, draft);
      const reviewedDraft = { ...draft, preIngestionReview: review };
      result.items.push({ draft: reviewedDraft, kept: review.related, review });
      if (review.related) result.drafts.push(reviewedDraft);
      else result.rejected++;
    }
    result.kept = result.drafts.length;
    result.errors.push(aiReviewEnabled ? 'LLM is not configured; used heuristic pre-ingestion relevance filter.' : 'AI pre-ingestion review is disabled for this topic; used heuristic relevance filter.');
    return result;
  }

  const relevanceThreshold = topicRelevanceThreshold(topic);

  let globalIndex = 0;
  for (const batch of chunks(drafts, REVIEW_BATCH_SIZE)) {
    const candidates = batch.map((draft) => {
      const id = `candidate_${globalIndex++}`;
      return {
        id,
        draft,
        payload: {
          id,
          platform: draft.platform,
          sourceType: draft.sourceType,
          title: draft.title ?? null,
          text: String(draft.text ?? '').slice(0, 1400),
          author: draft.author ? { username: draft.author.username, displayName: draft.author.displayName } : null,
          publishedAt: draft.publishedAt ?? null,
          sourceUrl: draft.sourceUrl ?? null,
        },
      };
    });

    try {
      const response = await chatCompletion({
        temperature: 0,
        maxTokens: 2600,
        jsonMode: true,
        messages: [
          {
            role: 'system',
            content: 'You are a strict pre-ingestion relevance gate for a social/news intelligence system. Decide whether each candidate is truly about the monitored topic by using the full topic brief object: identity, subject type, monitoring objectives, objective guidance, stakeholder POV, include rules, exact phrases, hashtags, handles, related entities, hard exclude rules, source/language/geo scope, audience rules, collection cost mode, alerts, and relevance mode. Treat description, POV context, objectives, and hard excludes as first-class decision rules. Hard excludes override weak matches. Reject ambiguous shared-name results unless the monitored subject is clearly the subject. Classify sentiment from the configured stakeholder POV when provided: positive means favorable for that POV, negative means harmful for that POV, mixed means both, neutral means no clear POV impact. Return only JSON: {"items":[{"id":"candidate_0","related":true|false,"relevanceScore":0.0,"sentiment":"positive|negative|neutral|mixed|unknown","confidence":0.0,"summary":"short summary if related, otherwise empty","reason":"why kept or rejected with POV/objective evidence"}]}',
          },
          {
            role: 'user',
            content: JSON.stringify({
              topic: topicBriefForLlm(topic),
              relevanceThreshold,
              candidates: candidates.map((candidate) => candidate.payload),
            }),
          },
        ],
      });
      const reviewedById = normalizeItems(parseJson(response.choices[0]?.message.content ?? '{}'), relevanceThreshold);
      for (const candidate of candidates) {
        const review = reviewedById.get(candidate.id) ?? heuristicReview(topic, candidate.draft);
        const reviewedDraft = { ...candidate.draft, preIngestionReview: review };
        if (review.source === 'heuristic') result.failed++;
        result.items.push({ draft: reviewedDraft, kept: review.related, review });
        if (review.related) result.drafts.push(reviewedDraft);
        else result.rejected++;
      }
    } catch (error) {
      result.failed += batch.length;
      result.errors.push((error as Error).message);
      for (const draft of batch) {
        const review = heuristicReview(topic, draft);
        const reviewedDraft = { ...draft, preIngestionReview: review };
        result.items.push({ draft: reviewedDraft, kept: review.related, review });
        if (review.related) result.drafts.push(reviewedDraft);
        else result.rejected++;
      }
    }
  }

  result.kept = result.drafts.length;
  return result;
};