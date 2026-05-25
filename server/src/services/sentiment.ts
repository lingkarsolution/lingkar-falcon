import { store } from '../db/store.js';
import { chatCompletion, llmAvailable } from '../commander/llm.js';
import { analyzeSentiment } from '../lib/nlp.js';
import type { Mention, Sentiment, Topic } from '../types.js';
import { topicBriefForLlm } from './topicBriefContext.js';

type SentimentItem = {
  id: string;
  sentiment: Sentiment;
  confidence: number;
  summary?: string | null;
  emotions?: string[];
  intent?: string | null;
};

export type BulkSentimentResult = {
  llmEnabled: boolean;
  requested: number;
  analyzed: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: string[];
};

const SENTIMENTS = new Set<Sentiment>(['positive', 'negative', 'neutral', 'mixed', 'unknown']);
const now = () => new Date().toISOString();

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

const clampConfidence = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.7;
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
  if (objectStart >= 0 && objectEnd > objectStart) {
    try { return JSON.parse(stripped.slice(objectStart, objectEnd + 1)); } catch {}
  }

  const arrayStart = stripped.indexOf('[');
  const arrayEnd = stripped.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(stripped.slice(arrayStart, arrayEnd + 1));
  throw new Error('LLM returned non-JSON sentiment output');
};

const normalizeItems = (parsed: unknown): SentimentItem[] => {
  const rawItems = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.items) ? (parsed as any).items : [];
  return rawItems
    .map((item: any) => ({
      id: String(item.id ?? '').trim(),
      sentiment: normalizeSentiment(item.sentiment),
      confidence: clampConfidence(item.confidence),
      summary: item.summary == null ? null : String(item.summary).slice(0, 500),
      emotions: Array.isArray(item.emotions) ? item.emotions.map(String).slice(0, 5) : undefined,
      intent: item.intent == null ? null : String(item.intent).slice(0, 80),
    }))
    .filter((item: SentimentItem) => item.id && item.sentiment !== 'unknown');
};

export const analyzeMentionsSentimentBulk = async (params: {
  tenantId: string;
  topicId: string;
  mentionIds?: string[];
  limit?: number;
}): Promise<BulkSentimentResult> => {
  const allMentions = (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === params.tenantId && mention.topicId === params.topicId);
  const topic = store.get('topics', params.topicId) as Topic | undefined;
  const selected = params.mentionIds?.length
    ? allMentions.filter((mention) => params.mentionIds!.includes(mention.id))
    : allMentions
      .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime())
      .slice(0, Math.min(250, Math.max(1, params.limit ?? 100)));

  const result: BulkSentimentResult = {
    llmEnabled: llmAvailable(),
    requested: selected.length,
    analyzed: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  if (selected.length === 0) return result;
  if (!llmAvailable()) {
    result.skipped = selected.length;
    result.errors.push('LLM is not configured; retained heuristic sentiment.');
    return result;
  }

  for (const batch of chunks(selected, 20)) {
    const payload = batch.map((mention) => ({
      id: mention.id,
      language: mention.language,
      platform: mention.platform,
      sourceType: mention.sourceType,
      title: mention.title,
      text: mention.text.slice(0, 1200),
      author: mention.author ? {
        username: mention.author.username,
        displayName: mention.author.displayName,
        followersCount: mention.author.followersCount ?? null,
        verified: mention.author.verified ?? null,
      } : null,
      metrics: mention.metrics ?? null,
      geo: mention.geo ?? null,
      quality: mention.quality ?? null,
    }));
    try {
      const response = await chatCompletion({
        temperature: 0,
        maxTokens: 2500,
        jsonMode: true,
        messages: [
          {
            role: 'system',
            content: 'You classify Indonesian and English public-news/social mentions for a monitored topic. Use the complete topic brief object: identity, subject type, monitoring objectives, objective guidance, stakeholder POV, favorable/unfavorable signals, include/exclude rules, source/language/geo scope, audience filters, relevance mode, collection/cost mode, and alert triggers. Sentiment must be from the configured stakeholder POV: positive means favorable for that POV, negative means harmful for that POV, mixed means both, neutral means no clear POV impact. Do not classify by article writing style alone. Mark adverse real-world developments as negative only for the POV they harm; the same event can be positive for a competitor/opposition POV. Use neutral only when the event has no clear positive or negative POV implication. Return only JSON: {"items":[{"id":"...","sentiment":"positive|negative|neutral|mixed","confidence":0.0,"summary":"short evidence-based POV reason that references the relevant brief rule","emotions":["anger"],"intent":"complaint|praise|question|informational|null"}]}',
          },
          { role: 'user', content: JSON.stringify({ topic: topic ? topicBriefForLlm(topic) : null, mentions: payload }) },
        ],
      });
      const content = response.choices[0]?.message.content ?? '{}';
      const items = normalizeItems(parseJson(content));
      const byId = new Map(items.map((item) => [item.id, item]));
      result.analyzed += items.length;

      for (const mention of batch) {
        const item = byId.get(mention.id);
        if (!item) {
          result.failed++;
          continue;
        }
        const heuristic = analyzeSentiment(`${mention.title ?? ''}\n${mention.text}`);
        const finalSentiment = !topic?.monitoringBrief && item.sentiment === 'neutral' && heuristic.sentiment === 'negative'
          ? 'negative'
          : item.sentiment;
        const finalConfidence = finalSentiment !== item.sentiment
          ? Math.max(item.confidence, heuristic.confidence)
          : item.confidence;
        store.put('mentions', mention.id, {
          ...mention,
          nlp: {
            ...mention.nlp,
            sentiment: finalSentiment,
            sentimentConfidence: finalConfidence,
            summary: item.summary ?? mention.nlp.summary ?? null,
            emotions: item.emotions ?? mention.nlp.emotions ?? [],
            intent: item.intent ?? mention.nlp.intent ?? null,
            sentimentSource: 'llm',
            sentimentAnalyzedAt: now(),
          },
          updatedAt: now(),
        });
        result.updated++;
      }
    } catch (error) {
      result.failed += batch.length;
      result.errors.push((error as Error).message);
    }
  }

  return result;
};