// TikTok connector.
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleTikTokMentions } from './ensembledata.js';
import { fetchSocialWebSearchMentions, paidSocialApiAllowed, shouldUseSocialWebSearchFirst } from './socialWebSearch.js';

export const tiktokConnector: SourceConnector = {
  platform: 'tiktok',
  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) return ensembleDataHealth('TikTok');
    return { ok: false, status: 'not_configured', message: 'Source is not configured.' };
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (shouldUseSocialWebSearchFirst(ctx)) {
      const drafts = await fetchSocialWebSearchMentions(ctx, 'tiktok');
      if (drafts.length > 0 || !paidSocialApiAllowed(ctx)) return drafts;
    }
    if (!ensembleDataConfigured() || !paidSocialApiAllowed(ctx)) return [];
    return fetchEnsembleTikTokMentions(ctx);
  },
};
