// RSS/Atom connector with curated default feeds + keyword filtering.
import { XMLParser } from 'fast-xml-parser';
import { sha256 } from '../lib/crypto.js';
import { cache } from '../lib/cache.js';
import type { SourceConnector, CanonicalMentionDraft, IngestionContext, ConnectorHealth } from './types.js';

const DEFAULT_FEEDS = [
  'https://hnrss.org/frontpage',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://www.reutersagency.com/feed/?best-topics=top-news&post_type=best',
  'https://feeds.npr.org/1004/rss.xml',
  'https://rss.tempo.co/nasional',
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export const rssConnector: SourceConnector = {
  platform: 'rss',

  async testConnection(): Promise<ConnectorHealth> {
    try {
      const r = await fetch(DEFAULT_FEEDS[0]!);
      if (!r.ok) return { ok: false, status: 'failed', message: 'Source request failed.' };
      return { ok: true, status: 'active', message: 'RSS source reachable.' };
    } catch (e) {
      return { ok: false, status: 'failed', message: `Source request failed: ${(e as Error).message}` };
    }
  },

  async fetchMentions(ctx: IngestionContext): Promise<CanonicalMentionDraft[]> {
    const feeds = ((ctx as any).feeds as string[]) || DEFAULT_FEEDS;
    const lowerKws = ctx.keywords.map((k) => k.toLowerCase());
    const excludeKws = ctx.excludeKeywords.map((k) => k.toLowerCase());
    const drafts: CanonicalMentionDraft[] = [];

    for (const feedUrl of feeds) {
      try {
        const key = `rss:${sha256(feedUrl)}`;
        let xml = cache.get<string>(key);
        if (!xml) {
          const r = await fetch(feedUrl);
          if (!r.ok) continue;
          xml = await r.text();
          cache.set(key, xml, 900);
        }
        const parsed = parser.parse(xml);
        const items: any[] =
          parsed?.rss?.channel?.item ??
          parsed?.feed?.entry ?? [];
        const arr = Array.isArray(items) ? items : [items];
        for (const it of arr) {
          if (!it) continue;
          const link = String(it.link?.['@_href'] ?? it.link ?? it.guid ?? '');
          const title = String(it.title ?? '');
          const desc = String(it.description ?? it.summary ?? it['content:encoded'] ?? '');
          const fullText = `${title}\n${stripHtml(desc)}`.trim();
          if (!link) continue;

          const lower = fullText.toLowerCase();
          if (excludeKws.some((e) => e && lower.includes(e))) continue;
          if (lowerKws.length > 0 && !lowerKws.some((k) => k && lower.includes(k))) continue;

          drafts.push({
            topicId: ctx.topicId,
            platform: 'rss', sourceType: 'rss_item',
            sourceId: link, sourceUrl: link, sourceUrlHash: sha256(link),
            title, text: fullText, language: null,
            author: { displayName: it['dc:creator'] ?? null },
            publishedAt: parseRssDate(it.pubDate ?? it.published ?? it.updated),
            metrics: { engagementTotal: 0 },
          });
          if (drafts.length >= ctx.maxItems) return drafts;
        }
      } catch {
        // tolerate individual feed errors
      }
    }
    return drafts;
  },
};

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const parseRssDate = (s?: string): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};
