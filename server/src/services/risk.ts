// Risk event detection from clusters — §16.5 risk_score formula.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import { topKeywords } from '../lib/nlp.js';
import type { IssueCluster, Mention, RiskEvent, RiskSeverity, RiskCategory } from '../types.js';

const now = () => new Date().toISOString();

const NEG_KEYWORDS_RISK_BOOST = ['scandal','corruption','crisis','protest','outrage','attack','crash','fail','accuse','leaked','arrest','korupsi','skandal','krisis','protes','kritik'];
const CATEGORY_HINTS: Array<[string[], RiskCategory]> = [
  [['corruption','scandal','korupsi','skandal','leaked'], 'reputation'],
  [['lawsuit','court','arrest','indict','pidana','hukum'], 'legal'],
  [['budget','loss','deficit','revenue','rugi','anggaran'], 'fiscal'],
  [['outage','downtime','breach','hack','keamanan'], 'security'],
  [['election','party','minister','president','partai','presiden','menteri'], 'political'],
];

const inferCategory = (text: string): RiskCategory => {
  const t = text.toLowerCase();
  for (const [keys, cat] of CATEGORY_HINTS) if (keys.some((k) => t.includes(k))) return cat;
  return 'operational';
};

const computeRiskScore = (cluster: IssueCluster, mentions: Mention[]): number => {
  // S = 0.35*neg_share + 0.25*volume_norm + 0.20*velocity + 0.10*influence + 0.10*amplifier_diversity
  const total = mentions.length || 1;
  const neg = mentions.filter((m) => m.nlp.sentiment === 'negative').length;
  const negShare = neg / total;
  const volumeNorm = Math.min(1, mentions.length / 50);
  // Velocity: ratio of mentions in last 6h vs prior 18h
  const cutoff = Date.now() - 6 * 3600_000;
  const recent = mentions.filter((m) => new Date(m.publishedAt ?? m.collectedAt).getTime() > cutoff).length;
  const velocity = Math.min(1, recent / Math.max(1, total - recent));
  const influence = Math.min(1, mentions.reduce((s, m) => s + (m.metrics.reachEstimate ?? 0), 0) / 1_000_000);
  const distinctAuthors = new Set(mentions.map((m) => m.author?.username ?? m.author?.displayName ?? 'anon')).size;
  const diversity = Math.min(1, distinctAuthors / 20);
  return Math.round((0.35 * negShare + 0.25 * volumeNorm + 0.20 * velocity + 0.10 * influence + 0.10 * diversity) * 100);
};

const severityFor = (score: number): RiskSeverity =>
  score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'low';

export const detectRiskEvents = (tenantId: string, topicId: string): RiskEvent[] => {
  const clusters = store.list('issueClusters').filter((c: any) => c.tenantId === tenantId && c.topicId === topicId) as IssueCluster[];
  const events: RiskEvent[] = [];
  // Clear previous active events
  for (const e of store.list('riskEvents').filter((x: any) => x.tenantId === tenantId && x.topicId === topicId) as RiskEvent[]) {
    store.delete('riskEvents', e.id);
  }
  for (const c of clusters) {
    if (c.sentiment !== 'negative' && c.sentiment !== 'mixed') continue;
    const members = (store.list('mentions') as Mention[]).filter((m) => c.sampleMentionIds.includes(m.id));
    const allMembers = (store.list('mentions') as Mention[]).filter((m) =>
      m.topicId === topicId && c.sampleMentionIds.includes(m.id),
    );
    const mset = allMembers.length ? allMembers : members;
    const score = computeRiskScore(c, mset);
    if (score < 25) continue;
    const id = newId('risk');
    const text = mset.map((m) => m.text).join('\n');
    const kws = topKeywords([text], 3);
    const event: RiskEvent = {
      id, tenantId, topicId, issueClusterId: c.id,
      code: `RISK-${id.slice(-6).toUpperCase()}`,
      title: c.title, summary: c.summary,
      category: inferCategory(text), severity: severityFor(score), sentiment: 'negative',
      score, keyTrigger: kws[0] ?? 'unknown', narrativeTags: kws,
      metrics: { mentions: mset.length, engagementTotal: c.engagementTotal, reachEstimate: c.reachEstimate, velocityScore: score },
      firstSeenAt: now(), lastSeenAt: now(),
      evidenceMentionIds: c.sampleMentionIds, status: 'new',
      createdAt: now(), updatedAt: now(),
    };
    store.put('riskEvents', id, event);
    events.push(event);
  }
  return events;
};
