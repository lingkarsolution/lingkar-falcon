// Naive narrative clustering using Jaccard similarity on mention text.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import { jaccard, topKeywords } from '../lib/nlp.js';
import type { IssueCluster, Mention } from '../types.js';

const now = () => new Date().toISOString();

export const clusterTopic = (tenantId: string, topicId: string, threshold = 0.25, maxClusters = 10): IssueCluster[] => {
  const mentions = store.list('mentions').filter((m: any) =>
    m.tenantId === tenantId && m.topicId === topicId && !m.quality.isIrrelevant,
  ) as Mention[];

  const clusters: Array<{ centroid: Mention; members: Mention[] }> = [];
  for (const m of mentions) {
    let assigned = false;
    for (const c of clusters) {
      if (jaccard(c.centroid.text, m.text) >= threshold) {
        c.members.push(m);
        assigned = true;
        break;
      }
    }
    if (!assigned && clusters.length < maxClusters * 2) {
      clusters.push({ centroid: m, members: [m] });
    }
  }

  // Remove previous clusters for this topic
  for (const c of store.list('issueClusters').filter((x: any) => x.tenantId === tenantId && x.topicId === topicId) as IssueCluster[]) {
    store.delete('issueClusters', c.id);
  }

  const out: IssueCluster[] = [];
  for (const c of clusters.sort((a, b) => b.members.length - a.members.length).slice(0, maxClusters)) {
    const kws = topKeywords(c.members.map((m) => m.text), 4);
    const title = kws.length ? kws.join(' / ') : c.centroid.text.slice(0, 60);
    const sentCount = { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 };
    let engagement = 0, reach = 0;
    for (const m of c.members) {
      sentCount[m.nlp.sentiment]++;
      engagement += m.metrics.engagementTotal ?? 0;
      reach += m.metrics.reachEstimate ?? 0;
    }
    const dominant = (Object.entries(sentCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral') as IssueCluster['sentiment'];
    const id = newId('cluster');
    const issueCluster: IssueCluster = {
      id, tenantId, topicId,
      title, summary: c.centroid.text.slice(0, 240),
      sentiment: dominant, trendDirection: 'flat',
      mentionCount: c.members.length, engagementTotal: engagement, reachEstimate: reach,
      confidence: Math.min(1, c.members.length / 5),
      status: 'active',
      sampleMentionIds: c.members.slice(0, 5).map((m) => m.id),
      createdAt: now(), updatedAt: now(),
    };
    store.put('issueClusters', id, issueCluster);
    out.push(issueCluster);
  }
  return out;
};
