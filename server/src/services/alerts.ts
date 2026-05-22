// Alert rule evaluator — runs on demand or per ingestion job completion.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import type { AlertEvent, AlertRule, Mention, RiskEvent } from '../types.js';

const now = () => new Date().toISOString();

export const evaluateAlerts = (tenantId: string, topicId?: string): AlertEvent[] => {
  const rules = store.list('alertRules').filter((r: any) => r.tenantId === tenantId && r.enabled) as AlertRule[];
  const events: AlertEvent[] = [];
  for (const rule of rules) {
    if (topicId && rule.topicId && rule.topicId !== topicId) continue;
    const scope = rule.topicId ?? topicId;
    if (rule.type === 'volume_spike') events.push(...evalVolumeSpike(rule, scope));
    if (rule.type === 'negative_sentiment_spike') events.push(...evalNegativeSpike(rule, scope));
    if (rule.type === 'risk_event') events.push(...evalRiskEvent(rule, scope));
    if (rule.type === 'keyword') events.push(...evalKeyword(rule, scope));
  }
  return events;
};

const persist = (e: AlertEvent): AlertEvent => {
  store.put('alertEvents', e.id, e);
  return e;
};

const recent = (m: Mention, windowMin: number): boolean => {
  const t = new Date(m.publishedAt ?? m.collectedAt).getTime();
  return Date.now() - t < windowMin * 60_000;
};

const evalVolumeSpike = (rule: AlertRule, topicId?: string): AlertEvent[] => {
  const cfg = rule.config as { windowMin?: number; threshold?: number };
  const win = cfg.windowMin ?? 60;
  const thr = cfg.threshold ?? 20;
  const list = (store.list('mentions') as Mention[]).filter((m) =>
    m.tenantId === rule.tenantId && (!topicId || m.topicId === topicId) && recent(m, win));
  if (list.length < thr) return [];
  return [persist({
    id: newId('alert'), tenantId: rule.tenantId, alertRuleId: rule.id, topicId: topicId ?? null,
    title: `Volume spike: ${list.length} mentions in ${win}m`,
    message: `Threshold ${thr} exceeded for rule "${rule.name}".`,
    severity: rule.severity ?? 'medium',
    evidence: list.slice(0, 5).map((m) => ({ mentionId: m.id, text: m.text.slice(0, 200) })),
    status: 'new', triggeredAt: now(),
  })];
};

const evalNegativeSpike = (rule: AlertRule, topicId?: string): AlertEvent[] => {
  const cfg = rule.config as { windowMin?: number; minShare?: number; minMentions?: number };
  const win = cfg.windowMin ?? 60;
  const list = (store.list('mentions') as Mention[]).filter((m) =>
    m.tenantId === rule.tenantId && (!topicId || m.topicId === topicId) && recent(m, win));
  if (list.length < (cfg.minMentions ?? 10)) return [];
  const negShare = list.filter((m) => m.nlp.sentiment === 'negative').length / list.length;
  if (negShare < (cfg.minShare ?? 0.5)) return [];
  return [persist({
    id: newId('alert'), tenantId: rule.tenantId, alertRuleId: rule.id, topicId: topicId ?? null,
    title: `Negative sentiment spike: ${Math.round(negShare * 100)}%`,
    message: `${list.length} mentions in last ${win}m, ${Math.round(negShare * 100)}% negative.`,
    severity: rule.severity ?? 'high',
    evidence: list.filter((m) => m.nlp.sentiment === 'negative').slice(0, 5).map((m) => ({ mentionId: m.id, text: m.text.slice(0, 200) })),
    status: 'new', triggeredAt: now(),
  })];
};

const evalRiskEvent = (rule: AlertRule, topicId?: string): AlertEvent[] => {
  const cfg = rule.config as { minSeverity?: 'low' | 'medium' | 'high' | 'critical' };
  const rank = { low: 1, medium: 2, high: 3, critical: 4 };
  const min = rank[cfg.minSeverity ?? 'high'];
  const risks = (store.list('riskEvents') as RiskEvent[]).filter((r) =>
    r.tenantId === rule.tenantId && (!topicId || r.topicId === topicId) && rank[r.severity] >= min);
  return risks.map((r) => persist({
    id: newId('alert'), tenantId: rule.tenantId, alertRuleId: rule.id, topicId: r.topicId,
    title: `Risk event: ${r.title}`,
    message: `${r.severity.toUpperCase()} risk detected (score ${r.score}).`,
    severity: r.severity,
    evidence: r.evidenceMentionIds.slice(0, 5).map((mid) => {
      const m = store.get('mentions', mid);
      return { mentionId: mid, text: m?.text?.slice(0, 200) ?? '' };
    }),
    status: 'new', triggeredAt: now(),
  }));
};

const evalKeyword = (rule: AlertRule, topicId?: string): AlertEvent[] => {
  const cfg = rule.config as { keywords?: string[]; windowMin?: number };
  const kws = (cfg.keywords ?? []).map((k) => k.toLowerCase());
  if (!kws.length) return [];
  const win = cfg.windowMin ?? 60;
  const list = (store.list('mentions') as Mention[]).filter((m) =>
    m.tenantId === rule.tenantId && (!topicId || m.topicId === topicId) &&
    recent(m, win) && kws.some((k) => m.text.toLowerCase().includes(k)));
  if (!list.length) return [];
  return [persist({
    id: newId('alert'), tenantId: rule.tenantId, alertRuleId: rule.id, topicId: topicId ?? null,
    title: `Keyword alert: ${kws.join(', ')}`,
    message: `${list.length} mentions matched in last ${win}m.`,
    severity: rule.severity ?? 'medium',
    evidence: list.slice(0, 5).map((m) => ({ mentionId: m.id, text: m.text.slice(0, 200) })),
    status: 'new', triggeredAt: now(),
  })];
};
