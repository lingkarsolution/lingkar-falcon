import { store } from '../db/store.js';
import type {
  Author, GeoEstimate, GeoEstimateAlternative, GeoSource, GeoTargetType,
  Location, Mention, MentionGeoSummary, Sentiment, TopicCityTrend,
} from '../types.js';

const MODEL = 'local-id-city-v1';
const now = () => new Date().toISOString();

type CityProfile = {
  city: string;
  province: string;
  countryCode: string;
  aliases: string[];
  latitude: number;
  longitude: number;
  mapX: number;
  mapY: number;
};

const CITY_PROFILES: CityProfile[] = [
  { city: 'Jakarta', province: 'DKI Jakarta', countryCode: 'ID', aliases: ['jakarta', 'dki jakarta', 'jkt', 'jaksel', 'jakbar', 'jakut', 'jakpus', 'jaktim', 'sudirman', 'thamrin', 'monas', 'kemang', 'transjakarta'], latitude: -6.2088, longitude: 106.8456, mapX: 34, mapY: 56 },
  { city: 'Surabaya', province: 'Jawa Timur', countryCode: 'ID', aliases: ['surabaya', 'suroboyo', 'sby', 'pemkot surabaya', 'tunjungan', 'arek', 'cak', 'rek'], latitude: -7.2575, longitude: 112.7521, mapX: 45, mapY: 61 },
  { city: 'Bandung', province: 'Jawa Barat', countryCode: 'ID', aliases: ['bandung', 'bdg', 'kota bandung', 'gedung sate', 'cimahi', 'euy'], latitude: -6.9175, longitude: 107.6191, mapX: 37, mapY: 59 },
  { city: 'Yogyakarta', province: 'DI Yogyakarta', countryCode: 'ID', aliases: ['yogyakarta', 'jogja', 'jogjakarta', 'malioboro', 'sleman', 'bantul'], latitude: -7.7956, longitude: 110.3695, mapX: 42, mapY: 62 },
  { city: 'Semarang', province: 'Jawa Tengah', countryCode: 'ID', aliases: ['semarang', 'kota semarang', 'simpang lima', 'jateng'], latitude: -6.9667, longitude: 110.4167, mapX: 42, mapY: 59 },
  { city: 'Medan', province: 'Sumatera Utara', countryCode: 'ID', aliases: ['medan', 'sumut', 'deli serdang', 'lapangan merdeka medan'], latitude: 3.5952, longitude: 98.6722, mapX: 15, mapY: 33 },
  { city: 'Palembang', province: 'Sumatera Selatan', countryCode: 'ID', aliases: ['palembang', 'sumsel', 'ampera', 'musi'], latitude: -2.9761, longitude: 104.7754, mapX: 28, mapY: 49 },
  { city: 'Makassar', province: 'Sulawesi Selatan', countryCode: 'ID', aliases: ['makassar', 'ujung pandang', 'sulsel', 'losari'], latitude: -5.1477, longitude: 119.4327, mapX: 62, mapY: 58 },
  { city: 'Denpasar', province: 'Bali', countryCode: 'ID', aliases: ['denpasar', 'bali', 'badung', 'kuta', 'canggu'], latitude: -8.65, longitude: 115.2167, mapX: 51, mapY: 65 },
  { city: 'Jayapura', province: 'Papua', countryCode: 'ID', aliases: ['jayapura', 'papua', 'sentani'], latitude: -2.5333, longitude: 140.7167, mapX: 88, mapY: 50 },
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesAlias = (haystack: string, alias: string): boolean => {
  const escaped = escapeRegex(alias.toLowerCase());
  const boundary = /^[a-z0-9]+$/i.test(alias) ? `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)` : escaped;
  return new RegExp(boundary, 'i').test(haystack);
};

const scoreProfiles = (text: string, source: GeoSource): GeoEstimate | null => {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return null;

  const scored = CITY_PROFILES.map((profile) => {
    let score = 0;
    const signals: string[] = [];
    for (const alias of profile.aliases) {
      if (!matchesAlias(normalized, alias)) continue;
      const weight = alias === profile.city.toLowerCase() ? 4 : alias.length <= 3 ? 2 : 3;
      score += weight;
      signals.push(`${source === 'profile' ? 'author field' : 'text'} matched "${alias}"`);
    }
    return { profile, score, signals };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const top = scored[0];
  const confidence = Math.min(0.95, Math.max(0.35, top.score / (top.score + 2)));
  const alternatives: GeoEstimateAlternative[] = scored.slice(1, 4).map(({ profile, score }) => ({
    locationId: locationIdFor(profile),
    city: profile.city,
    province: profile.province,
    countryCode: profile.countryCode,
    confidence: Math.min(0.8, Math.max(0.1, score / (top.score + 2))),
  }));

  return {
    locationId: locationIdFor(top.profile),
    city: top.profile.city,
    province: top.profile.province,
    countryCode: top.profile.countryCode,
    latitude: top.profile.latitude,
    longitude: top.profile.longitude,
    confidence,
    source,
    signals: top.signals.slice(0, 6),
    alternatives,
  };
};

const locationIdFor = (profile: Pick<CityProfile, 'countryCode' | 'city'>): string =>
  `loc_${profile.countryCode.toLowerCase()}_${profile.city.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

const authorText = (author?: Author | null): string => [
  author?.username,
  author?.displayName,
  author?.profileUrl,
].filter(Boolean).join(' ');

const mentionText = (mention: Mention): string => [
  mention.title,
  mention.text,
  ...(mention.nlp.entities ?? []).filter((entity) => entity.type === 'location').map((entity) => entity.normalizedName ?? entity.text),
].filter(Boolean).join(' ');

export const seedDefaultLocations = async (): Promise<number> => {
  let inserted = 0;
  for (const profile of CITY_PROFILES) {
    const id = locationIdFor(profile);
    const existing = store.get('locations', id) as Location | undefined;
    if (existing) continue;
    const timestamp = now();
    store.put('locations', id, {
      id,
      countryCode: profile.countryCode,
      province: profile.province,
      city: profile.city,
      aliases: profile.aliases,
      latitude: profile.latitude,
      longitude: profile.longitude,
      population: null,
      timezone: 'Asia/Jakarta',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    inserted++;
  }
  if (inserted > 0) await store.flush();
  return inserted;
};

const putGeoEnrichment = (mention: Mention, targetType: GeoTargetType, estimate: GeoEstimate): void => {
  const timestamp = now();
  const id = `geo_${mention.id}_${targetType}_${MODEL}`;
  store.put('mentionGeoEnrichments', id, {
    id,
    tenantId: mention.tenantId,
    mentionId: mention.id,
    topicId: mention.topicId,
    targetType,
    estimate,
    model: MODEL,
    rawSignals: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

export const enrichMentionGeo = (mention: Mention, options: { force?: boolean } = {}): boolean => {
  if (!options.force && mention.geo?.model === MODEL && mention.geo.enrichedAt) return false;

  const mentioned = scoreProfiles(mentionText(mention), 'text_inference');
  const author = scoreProfiles(authorText(mention.author), 'profile');
  const geo: MentionGeoSummary = {
    mentioned,
    author,
    enrichedAt: now(),
    model: MODEL,
  };

  store.put('mentions', mention.id, {
    ...mention,
    geo,
    updatedAt: now(),
  });
  if (mentioned) putGeoEnrichment(mention, 'mentioned_location', mentioned);
  if (author) putGeoEnrichment(mention, 'author_location', author);
  return Boolean(mentioned || author);
};

export const enrichMentionsGeo = async (params: {
  tenantId: string;
  topicId?: string;
  mentionIds?: string[];
  force?: boolean;
  limit?: number;
}): Promise<{ requested: number; enriched: number; skipped: number }> => {
  await seedDefaultLocations();
  const mentionIdSet = params.mentionIds?.length ? new Set(params.mentionIds) : null;
  const candidates = (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === params.tenantId)
    .filter((mention) => !params.topicId || mention.topicId === params.topicId)
    .filter((mention) => !mentionIdSet || mentionIdSet.has(mention.id))
    .sort((a, b) => new Date(b.publishedAt ?? b.collectedAt).getTime() - new Date(a.publishedAt ?? a.collectedAt).getTime())
    .slice(0, Math.max(1, params.limit ?? 250));

  let enriched = 0;
  let skipped = 0;
  for (const mention of candidates) {
    const changed = enrichMentionGeo(mention, { force: params.force });
    if (changed) enriched++;
    else skipped++;
  }
  if (candidates.length > 0) await store.flush();
  return { requested: candidates.length, enriched, skipped };
};

const emptySentiment = (): Record<Sentiment, number> => ({ positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 });

export const cityGeoTrends = (
  tenantId: string,
  limit = 8,
  topicId?: string,
): Array<TopicCityTrend & { latitude: number; longitude: number; mapX: number; mapY: number }> => {
  const mentions = (store.list('mentions') as Mention[])
    .filter((mention) => mention.tenantId === tenantId && (!topicId || mention.topicId === topicId) && mention.geo?.mentioned?.city);
  const byCity = new Map<string, {
    profile: CityProfile;
    topicId: string;
    mentionCount: number;
    engagementTotal: number;
    confidenceTotal: number;
    sentimentBreakdown: Record<Sentiment, number>;
    keywords: Map<string, number>;
    entities: Map<string, number>;
    latest: number;
  }>();

  for (const mention of mentions) {
    const estimate = mention.geo?.mentioned;
    const profile = CITY_PROFILES.find((item) => item.city === estimate?.city);
    if (!estimate?.city || !profile) continue;
    const key = `${mention.topicId}:${profile.city}`;
    const current = byCity.get(key) ?? {
      profile,
      topicId: mention.topicId,
      mentionCount: 0,
      engagementTotal: 0,
      confidenceTotal: 0,
      sentimentBreakdown: emptySentiment(),
      keywords: new Map<string, number>(),
      entities: new Map<string, number>(),
      latest: 0,
    };
    current.mentionCount++;
    current.engagementTotal += Number(mention.metrics.engagementTotal ?? 0);
    current.confidenceTotal += estimate.confidence;
    current.sentimentBreakdown[mention.nlp.sentiment]++;
    const timestamp = new Date(mention.publishedAt ?? mention.collectedAt).getTime();
    current.latest = Math.max(current.latest, Number.isFinite(timestamp) ? timestamp : 0);
    for (const word of mention.text.toLowerCase().match(/[a-z0-9]{4,}|[a-zA-ZÀ-ÿ]+/g) ?? []) {
      if (word.length < 4 || CITY_PROFILES.some((city) => city.aliases.includes(word))) continue;
      current.keywords.set(word, (current.keywords.get(word) ?? 0) + 1);
    }
    for (const entity of mention.nlp.entities ?? []) {
      const key = entity.normalizedName ?? entity.text;
      current.entities.set(key, (current.entities.get(key) ?? 0) + 1);
    }
    byCity.set(key, current);
  }

  return [...byCity.values()]
    .sort((a, b) => b.mentionCount - a.mentionCount || b.engagementTotal - a.engagementTotal)
    .slice(0, limit)
    .map((item) => {
      const timestamp = now();
      const baselineMentions = Math.max(1, Math.round(item.mentionCount / 2));
      const trendScore = Number((item.mentionCount / baselineMentions).toFixed(2));
      return {
        id: `trend_${item.topicId}_${item.profile.city.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        tenantId,
        topicId: item.topicId,
        locationId: locationIdFor(item.profile),
        city: item.profile.city,
        province: item.profile.province,
        countryCode: item.profile.countryCode,
        windowStart: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
        windowEnd: timestamp,
        mentionCount: item.mentionCount,
        engagementTotal: item.engagementTotal,
        sentimentBreakdown: item.sentimentBreakdown,
        baselineMentions,
        trendScore,
        confidence: Number((item.confidenceTotal / item.mentionCount).toFixed(2)),
        topKeywords: [...item.keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word]) => word),
        topEntities: [...item.entities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word]) => word),
        createdAt: timestamp,
        updatedAt: timestamp,
        latitude: item.profile.latitude,
        longitude: item.profile.longitude,
        mapX: item.profile.mapX,
        mapY: item.profile.mapY,
      };
    });
};