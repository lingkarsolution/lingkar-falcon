// AI Insight generation — LLM produces JSON summaries with evidence references.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import { chatCompletion } from '../commander/llm.js';
import type { Insight, Mention } from '../types.js';

const now = () => new Date().toISOString();

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
    parsed = JSON.parse(content);
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

const dominantSentiment = (mentions: Mention[]): string => {
  const counts: Record<string, number> = {};
  for (const m of mentions) counts[m.nlp.sentiment] = (counts[m.nlp.sentiment] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
};
