// TikTok connector.
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleTikTokMentions } from './ensembledata.js';

export const tiktokConnector: SourceConnector = {
  platform: 'tiktok',
  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) return ensembleDataHealth('TikTok');
    return { ok: false, status: 'not_configured', message: 'Source is not configured.' };
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (!ensembleDataConfigured()) return [];
    return fetchEnsembleTikTokMentions(ctx);
  },
};
