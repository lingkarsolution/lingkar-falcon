// TikTok connector — EnsembleData preferred. Official Research API fallback requires separate approval.
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';
import { ensembleDataConfigured, ensembleDataHealth, fetchEnsembleTikTokMentions } from './ensembledata.js';

export const tiktokConnector: SourceConnector = {
  platform: 'tiktok',
  async testConnection(): Promise<ConnectorHealth> {
    if (ensembleDataConfigured()) return ensembleDataHealth('TikTok');
    return { ok: false, status: 'not_configured', message: 'Set ENSEMBLEDATA_TOKEN. Official TikTok Research API fallback requires separate approval and is not enabled by default.' };
  },
  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    if (!ensembleDataConfigured()) return [];
    return fetchEnsembleTikTokMentions(ctx);
  },
};
