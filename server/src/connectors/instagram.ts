// Instagram Graph API. Owned business/creator accounts only.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleInstagramMentions } from './ensembledata.js';

const testOfficialInstagram = async (): Promise<ConnectorHealth> => {
  if (!config.instagram.accessToken) return { ok: false, status: 'not_configured', message: 'Set INSTAGRAM_ACCESS_TOKEN or ENSEMBLEDATA_TOKEN' };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${config.instagram.accessToken}`);
    if (!r.ok) return { ok: false, status: 'failed', message: `IG HTTP ${r.status}` };
    return { ok: true, status: 'active', message: 'Instagram official Graph API reachable (owned media only)' };
  } catch (e) {
    return { ok: false, status: 'failed', message: (e as Error).message };
  }
};

const fetchOfficialInstagramMentions = async (ctx: IngestionContext): Promise<CanonicalMentionDraft[]> => {
  if (!config.instagram.accessToken) return [];
  const configured = ctx.connectorConfig ?? {};
  const igUserId = typeof configured.instagramUserId === 'string' ? configured.instagramUserId : 'me';
  const url = `https://graph.facebook.com/v20.0/${igUserId}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&limit=${Math.min(25, ctx.maxItems)}&access_token=${config.instagram.accessToken}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data: any = await r.json();
  const drafts: CanonicalMentionDraft[] = [];
  for (const m of data.data ?? []) {
    drafts.push({
      topicId: ctx.topicId, platform: 'instagram', sourceType: 'social_post',
      sourceId: m.id, sourceUrl: m.permalink, sourceUrlHash: sha256(m.permalink ?? m.id),
      title: null, text: m.caption ?? '', language: null,
      author: { username: igUserId },
      publishedAt: m.timestamp ?? null,
      metrics: {
        likes: m.like_count ?? 0, comments: m.comments_count ?? 0,
        engagementTotal: (m.like_count ?? 0) + (m.comments_count ?? 0),
      },
    });
    if (drafts.length >= ctx.maxItems) break;
  }
  return drafts;
};

export const instagramConnector: SourceConnector = {
  platform: 'instagram',
  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) {
      const ensemble = await ensembleDataHealth('Instagram');
      if (ensemble.ok || !config.instagram.accessToken) return ensemble;
      const official = await testOfficialInstagram();
      if (official.ok) return { ...official, message: `${ensemble.message}; official Instagram fallback reachable` };
      return ensemble;
    }
    return testOfficialInstagram();
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (ensembleDataConfigured()) {
      try {
        const drafts = await fetchEnsembleInstagramMentions(ctx);
        if (drafts.length > 0 || !config.instagram.accessToken) return drafts;
      } catch (error) {
        if (!config.instagram.accessToken) throw error;
      }
    }
    return fetchOfficialInstagramMentions(ctx);
  },
};
