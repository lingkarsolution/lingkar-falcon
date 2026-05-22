// Seed a default tenant, admin user, connectors, and a sample topic w/ mentions
// so the UI is usable on first run with zero API keys configured.
import { config } from '../config.js';
import { store } from './store.js';
import { newId, hashPassword, verifyPassword } from '../lib/crypto.js';
import { analyzeSentiment, computeAutomationLikelihood, computeRelevanceScore, computeEngagementTotal, extractEntities, detectEmotions, detectIntent, detectLanguage } from '../lib/nlp.js';
import type { Connector, Mention, Platform, ConnectorMode, ConnectorStatus } from '../types.js';

const now = () => new Date().toISOString();

const migrateOldDevAdminPassword = async (): Promise<void> => {
  const admin = (store.list('users') as any[]).find((user) => user.email?.toLowerCase() === config.adminEmail.toLowerCase());
  if (!admin || config.adminPassword === 'civicfalcon') return;
  if (!verifyPassword('civicfalcon', admin.passwordHash)) return;
  store.put('users', admin.id, {
    ...admin,
    passwordHash: hashPassword(config.adminPassword),
    updatedAt: now(),
  });
  await store.flush();
};

const connectorDefaults = (): Array<{
  platform: Platform; name: string; mode: ConnectorMode; status: ConnectorStatus;
  enabled: boolean; monthlyBudgetUsd?: number; credentialConfigured?: boolean;
}> => {
  const ensemble = Boolean(config.ensembleData.token);
  const youtube = ensemble || Boolean(config.youtube.apiKey);
  const instagram = ensemble || Boolean(config.instagram.accessToken);
  const facebook = Boolean(config.facebook.pageAccessToken);
  return [
    { platform: 'gdelt', name: 'GDELT (Global news)', mode: 'free', status: 'active', enabled: true },
    { platform: 'rss', name: 'RSS Feeds', mode: 'free', status: 'active', enabled: true },
    { platform: 'web', name: 'Web Search (Brave/DDG/SearXNG)', mode: 'free', status: 'active', enabled: true, monthlyBudgetUsd: 25 },
    { platform: 'reddit', name: 'Reddit Public JSON', mode: 'free', status: 'active', enabled: true },
    { platform: 'youtube', name: 'YouTube (EnsembleData + official fallback)', mode: ensemble ? 'paid_api' : 'official_api', status: youtube ? 'active' : 'not_configured', enabled: youtube, monthlyBudgetUsd: 50, credentialConfigured: youtube },
    { platform: 'x', name: 'X API v2 (paid)', mode: 'paid_api', status: 'not_configured', enabled: false, monthlyBudgetUsd: 100 },
    { platform: 'facebook', name: 'Facebook Pages API (official Graph)', mode: 'official_api', status: facebook ? 'active' : 'not_configured', enabled: facebook, credentialConfigured: facebook },
    { platform: 'instagram', name: 'Instagram (EnsembleData + official fallback)', mode: ensemble ? 'paid_api' : 'official_api', status: instagram ? 'active' : 'not_configured', enabled: instagram, monthlyBudgetUsd: 50, credentialConfigured: instagram },
    { platform: 'tiktok', name: 'TikTok (EnsembleData)', mode: 'paid_api', status: ensemble ? 'active' : 'not_configured', enabled: ensemble, monthlyBudgetUsd: 50, credentialConfigured: ensemble },
  ];
};

const migrateConnectorDefaults = async (): Promise<void> => {
  const defaults = connectorDefaults();
  const tenants = store.list('tenants') as Array<{ id: string }>;
  for (const tenant of tenants) {
    for (const spec of defaults) {
      const existing = (store.list('connectors') as Connector[]).find((connector) => connector.tenantId === tenant.id && connector.platform === spec.platform);
      if (!existing) {
        const id = newId('conn');
        store.put('connectors', id, {
          id, tenantId: tenant.id, platform: spec.platform, name: spec.name,
          mode: spec.mode, status: spec.status, enabled: spec.enabled,
          credentialConfigured: spec.credentialConfigured ?? false,
          rateLimitPerMinute: null, dailyRequestLimit: null,
          monthlyBudgetUsd: spec.monthlyBudgetUsd ?? null,
          currentMonthSpendUsd: 0, currentMonthRequests: 0,
          lastHealthCheckAt: null, lastHealthMessage: null,
          createdAt: now(), updatedAt: now(),
        });
        continue;
      }
      if (!['youtube', 'instagram', 'tiktok'].includes(spec.platform)) continue;
      const wasOldTikTokPlaceholder = existing.platform === 'tiktok' && existing.status === 'disabled';
      const shouldPromote = spec.credentialConfigured || wasOldTikTokPlaceholder;
      if (!shouldPromote) continue;
      store.put('connectors', existing.id, {
        ...existing,
        name: spec.name,
        mode: spec.mode,
        status: spec.status,
        enabled: spec.enabled,
        credentialConfigured: spec.credentialConfigured ?? existing.credentialConfigured,
        monthlyBudgetUsd: existing.monthlyBudgetUsd ?? spec.monthlyBudgetUsd ?? null,
        updatedAt: now(),
      });
    }
  }
  await store.flush();
};

export const seedIfEmpty = async (): Promise<void> => {
  await store.load();
  if (Object.keys(store.data.tenants).length > 0) {
    await migrateOldDevAdminPassword();
    await migrateConnectorDefaults();
    return;
  }

  const tenantId = newId('ten');
  const userId = newId('usr');
  store.put('tenants', tenantId, {
    id: tenantId, name: 'CivicFalcon Demo', slug: 'civicfalcon-demo',
    createdAt: now(), updatedAt: now(),
  });
  store.put('users', userId, {
    id: userId, tenantId, email: config.adminEmail, name: 'Admin',
    role: 'admin', passwordHash: hashPassword(config.adminPassword),
    createdAt: now(), updatedAt: now(),
  });

  const connSpecs = connectorDefaults();

  for (const spec of connSpecs) {
    const id = newId('conn');
    const c: Connector = {
      id, tenantId, platform: spec.platform, name: spec.name,
      mode: spec.mode, status: spec.status, enabled: spec.enabled,
      credentialConfigured: spec.credentialConfigured ?? false,
      rateLimitPerMinute: null, dailyRequestLimit: null,
      monthlyBudgetUsd: spec.monthlyBudgetUsd ?? null,
      currentMonthSpendUsd: 0, currentMonthRequests: 0,
      lastHealthCheckAt: null, lastHealthMessage: null,
      createdAt: now(), updatedAt: now(),
    };
    store.put('connectors', id, c);
  }

  // Sample topic + synthetic mentions for first-run UX
  const topicId = newId('topic');
  store.put('topics', topicId, {
    id: topicId, tenantId,
    title: 'Public Conversation: Economic Policy',
    description: 'Sample topic with synthetic mentions. Replace with your own once connectors are live.',
    category: 'Politics',
    keywords: ['economy', 'inflation', 'policy', 'ekonomi', 'inflasi', 'kebijakan'],
    excludeKeywords: ['joke', 'parody'],
    platforms: ['gdelt', 'rss', 'web', 'reddit', 'news'],
    languages: ['en', 'id'], regions: ['ID', 'US'],
    status: 'active', collectionFrequencyMinutes: 60,
    createdBy: userId, createdAt: now(), updatedAt: now(),
  });

  const samples = [
    { text: 'The new economic policy aims to curb inflation through targeted subsidies. Analysts call it a meaningful breakthrough.', platform: 'news' as Platform, src: 'social_post' as const, hours: 2 },
    { text: 'Many citizens complain about rising prices despite the government claims of growth. Critics blame the central bank.', platform: 'reddit' as Platform, src: 'comment' as const, hours: 4 },
    { text: 'Excellent quarterly results from major corporations support the positive economic outlook.', platform: 'news' as Platform, src: 'news_article' as const, hours: 6 },
    { text: 'Kebijakan ekonomi baru mendapat kritik dari sejumlah pengamat karena dianggap tidak konsisten.', platform: 'rss' as Platform, src: 'rss_item' as const, hours: 9 },
    { text: 'Inflation crisis deepens — protests reported across several cities.', platform: 'gdelt' as Platform, src: 'news_article' as const, hours: 14 },
    { text: 'Support for the latest economic stimulus reaches a new high in polls.', platform: 'web' as Platform, src: 'web_page' as const, hours: 24 },
    { text: 'Scandal over policy transparency erupts after a leaked memo surfaces. Public outrage grows.', platform: 'news' as Platform, src: 'news_article' as const, hours: 18 },
    { text: 'Dukungan masyarakat terhadap program ekonomi meningkat menurut survei terbaru.', platform: 'rss' as Platform, src: 'rss_item' as const, hours: 36 },
  ];

  for (const s of samples) {
    const id = newId('mention');
    const t = new Date(Date.now() - s.hours * 3600_000).toISOString();
    const sent = analyzeSentiment(s.text);
    const entities = extractEntities(s.text);
    const metrics = {
      views: 1000 + Math.floor(Math.random() * 50000),
      likes: Math.floor(Math.random() * 500),
      comments: Math.floor(Math.random() * 100),
      shares: Math.floor(Math.random() * 50),
      reposts: 0, quotes: 0, saves: 0,
      engagementTotal: 0,
      reachEstimate: 5000 + Math.floor(Math.random() * 100000),
    };
    metrics.engagementTotal = computeEngagementTotal(metrics);
    const m: Mention = {
      id, tenantId, topicId, platform: s.platform, sourceType: s.src,
      sourceId: id, sourceUrl: `https://example.com/${id}`,
      sourceUrlHash: id,
      title: s.text.slice(0, 50), text: s.text,
      language: detectLanguage(s.text),
      author: {
        username: `sample_user_${Math.floor(Math.random() * 999)}`,
        displayName: 'Sample User',
        profileUrl: null,
        followersCount: 100 + Math.floor(Math.random() * 50000),
        verified: false,
      },
      publishedAt: t, collectedAt: t,
      metrics,
      nlp: {
        sentiment: sent.sentiment, sentimentConfidence: sent.confidence,
        emotions: detectEmotions(s.text), intent: detectIntent(s.text),
        entities, topics: [], summary: null,
      },
      quality: {
        isDuplicate: false, isIrrelevant: false,
        relevanceScore: computeRelevanceScore(s.text, ['economy','inflation','policy','ekonomi','inflasi','kebijakan'], []),
        automationLikelihood: computeAutomationLikelihood(s.text, metrics),
        sourceReliability: 0.7,
      },
      createdAt: t, updatedAt: t,
    };
    store.put('mentions', id, m);
  }

  await store.flush();
};
