// HTML reports (v0.1). User prints to PDF client-side.
import { store } from '../db/store.js';
import { newId } from '../lib/crypto.js';
import { blobEnabled, uploadText } from '../lib/blob.js';
import { dashboardSummary, listMentionsForTopic, sentimentDistribution, platformDistribution, topEntities } from './analytics.js';
import type { Report, Topic, RiskEvent } from '../types.js';

const now = () => new Date().toISOString();

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const generateTopicReport = async (params: {
  tenantId: string; topicId: string; title?: string;
  dateFrom?: string; dateTo?: string; requestedBy?: string | null;
}): Promise<Report> => {
  const topic = store.get('topics', params.topicId) as Topic | undefined;
  if (!topic) throw new Error('Topic not found');
  const id = newId('rep');
  const report: Report = {
    id, tenantId: params.tenantId, topicId: params.topicId,
    reportType: 'topic_summary', title: params.title ?? `Report: ${topic.title}`,
    status: 'running', dateFrom: params.dateFrom ?? null, dateTo: params.dateTo ?? null,
    fileUrl: null, errorMessage: null, sections: ['summary', 'sentiment', 'platforms', 'entities', 'risk_events'],
    format: 'html',
    requestedBy: params.requestedBy ?? null,
    createdAt: now(),
  };
  store.put('reports', id, report);

  const mentions = listMentionsForTopic(params.tenantId, params.topicId, { from: params.dateFrom, to: params.dateTo });
  const sentDist = sentimentDistribution(mentions);
  const platDist = platformDistribution(mentions);
  const entities = topEntities(mentions, 10);
  const summary = dashboardSummary(params.tenantId, [params.topicId]);
  const risks = (store.list('riskEvents') as RiskEvent[]).filter((r) => r.tenantId === params.tenantId && r.topicId === params.topicId);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; color: #18181b; max-width: 880px; margin: auto; }
  h1 { font-size: 32px; margin-bottom: 4px; } h2 { font-size: 20px; margin-top: 32px; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px; }
  .meta { color: #71717a; margin-bottom: 32px; } .grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; }
  .card { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; }
  .stat { font-size: 24px; font-weight: 600; } .label { color: #71717a; font-size: 12px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; } td, th { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e4e4e7; font-size: 14px; }
  .risk-critical { color: #b91c1c; } .risk-high { color: #c2410c; } .risk-medium { color: #b45309; } .risk-low { color: #65a30d; }
  .sentiment-positive { color: #16a34a; } .sentiment-negative { color: #dc2626; } .sentiment-neutral { color: #71717a; } .sentiment-mixed { color: #ca8a04; }
</style></head><body>
  <h1>${esc(report.title)}</h1>
  <div class="meta">Topic: ${esc(topic.title)} · Generated ${new Date().toLocaleString()} ${params.dateFrom ? `· From ${esc(params.dateFrom)}` : ''} ${params.dateTo ? `· To ${esc(params.dateTo)}` : ''}</div>

  <h2>Summary</h2>
  <div class="grid">
    <div class="card"><div class="label">Total Mentions</div><div class="stat">${summary.totalMentions}</div></div>
    <div class="card"><div class="label">Last 24h</div><div class="stat">${summary.last24h}</div></div>
    <div class="card"><div class="label">Last 7d</div><div class="stat">${summary.last7d}</div></div>
    <div class="card"><div class="label">Risk Events</div><div class="stat">${risks.length}</div></div>
  </div>

  <h2>Sentiment Distribution</h2>
  <table><tr>${Object.entries(sentDist).map(([k, v]) => `<th class="sentiment-${k}">${esc(k)}</th>`).join('')}</tr>
  <tr>${Object.values(sentDist).map((v) => `<td>${v}</td>`).join('')}</tr></table>

  <h2>Platform Distribution</h2>
  <table><tr><th>Platform</th><th>Count</th></tr>
  ${Object.entries(platDist).map(([p, c]) => `<tr><td>${esc(p)}</td><td>${c}</td></tr>`).join('')}
  </table>

  <h2>Top Entities</h2>
  <table><tr><th>Entity</th><th>Type</th><th>Count</th></tr>
  ${entities.map((e) => `<tr><td>${esc(e.entity)}</td><td>${esc(e.type)}</td><td>${e.count}</td></tr>`).join('')}
  </table>

  <h2>Risk Events</h2>
  ${risks.length === 0 ? '<p>None detected.</p>' :
    `<table><tr><th>Code</th><th>Title</th><th>Severity</th><th>Score</th><th>Category</th></tr>
    ${risks.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.title)}</td><td class="risk-${r.severity}">${esc(r.severity)}</td><td>${r.score}</td><td>${esc(r.category)}</td></tr>`).join('')}
    </table>`}

  <h2>Methodology</h2>
  <p style="color:#71717a;font-size:13px">
    Mentions collected from configured connectors. Sentiment and entities derived by rule-based NLP (v0.1).
    All AI-generated content references source mentions as evidence. Data window: ${esc(params.dateFrom ?? 'all')} to ${esc(params.dateTo ?? 'now')}.
  </p>
</body></html>`;

  const final: Report = {
    ...report, status: 'completed', htmlContent: html,
    fileUrl: `/api/v1/reports/${id}/download`, finishedAt: now(),
  };

  // Best-effort upload to Azure Blob if SAS configured
  if (blobEnabled()) {
    try {
      const blobName = `reports/${params.tenantId}/${id}.html`;
      const signed = await uploadText(blobName, html, 'text/html; charset=utf-8');
      if (signed) final.fileUrl = signed;
    } catch (e) {
      console.warn('[reports] blob upload failed:', (e as Error).message);
    }
  }

  store.put('reports', id, final);
  return final;
};
