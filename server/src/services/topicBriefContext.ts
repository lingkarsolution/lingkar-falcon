import type { Topic, TopicMonitoringObjective } from '../types.js';

const objectiveGuidance: Record<TopicMonitoringObjective, string> = {
  reputation: 'Prioritize trust, credibility, public legitimacy, stakeholder confidence, and reputational risk or support.',
  early_warning: 'Keep weak but credible escalation signals, emerging complaints, unusual coordination, new claims, and fast-changing narratives visible.',
  sentiment: 'Explain sentiment as stakeholder impact, not generic writing tone; separate support, harm, uncertainty, and mixed reactions.',
  misinformation: 'Extract repeated claims, rumors, misleading frames, missing context, source credibility concerns, and fact-checking needs.',
  campaign: 'Track slogans, hashtags, mobilization, message spread, supporter/opponent framing, and calls to action.',
  competitor: 'Prioritize comparisons, switching intent, competitor advantages, dissatisfaction, loyalty signals, and market-positioning impact.',
  complaints: 'Prioritize first-person problems, service failures, safety issues, unresolved support needs, urgency, and affected user groups.',
};

const cleanList = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

export const topicObjectiveGuidance = (topic: Topic): string[] => {
  const objectives = topic.monitoringBrief?.objectives?.length ? topic.monitoringBrief.objectives : ['reputation' as TopicMonitoringObjective];
  return objectives.map((objective) => objectiveGuidance[objective]).filter(Boolean);
};

export const topicBriefForLlm = (topic: Topic) => {
  const brief = topic.monitoringBrief;
  return {
    identity: {
      title: topic.title,
      description: topic.description?.trim() || null,
      subjectType: brief?.subjectType ?? topic.category ?? null,
      category: topic.category ?? null,
    },
    objectives: brief?.objectives ?? [],
    objectiveGuidance: topicObjectiveGuidance(topic),
    perspective: brief?.perspective ?? {
      role: 'neutral_observer',
      name: null,
      description: null,
      favorableSignals: [],
      unfavorableSignals: [],
    },
    query: brief?.query ?? {
      includeKeywords: topic.keywords,
      exactPhrases: [],
      hashtags: [],
      handles: [],
      relatedEntities: [],
      excludeKeywords: topic.excludeKeywords,
      excludeHashtags: [],
      excludeHandles: [],
      excludeDomains: [],
    },
    sources: brief?.sources ?? {
      platforms: topic.platforms,
      languages: topic.languages,
      countries: [],
      provinces: [],
      cities: [],
      geoMode: 'mentioned',
    },
    audience: brief?.audience ?? {
      types: [],
      minimumFollowers: null,
      verifiedOnly: false,
      includeLowFollowerAccounts: true,
    },
    relevance: brief?.relevance ?? {
      mode: 'balanced',
      aiReviewEnabled: true,
    },
    collection: brief?.collection ?? {
      lookbackDays: topic.intelligenceSettings?.lookbackDays ?? 30,
      refreshMinutes: topic.collectionFrequencyMinutes ?? 60,
      maxItemsPerConnector: topic.intelligenceSettings?.maxItemsPerConnector ?? 50,
      costMode: 'balanced',
    },
    alerts: brief?.alerts ?? { triggers: [] },
    legacyCompatibility: {
      keywords: topic.keywords,
      excludeKeywords: topic.excludeKeywords,
      platforms: topic.platforms,
      languages: topic.languages,
      regions: topic.regions,
    },
  };
};

export const topicIncludeTerms = (topic: Topic): string[] => cleanList([
  topic.title,
  topic.category,
  topic.description,
  ...topic.keywords,
  ...(topic.monitoringBrief?.query?.includeKeywords ?? []),
  ...(topic.monitoringBrief?.query?.exactPhrases ?? []),
  ...(topic.monitoringBrief?.query?.hashtags ?? []),
  ...(topic.monitoringBrief?.query?.handles ?? []),
  ...(topic.monitoringBrief?.query?.relatedEntities ?? []),
  ...(topic.monitoringBrief?.perspective?.favorableSignals ?? []),
  ...(topic.monitoringBrief?.perspective?.unfavorableSignals ?? []),
]);

export const topicExcludeTerms = (topic: Topic): string[] => cleanList([
  ...topic.excludeKeywords,
  ...(topic.monitoringBrief?.query?.excludeKeywords ?? []),
  ...(topic.monitoringBrief?.query?.excludeHashtags ?? []),
  ...(topic.monitoringBrief?.query?.excludeHandles ?? []),
  ...(topic.monitoringBrief?.query?.excludeDomains ?? []),
]);

export const topicRelevanceThreshold = (topic: Topic): number => {
  const mode = topic.monitoringBrief?.relevance?.mode ?? 'balanced';
  if (mode === 'broad') return 0.35;
  if (mode === 'strict') return 0.75;
  return 0.55;
};

export const topicLlmContextJson = (topic: Topic): string => JSON.stringify(topicBriefForLlm(topic), null, 2);