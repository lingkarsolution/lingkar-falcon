import type { Platform } from '../types.js';
import type { SourceConnector } from './types.js';
import { gdeltConnector } from './gdelt.js';
import { rssConnector } from './rss.js';
import { webConnector } from './web.js';
import { redditConnector } from './reddit.js';
import { youtubeConnector } from './youtube.js';
import { xConnector } from './x.js';
import { facebookConnector } from './facebook.js';
import { instagramConnector } from './instagram.js';
import { tiktokConnector } from './tiktok.js';
import { newsConnector } from './news.js';

export const connectorRegistry: Record<Platform, SourceConnector | undefined> = {
  gdelt: gdeltConnector,
  rss: rssConnector,
  web: webConnector,
  reddit: redditConnector,
  youtube: youtubeConnector,
  x: xConnector,
  facebook: facebookConnector,
  instagram: instagramConnector,
  tiktok: tiktokConnector,
  news: newsConnector,
  bluesky: undefined,
  mastodon: undefined,
};

export const getConnector = (platform: Platform): SourceConnector | undefined =>
  connectorRegistry[platform];
