// Topic-level analytics aggregations (volume, sentiment, platform mix, top entities).
import { store } from '../db/store.js';
import type { Mention, Sentiment, Platform } from '../types.js';

export type DateRange = { from?: string; to?: string };

const inRange = (iso: string | null | undefined, r: DateRange): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (r.from && t < new Date(r.from).getTime()) return false;
  if (r.to && t > new Date(r.to).getTime()) return false;
  return true;
};

export const listMentionsForTopic = (
  tenantId: string, topicId: string, range: DateRange = {},
): Mention[] =>
  store.list('mentions').filter((m: any) =>
    m.tenantId === tenantId && m.topicId === topicId &&
    (range.from || range.to ? inRange(m.publishedAt ?? m.collectedAt, range) : true),
  ) as Mention[];

export const sentimentDistribution = (mentions: Mention[]) => {
  const out: Record<Sentiment, number> = { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 };
  for (const m of mentions) out[m.nlp.sentiment]++;
  return out;
};

export const platformDistribution = (mentions: Mention[]) => {
  const out: Record<string, number> = {};
  for (const m of mentions) out[m.platform] = (out[m.platform] ?? 0) + 1;
  return out;
};

export const sentimentTimeseries = (mentions: Mention[], bucket: 'hour' | 'day' = 'day') => {
  const buckets = new Map<string, { positive: number; negative: number; neutral: number; mixed: number; unknown: number; total: number }>();
  for (const m of mentions) {
    const t = m.publishedAt ?? m.collectedAt;
    if (!t) continue;
    const d = new Date(t);
    const key = bucket === 'hour'
      ? `${d.toISOString().slice(0, 13)}:00:00Z`
      : d.toISOString().slice(0, 10);
    const b = buckets.get(key) ?? { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0, total: 0 };
    b[m.nlp.sentiment]++;
    b.total++;
    buckets.set(key, b);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => ({ t, ...v }));
};

export const topEntities = (mentions: Mention[], k = 10) => {
  const map = new Map<string, { count: number; type: string; sentiment: Record<Sentiment, number> }>();
  for (const m of mentions) {
    for (const e of m.nlp.entities ?? []) {
      const key = `${e.type}:${(e.normalizedName ?? e.text).toLowerCase()}`;
      const cur = map.get(key) ?? { count: 0, type: e.type, sentiment: { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 } };
      cur.count++;
      cur.sentiment[m.nlp.sentiment]++;
      map.set(key, cur);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, k)
    .map(([key, v]) => ({ entity: key.split(':').slice(1).join(':'), type: v.type, count: v.count, sentiment: v.sentiment }));
};

export const dashboardSummary = (tenantId: string, topicIds?: string[]) => {
  const allMentions = store.list('mentions').filter((m: any) =>
    m.tenantId === tenantId && (topicIds ? topicIds.includes(m.topicId) : true),
  ) as Mention[];

  const last24h = allMentions.filter((m) => {
    const t = m.publishedAt ?? m.collectedAt;
    return t && Date.now() - new Date(t).getTime() < 24 * 3600_000;
  });
  const last7d = allMentions.filter((m) => {
    const t = m.publishedAt ?? m.collectedAt;
    return t && Date.now() - new Date(t).getTime() < 7 * 24 * 3600_000;
  });

  return {
    totalMentions: allMentions.length,
    last24h: last24h.length,
    last7d: last7d.length,
    sentimentBreakdown: sentimentDistribution(allMentions),
    sentiment24h: sentimentDistribution(last24h),
    platform24h: platformDistribution(last24h),
    timeseries7d: sentimentTimeseries(last7d, 'day'),
  };
};
