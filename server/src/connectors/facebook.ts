// Facebook connector.
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

export const facebookConnector: SourceConnector = {
  platform: 'facebook',
  async testConnection(): Promise<ConnectorHealth> {
    if (!config.facebook.pageAccessToken) return { ok: false, status: 'not_configured', message: 'Source is not configured.' };
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${config.facebook.pageAccessToken}`);
      if (!r.ok) return { ok: false, status: 'failed', message: 'Source request failed.' };
      return { ok: true, status: 'active', message: 'Facebook source reachable.' };
    } catch (e) {
      return { ok: false, status: 'failed', message: `Source request failed: ${(e as Error).message}` };
    }
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (!config.facebook.pageAccessToken) return [];
    const pageIds: string[] = (ctx as any).facebookPageIds ?? ['me'];
    const drafts: CanonicalMentionDraft[] = [];
    for (const pageId of pageIds) {
      const url = `https://graph.facebook.com/v20.0/${pageId}/posts?fields=id,message,created_time,permalink_url,reactions.summary(true),comments.summary(true),shares&limit=${Math.min(25, ctx.maxItems)}&access_token=${config.facebook.pageAccessToken}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const data: any = await r.json();
      for (const post of data.data ?? []) {
        const link = post.permalink_url ?? `https://facebook.com/${post.id}`;
        drafts.push({
          topicId: ctx.topicId, platform: 'facebook', sourceType: 'social_post',
          sourceId: post.id, sourceUrl: link, sourceUrlHash: sha256(link),
          title: null, text: post.message ?? '', language: null,
          author: { username: pageId, displayName: pageId },
          publishedAt: post.created_time ?? null,
          metrics: {
            likes: post.reactions?.summary?.total_count ?? 0,
            comments: post.comments?.summary?.total_count ?? 0,
            shares: post.shares?.count ?? 0,
            engagementTotal:
              (post.reactions?.summary?.total_count ?? 0) +
              (post.comments?.summary?.total_count ?? 0) +
              (post.shares?.count ?? 0),
          },
        });
        if (drafts.length >= ctx.maxItems) break;
      }
    }
    return drafts;
  },
};
