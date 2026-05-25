// AI Insight generation — LLM produces JSON summaries with evidence references.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import { chatCompletion, llmAvailable } from '../commander/llm.js';
import type { Insight, Mention, Topic, TopicSentimentStrategy } from '../types.js';
import { topicBriefForLlm, topicObjectiveGuidance } from './topicBriefContext.js';

const now = () => new Date().toISOString();

const parseJsonOutput = (content: string): unknown => {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
  throw new Error('LLM returned non-JSON daily brief output');
};

const mentionForLlm = (mention: Mention, index: number) => ({
  index: index + 1,
  id: mention.id,
  platform: mention.platform,
  sourceType: mention.sourceType,
  sentiment: mention.nlp.sentiment,
  sentimentConfidence: mention.nlp.sentimentConfidence ?? null,
  sentimentSource: mention.nlp.sentimentSource ?? null,
  author: mention.author ? {
    username: mention.author.username,
    displayName: mention.author.displayName,
    followersCount: mention.author.followersCount ?? null,
    verified: mention.author.verified ?? null,
  } : null,
  metrics: mention.metrics,
  geo: mention.geo ?? null,
  quality: mention.quality,
  publishedAt: mention.publishedAt ?? mention.collectedAt,
  title: mention.title ?? null,
  text: mention.text.slice(0, 360),
});

export const generateDailyBrief = async (tenantId: string, topicId: string): Promise<Insight | null> => {
  const topic = store.get('topics', topicId) as Topic | undefined;
  if (!topic) return null;
  const mentions = (store.list('mentions') as Mention[])
    .filter((m) => m.tenantId === tenantId && m.topicId === topicId)
    .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime())
    .slice(0, 25);
  if (mentions.length === 0) return null;

  const evidence = mentions.map(mentionForLlm);
  const sys = 'You are an analyst producing a daily public-narrative brief. Use the complete topic brief object, including subject type, monitoring objectives, objective guidance, stakeholder POV, include/exclude rules, geo/audience scope, alert triggers, relevance mode, and collection/cost rules. Interpret sentiment and risk from the configured stakeholder POV. Output STRICT JSON with keys: title, summary, whyItMatters, recommendation, evidenceIndexes (array of 1-based indexes referencing provided mentions). Be specific, cite evidence, no preamble.';
  const user = JSON.stringify({ topic: topicBriefForLlm(topic), mentions: evidence });

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
      whyItMatters: topicObjectiveGuidance(topic)[0] ?? 'Recent volume suggests ongoing public attention; monitor for escalation.',
      recommendation: 'Review top mentions against the configured POV, include/exclude rules, alert triggers, and objective-specific escalation criteria.',
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
  const topic = store.get('topics', topicId) as Topic | undefined;
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
  const evidence = evidenceSample.map(mentionForLlm);

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
            content: 'You are a senior public relations, public affairs, and civic narrative analyst. Use the complete topic brief object: subject type, monitoring objectives, objective guidance, stakeholder POV, favorable/unfavorable signals, include/exclude rules, geo/audience scope, alert triggers, relevance mode, and collection/cost mode. In this output, negative means unfavorable or risky from the configured POV; positive means favorable or useful from that POV. Return strict JSON with keys: negative {title, summary, concerns, evidenceIndexes}, positive {title, summary, excitementDrivers, evidenceIndexes}, prStrategy {title, recommendation, actions, tone}. concerns, excitementDrivers, and actions must be arrays of short strings. Be specific and grounded in the provided posts and the topic brief. The strategy must serve the configured POV and monitoring objectives without sounding defensive.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              topic: topicBriefForLlm(topic),
              counts: { negativeOrMixed: negativeMentions.length, positive: positiveMentions.length, neutral: neutralMentions.length },
              posts: evidence,
              task: 'Summarize what is unfavorable, what is favorable or useful, and recommend a response strategy aligned with the configured POV and objectives.',
            }),
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
  const topic = store.get('topics', params.topicId) as Topic | undefined;
  if (!topic) throw new Error('Topic not found');
  const mentions = (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === params.tenantId && mention.topicId === params.topicId)
    .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime());
  const strategy = getLatestSentimentStrategy(params.tenantId, params.topicId);
  const sentimentCounts = mentions.reduce<Record<string, number>>((counts, mention) => {
    counts[mention.nlp.sentiment] = (counts[mention.nlp.sentiment] ?? 0) + 1;
    return counts;
  }, {});
  const evidence = mentions.slice(0, 50).map(mentionForLlm);

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
        content: 'You are a senior PR, public affairs, and social intelligence advisor. Discuss the monitored topic with the user. You must honor the complete topic brief: subject type, monitoring objectives, objective guidance, stakeholder POV, favorable/unfavorable signals, include/exclude rules, geo/audience scope, alert triggers, relevance mode, and collection/cost mode. Interpret sentiment and recommendations from the configured POV, not generic tone. Be practical, evidence-grounded, and concise. You may draft PR statements, holding statements, action plans, wait/escalate recommendations, talking points, or decision criteria. Do not claim certainty beyond the provided evidence. If asked whether to wait, explain what evidence would justify waiting versus responding now based on the configured objectives and alert triggers.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          topic: topicBriefForLlm(topic),
          sentimentCounts,
          latestStrategy: strategy ?? null,
          recentEvidence: evidence,
        }).slice(0, 9000),
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
