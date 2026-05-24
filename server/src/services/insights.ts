// AI Insight generation — LLM produces JSON summaries with evidence references.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import { chatCompletion, llmAvailable } from '../commander/llm.js';
import type { Insight, Mention, TopicSentimentStrategy } from '../types.js';

const now = () => new Date().toISOString();

const parseJsonOutput = (content: string): unknown => {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
  throw new Error('LLM returned non-JSON daily brief output');
};

export const generateDailyBrief = async (tenantId: string, topicId: string): Promise<Insight | null> => {
  const topic = store.get('topics', topicId);
  if (!topic) return null;
  const mentions = (store.list('mentions') as Mention[])
    .filter((m) => m.tenantId === tenantId && m.topicId === topicId)
    .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime())
    .slice(0, 25);
  if (mentions.length === 0) return null;

  const evidence = mentions.map((m, i) => `[${i + 1}] (${m.platform}, ${m.nlp.sentiment}) ${m.text.slice(0, 200)}`).join('\n');
  const sys = `You are an analyst producing a daily public-narrative brief. Output STRICT JSON with keys: title, summary, whyItMatters, recommendation, evidenceIndexes (array of [1..N] referencing provided mentions). Be specific, cite evidence, no preamble.`;
  const user = `Topic: ${topic.title}\nKeywords: ${topic.keywords.join(', ')}\n\nMentions:\n${evidence}\n\nWrite the brief now.`;

  let parsed: any = null;
  try {
    const res = await chatCompletion({
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      jsonMode: true,
    });
    const content = res.choices?.[0]?.message?.content ?? '{}';
    parsed = parseJsonOutput(content);
  } catch {
    // LLM unavailable — fallback summary
    parsed = {
      title: `Daily Brief: ${topic.title}`,
      summary: `Activity captured across ${new Set(mentions.map((m) => m.platform)).size} platforms with ${mentions.length} recent mentions. Sentiment skews ${dominantSentiment(mentions)}.`,
      whyItMatters: 'Recent volume suggests ongoing public attention; monitor for escalation.',
      recommendation: 'Review top mentions; assess if any rise to risk-event threshold.',
      evidenceIndexes: mentions.slice(0, 5).map((_, i) => i + 1),
    };
  }

  const evidenceIds = ((parsed.evidenceIndexes as number[]) ?? [])
    .map((i) => mentions[i - 1]?.id)
    .filter(Boolean) as string[];

  const id = newId('ins');
  const insight: Insight = {
    id, tenantId, topicId,
    type: 'daily_brief',
    title: String(parsed.title ?? `Daily Brief: ${topic.title}`),
    summary: String(parsed.summary ?? ''),
    whyItMatters: parsed.whyItMatters ?? null,
    impact: parsed.impact ?? null,
    recommendation: parsed.recommendation ?? null,
    metrics: { mentionsAnalyzed: mentions.length },
    evidenceMentionIds: evidenceIds.length ? evidenceIds : mentions.slice(0, 5).map((m) => m.id),
    confidence: 0.7, generatedBy: 'system',
    generatedAt: now(), createdAt: now(),
  };
  store.put('insights', id, insight);
  return insight;
};

const parseStructuredJson = (content: string): any => parseJsonOutput(content) as any;

const mentionEvidence = (mentions: Mention[], sentiment: string): string[] => mentions
  .filter((mention) => mention.nlp.sentiment === sentiment)
  .slice(0, 5)
  .map((mention) => mention.id);

const latestSentimentStrategyInsight = (tenantId: string, topicId: string): Insight | null => (store.list('insights') as Insight[])
  .filter((insight) => insight.tenantId === tenantId && insight.topicId === topicId && insight.type === 'sentiment_strategy')
  .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0] ?? null;

export const getLatestSentimentStrategy = (tenantId: string, topicId: string): TopicSentimentStrategy | null => {
  const latest = latestSentimentStrategyInsight(tenantId, topicId);
  return latest?.payload as TopicSentimentStrategy | null ?? null;
};

export const generateSentimentStrategy = async (tenantId: string, topicId: string): Promise<TopicSentimentStrategy | null> => {
  const topic: any = store.get('topics', topicId);
  if (!topic) return null;
  const mentions = (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === tenantId && mention.topicId === topicId)
    .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime());
  if (mentions.length === 0) return null;

  const negativeMentions = mentions.filter((mention) => mention.nlp.sentiment === 'negative' || mention.nlp.sentiment === 'mixed');
  const positiveMentions = mentions.filter((mention) => mention.nlp.sentiment === 'positive');
  const neutralMentions = mentions.filter((mention) => mention.nlp.sentiment === 'neutral');
  const evidenceSample = [
    ...negativeMentions.slice(0, 24),
    ...positiveMentions.slice(0, 18),
    ...neutralMentions.slice(0, 12),
  ].slice(0, 60);
  const evidence = evidenceSample.map((mention, index) => `[${index + 1}] id=${mention.id} platform=${mention.platform} sentiment=${mention.nlp.sentiment} author=${mention.author?.displayName ?? mention.author?.username ?? 'unknown'} text=${mention.text.slice(0, 260)}`).join('\n');

  let parsed: any = null;
  if (llmAvailable()) {
    try {
      const response = await chatCompletion({
        temperature: 0.2,
        maxTokens: 2200,
        jsonMode: true,
        messages: [
          {
            role: 'system',
            content: 'You are a senior public relations and civic narrative analyst. Return strict JSON with keys: negative {title, summary, concerns, evidenceIndexes}, positive {title, summary, excitementDrivers, evidenceIndexes}, prStrategy {title, recommendation, actions, tone}. concerns, excitementDrivers, and actions must be arrays of short strings. Be specific and grounded in the provided posts. The PR strategy must counter-react negative sentiment without sounding defensive.',
          },
          {
            role: 'user',
            content: `Topic: ${topic.title}\nKeywords: ${(topic.keywords ?? []).join(', ')}\nCounts: negative/mixed=${negativeMentions.length}, positive=${positiveMentions.length}, neutral=${neutralMentions.length}\n\nPosts:\n${evidence}\n\nSummarize what people are worried about, what people care about or are excited about, and recommend a PR response strategy.`,
          },
        ],
      });
      parsed = parseStructuredJson(response.choices[0]?.message.content ?? '{}');
    } catch {
      parsed = null;
    }
  }

  const strategy: TopicSentimentStrategy = {
    topicId,
    generatedAt: now(),
    mentionsAnalyzed: mentions.length,
    llmEnabled: llmAvailable() && Boolean(parsed),
    negative: {
      title: String(parsed?.negative?.title ?? 'What people are worried about'),
      summary: String(parsed?.negative?.summary ?? (negativeMentions.length ? `Negative discussion appears in ${negativeMentions.length} recent posts. Review source posts for recurring complaints, risk terms, and unresolved questions.` : 'No strong negative discussion is visible in the saved posts yet.')),
      concerns: Array.isArray(parsed?.negative?.concerns) ? parsed.negative.concerns.map(String).slice(0, 5) : ['Check recurring complaints, confusion, allegations, and calls for accountability.'],
      evidenceMentionIds: Array.isArray(parsed?.negative?.evidenceIndexes)
        ? parsed.negative.evidenceIndexes.map((index: number) => evidenceSample[index - 1]?.id).filter(Boolean).slice(0, 6)
        : mentionEvidence(negativeMentions, 'negative'),
    },
    positive: {
      title: String(parsed?.positive?.title ?? 'What people care about or like'),
      summary: String(parsed?.positive?.summary ?? (positiveMentions.length ? `Positive discussion appears in ${positiveMentions.length} recent posts. Look for praise, expectations, and supportive narratives to amplify.` : 'No strong positive discussion is visible in the saved posts yet.')),
      excitementDrivers: Array.isArray(parsed?.positive?.excitementDrivers) ? parsed.positive.excitementDrivers.map(String).slice(0, 5) : ['Identify praise, useful outcomes, trusted voices, and constructive expectations.'],
      evidenceMentionIds: Array.isArray(parsed?.positive?.evidenceIndexes)
        ? parsed.positive.evidenceIndexes.map((index: number) => evidenceSample[index - 1]?.id).filter(Boolean).slice(0, 6)
        : mentionEvidence(positiveMentions, 'positive'),
    },
    prStrategy: {
      title: String(parsed?.prStrategy?.title ?? 'Recommended response strategy'),
      recommendation: String(parsed?.prStrategy?.recommendation ?? 'Acknowledge the core concern directly, publish clear facts, use calm non-defensive language, and pair corrections with concrete next steps.'),
      actions: Array.isArray(parsed?.prStrategy?.actions) ? parsed.prStrategy.actions.map(String).slice(0, 6) : [
        'Acknowledge the concern in plain language.',
        'Clarify facts and timeline with verifiable evidence.',
        'Prepare short responses for repeated claims.',
        'Amplify credible positive voices without attacking critics.',
      ],
      tone: String(parsed?.prStrategy?.tone ?? 'Calm, factual, empathetic, and accountable.'),
    },
  };

  const insight: Insight = {
    id: newId('ins'), tenantId, topicId,
    type: 'sentiment_strategy',
    title: `Sentiment Strategy: ${topic.title}`,
    summary: strategy.prStrategy.recommendation,
    whyItMatters: strategy.negative.summary,
    impact: strategy.positive.summary,
    recommendation: strategy.prStrategy.recommendation,
    metrics: { mentionsAnalyzed: mentions.length, negativeMentions: negativeMentions.length, positiveMentions: positiveMentions.length, neutralMentions: neutralMentions.length },
    evidenceMentionIds: [...strategy.negative.evidenceMentionIds, ...strategy.positive.evidenceMentionIds],
    payload: strategy as unknown as Record<string, unknown>,
    confidence: parsed ? 0.76 : 0.45,
    generatedBy: 'system',
    generatedAt: strategy.generatedAt,
    createdAt: strategy.generatedAt,
  };
  store.put('insights', insight.id, insight);
  return strategy;
};

export const chatAboutTopicSentiment = async (params: {
  tenantId: string;
  topicId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{ answer: string; llmEnabled: boolean; generatedAt: string }> => {
  const topic: any = store.get('topics', params.topicId);
  if (!topic) throw new Error('Topic not found');
  const mentions = (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === params.tenantId && mention.topicId === params.topicId)
    .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime());
  const strategy = getLatestSentimentStrategy(params.tenantId, params.topicId);
  const sentimentCounts = mentions.reduce<Record<string, number>>((counts, mention) => {
    counts[mention.nlp.sentiment] = (counts[mention.nlp.sentiment] ?? 0) + 1;
    return counts;
  }, {});
  const evidence = mentions.slice(0, 50).map((mention, index) => `[${index + 1}] ${mention.platform} ${mention.nlp.sentiment} author=${mention.author?.displayName ?? mention.author?.username ?? 'unknown'} text=${mention.text.slice(0, 240)}`).join('\n');

  if (!llmAvailable()) {
    return {
      answer: 'LLM is not configured yet, so I cannot have a freeform discussion. Set LLM_API_KEY or OPENROUTER_API_KEY, then ask again. Based on the saved data, review the negative posts first, identify repeated concerns, and avoid making a public statement until you can verify the facts and name concrete next steps.',
      llmEnabled: false,
      generatedAt: now(),
    };
  }

  const response = await chatCompletion({
    temperature: 0.35,
    maxTokens: 1800,
    messages: [
      {
        role: 'system',
        content: 'You are a senior PR, public affairs, and social intelligence advisor. Discuss the monitored topic with the user. Be practical, evidence-grounded, and concise. You may draft PR statements, holding statements, action plans, wait/escalate recommendations, talking points, or decision criteria. Do not claim certainty beyond the provided evidence. If asked whether to wait, explain what evidence would justify waiting versus responding now.',
      },
      {
        role: 'user',
        content: `Topic: ${topic.title}\nDescription: ${topic.description ?? ''}\nKeywords: ${(topic.keywords ?? []).join(', ')}\nSentiment counts: ${JSON.stringify(sentimentCounts)}\nLatest strategy summary: ${strategy ? JSON.stringify(strategy).slice(0, 4000) : 'No generated sentiment strategy yet.'}\nRecent evidence posts:\n${evidence || 'No saved posts yet.'}`,
      },
      ...((params.history ?? []).slice(-8).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1500) })) as Array<{ role: 'user' | 'assistant'; content: string }>),
      { role: 'user', content: params.message },
    ],
  });

  return {
    answer: response.choices[0]?.message.content?.trim() || 'I could not generate a response for this topic.',
    llmEnabled: true,
    generatedAt: now(),
  };
};

const dominantSentiment = (mentions: Mention[]): string => {
  const counts: Record<string, number> = {};
  for (const m of mentions) counts[m.nlp.sentiment] = (counts[m.nlp.sentiment] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
};
