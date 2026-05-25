import type { Connector, Platform } from '../types.js';

export const publicPlatformLabel = (platform: Platform): string => ({
  gdelt: 'News',
  rss: 'RSS',
  web: 'Web search',
  reddit: 'Reddit',
  youtube: 'YouTube',
  x: 'X / Twitter',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  news: 'News',
}[platform] ?? platform);

export const redactInfrastructureText = (message?: string | null): string | null => {
  if (!message) return message ?? null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'ok' || lower.includes('reachable') || lower.includes('web search via')) return 'Source reachable.';
  if (lower.includes('timed out')) return 'Source request timed out.';
  if (lower.includes('not configured') || lower.includes('token is empty') || /set\s+[a-z0-9_]+/i.test(trimmed)) return 'Source is not configured.';
  if (lower.includes('returned no items') || lower.includes('no items') || lower.includes('broad keyword') || lower.includes('does not provide') || lower.includes('does not expose') || lower.includes('does not support')) {
    return 'No items were available for this source with the current query. Try a broader query or configured tracked accounts.';
  }
  if (lower.includes('http') || lower.includes('fetch failed') || lower.includes('error') || lower.includes('failed')) return 'Source request failed.';
  return trimmed
    .replace(/EnsembleData/gi, 'source')
    .replace(/OpenRouter/gi, 'AI service')
    .replace(/NewsAPI(?:\.org)?/gi, 'news source')
    .replace(/Graph API/gi, 'source')
    .replace(/YouTube Data API v3/gi, 'YouTube source')
    .replace(/API\s*v?\d*/gi, 'source')
    .replace(/official\s*(?:source)?/gi, 'configured source')
    .replace(/[A-Z][A-Z0-9_]{3,}/g, 'configuration');
};

export const publicConnector = (connector: Connector) => {
  const { config: _config, ...publicFields } = connector;
  void _config;
  return {
    ...publicFields,
    name: publicPlatformLabel(connector.platform),
    displayName: publicPlatformLabel(connector.platform),
    mode: 'managed',
    lastHealthMessage: redactInfrastructureText(connector.lastHealthMessage),
  };
};
