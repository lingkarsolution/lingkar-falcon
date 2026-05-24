import { chatCompletion, llmAvailable } from '../commander/llm.js';
import type { CanonicalMentionDraft } from '../connectors/types.js';
import { analyzeSentiment, computeRelevanceScore } from '../lib/nlp.js';
import type { Sentiment, Topic } from '../types.js';

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

const topicRelevanceTerms = (topic: Topic): string[] => {
  const terms = new Set<string>();
  const add = (value?: string | null) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized.length >= 2) terms.add(normalized);
  };
  add(topic.title);
  add(topic.category);
  for (const keyword of topic.keywords) add(keyword);
  for (const token of String(topic.description ?? '').split(/[^a-z0-9]+/i)) {
    if (token.length >= 4) add(token);
  }
  return [...terms].slice(0, 40);
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
  const keywordScore = computeRelevanceScore(text, topic.keywords, topic.excludeKeywords);
  const contextScore = computeRelevanceScore(text, topicRelevanceTerms(topic), topic.excludeKeywords);
  const relevanceScore = Math.max(keywordScore, contextScore);
  return {
    related: relevanceScore >= FALLBACK_RELEVANCE_THRESHOLD,
    relevanceScore,
    sentiment: sentiment.sentiment,
    sentimentConfidence: sentiment.confidence,
    summary: null,
    reason: 'Heuristic fallback review because LLM pre-ingestion review was unavailable.',
    source: 'heuristic',
  };
};

const normalizeItems = (parsed: unknown): Map<string, PreIngestionReview> => {
  const rawItems = Array.isArray((parsed as any)?.items) ? (parsed as any).items : [];
  const output = new Map<string, PreIngestionReview>();
  for (const rawItem of rawItems) {
    const itemId = String(rawItem?.id ?? '').trim();
    if (!itemId) continue;
    const relevanceScore = clamp(rawItem?.relevanceScore, rawItem?.related === true ? 0.7 : 0.2);
    const related = Boolean(rawItem?.related) && relevanceScore >= RELEVANCE_THRESHOLD;
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
  const result: PreIngestionReviewResult = {
    llmEnabled: llmAvailable(),
    requested: drafts.length,
    kept: 0,
    rejected: 0,
    failed: 0,
    errors: [],
    items: [],
    drafts: [],
  };
  if (drafts.length === 0) return result;

  if (!llmAvailable()) {
    for (const draft of drafts) {
      const review = heuristicReview(topic, draft);
      const reviewedDraft = { ...draft, preIngestionReview: review };
      result.items.push({ draft: reviewedDraft, kept: review.related, review });
      if (review.related) result.drafts.push(reviewedDraft);
      else result.rejected++;
    }
    result.kept = result.drafts.length;
    result.errors.push('LLM is not configured; used heuristic pre-ingestion relevance filter.');
    return result;
  }

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
            content: 'You are a strict pre-ingestion relevance gate for a social/news intelligence system. Decide whether each candidate is truly about the monitored topic by using the full topic definition: title, description, category, keywords, excluded keywords, languages, and regions. Treat the description as first-class disambiguation context, not optional metadata. Reject ambiguous shared-name results: for example, if topic is "Nobu Bank" and the description says it is a bank or financial institution, reject posts about Nobu games, Nobu restaurants, people named Nobu, or unrelated brands unless the bank/financial institution is clearly the subject. Also classify sentiment toward the monitored topic and write a short evidence-based summary. Return only JSON: {"items":[{"id":"candidate_0","related":true|false,"relevanceScore":0.0,"sentiment":"positive|negative|neutral|mixed|unknown","confidence":0.0,"summary":"short summary if related, otherwise empty","reason":"why kept or rejected"}]}',
          },
          {
            role: 'user',
            content: JSON.stringify({
              topic: {
                title: topic.title,
                description: topic.description?.trim() || null,
                category: topic.category,
                keywords: topic.keywords,
                excludeKeywords: topic.excludeKeywords,
                languages: topic.languages,
                regions: topic.regions,
              },
              candidates: candidates.map((candidate) => candidate.payload),
            }),
          },
        ],
      });
      const reviewedById = normalizeItems(parseJson(response.choices[0]?.message.content ?? '{}'));
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