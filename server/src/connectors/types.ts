// Shared connector contracts (§11)
import type { Platform, ConnectorStatus, Mention } from '../types.js';

// Re-export for connectors that build mentions directly.
export type CanonicalMentionDraft = Omit<Mention, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'collectedAt' | 'nlp' | 'quality'> & {
  collectedAt?: string;
};

export type ConnectorHealth = {
  ok: boolean;
  status: ConnectorStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type IngestionContext = {
  tenantId: string; topicId: string; connectorId: string; jobId: string;
  keywords: string[]; excludeKeywords: string[];
  languages?: string[]; regions?: string[];
  dateFrom?: string; dateTo?: string;
  maxItems: number;
  connectorConfig?: Record<string, unknown>;
};

export interface SourceConnector {
  platform: Platform;
  testConnection(): Promise<ConnectorHealth>;
  fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]>;
}


