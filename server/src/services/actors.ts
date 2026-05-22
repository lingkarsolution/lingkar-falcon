// Actor monitoring service — scores risk/opportunity based on linked mentions.
import { store } from '../db/store.js';
import type { Actor, Mention } from '../types.js';

const now = () => new Date().toISOString();

export const refreshActorScores = (actor: Actor): Actor => {
  const mentions = (store.list('mentions') as Mention[]).filter((m) =>
    m.tenantId === actor.tenantId &&
    m.platform === actor.platform &&
    (m.author?.username === actor.username || m.author?.displayName === actor.displayName),
  );
  if (mentions.length === 0) {
    const updated: Actor = { ...actor, lastRefreshedAt: now(), updatedAt: now() };
    store.put('actors', actor.id, updated);
    return updated;
  }
  const neg = mentions.filter((m) => m.nlp.sentiment === 'negative').length / mentions.length;
  const pos = mentions.filter((m) => m.nlp.sentiment === 'positive').length / mentions.length;
  const reach = mentions.reduce((s, m) => s + (m.metrics.reachEstimate ?? 0), 0);
  const automation = mentions.reduce((s, m) => s + (m.quality.automationLikelihood ?? 0), 0) / mentions.length;
  const riskScore = Math.round((0.5 * neg + 0.3 * automation + 0.2 * Math.min(1, reach / 1_000_000)) * 100);
  const opportunityScore = Math.round((0.6 * pos + 0.4 * Math.min(1, reach / 500_000)) * 100);
  const riskLevel = riskScore >= 70 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 30 ? 'moderate' : 'low';
  const oppLevel = opportunityScore >= 70 ? 'excellent' : opportunityScore >= 50 ? 'good' : opportunityScore >= 30 ? 'fair' : 'poor';
  const updated: Actor = {
    ...actor,
    riskScore, riskLevel, opportunityScore, opportunityLevel: oppLevel,
    riskExplanation: `${Math.round(neg * 100)}% negative; ${Math.round(automation * 100)}% automation signals; reach ${reach.toLocaleString()}.`,
    opportunityExplanation: `${Math.round(pos * 100)}% positive sentiment; reach ${reach.toLocaleString()}.`,
    status: 'active', lastRefreshedAt: now(), updatedAt: now(),
  };
  store.put('actors', actor.id, updated);
  return updated;
};
