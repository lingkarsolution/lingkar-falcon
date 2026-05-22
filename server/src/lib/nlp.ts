// Lightweight rule-based NLP for v0.1. Replaceable with a real classifier later.
import type { ExtractedEntity, Sentiment } from '../types.js';

const POSITIVE = [
  'good','great','excellent','positive','love','support','win','growth','success','breakthrough','praise','approve',
  'bagus','baik','hebat','sukses','dukung','setuju','positif','terobosan','kemenangan',
];
const NEGATIVE = [
  'bad','terrible','awful','negative','hate','fail','failure','scandal','corruption','crisis','protest','attack','crash','decline','loss','accuse','blame',
  'record low','new low','slid','slide','slump','slumped','plunge','plunged','falling','fell','dropped','drop','weaken','weakens','weakened','weaker',
  'depreciation','depreciated','selloff','sell-off','tumble','tumbled','pressure','under pressure','stocks slumped','currency intervention',
  'buruk','gagal','korupsi','skandal','krisis','protes','tolak','kritik','negatif','rugi','jatuh','runtuh','demo',
  'melemah','pelemahan','anjlok','merosot','terpuruk','ambles','tertekan','rekor terendah','intervensi',
];
const ANGER = ['angry','rage','furious','outrage','marah','kesal','jengkel'];
const FEAR = ['fear','scared','panic','takut','panik','khawatir'];
const JOY = ['happy','excited','joy','senang','bahagia','gembira'];

const COMPLAINT = ['complain','complaint','keluhan','keluh','protes','tolak'];
const PRAISE = ['thanks','thank you','grateful','appreciate','terima kasih','apresiasi'];
const QUESTION = ['?', 'what', 'why', 'how', 'apa', 'kenapa', 'bagaimana', 'mengapa'];

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','in','on','to','for','with','at','by','is','are','was','were','be','been','being',
  'this','that','these','those','it','its','from','as','have','has','had','do','does','did','will','would','could','should',
  'yang','dan','atau','di','ke','dari','untuk','dengan','adalah','itu','ini','tidak','juga','sebagai','akan',
]);

export const detectLanguage = (text: string): string => {
  const idMarkers = ['yang','dan','ini','itu','tidak','dengan','untuk','adalah','sebagai','dari'];
  const tokens = text.toLowerCase().split(/\W+/);
  const idHits = tokens.filter((t) => idMarkers.includes(t)).length;
  return idHits >= 2 ? 'id' : 'en';
};

export const analyzeSentiment = (text: string): { sentiment: Sentiment; confidence: number } => {
  const t = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POSITIVE) if (t.includes(w)) pos++;
  for (const w of NEGATIVE) if (t.includes(w)) neg++;
  if (pos === 0 && neg === 0) return { sentiment: 'neutral', confidence: 0.5 };
  const total = pos + neg;
  if (pos > 0 && neg > 0 && Math.abs(pos - neg) <= 1) return { sentiment: 'mixed', confidence: 0.55 };
  if (pos > neg) return { sentiment: 'positive', confidence: Math.min(0.95, 0.55 + pos / (total + 2)) };
  return { sentiment: 'negative', confidence: Math.min(0.95, 0.55 + neg / (total + 2)) };
};

export const detectEmotions = (text: string): string[] => {
  const t = text.toLowerCase();
  const emotions: string[] = [];
  if (ANGER.some((w) => t.includes(w))) emotions.push('anger');
  if (FEAR.some((w) => t.includes(w))) emotions.push('fear');
  if (JOY.some((w) => t.includes(w))) emotions.push('joy');
  return emotions;
};

export const detectIntent = (text: string): string | null => {
  const t = text.toLowerCase();
  if (COMPLAINT.some((w) => t.includes(w))) return 'complaint';
  if (PRAISE.some((w) => t.includes(w))) return 'praise';
  if (QUESTION.some((w) => t.includes(w))) return 'question';
  return null;
};

// Naive capitalized-token NER. Adequate for v0.1 baseline; LLM enrichment can supersede.
export const extractEntities = (text: string): ExtractedEntity[] => {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();
  // Match 1-4 consecutive Capitalized tokens
  const regex = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]!;
    if (name.length < 3) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const type = inferEntityType(name);
    entities.push({
      text: name, normalizedName: name, type, confidence: 0.6,
    });
    if (entities.length >= 10) break;
  }
  return entities;
};

const ORG_HINTS = ['inc','corp','llc','ltd','company','co','university','institute','agency','ministry','kementerian','pt','partai'];
const LOC_HINTS = ['city','province','country','jakarta','indonesia','java','bali','sumatra','sulawesi','kalimantan','washington','beijing','london'];
const inferEntityType = (name: string) => {
  const l = name.toLowerCase();
  if (ORG_HINTS.some((h) => l.includes(h))) return 'organization' as const;
  if (LOC_HINTS.some((h) => l.includes(h))) return 'location' as const;
  // Heuristic: two capitalized tokens → person
  if (name.split(/\s+/).length === 2) return 'person' as const;
  return 'other' as const;
};

export const computeAutomationLikelihood = (
  text: string,
  metrics: { likes?: number | null; comments?: number | null; shares?: number | null },
): number => {
  let score = 0;
  // Very short repeated text
  if (text.length < 40) score += 0.15;
  // All-caps ratio
  const caps = text.replace(/[^A-Z]/g, '').length;
  if (caps > text.length * 0.4) score += 0.2;
  // No engagement
  const eng = (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0);
  if (eng === 0) score += 0.1;
  // Many hashtags / URLs
  const hashtags = (text.match(/#\w+/g) ?? []).length;
  const urls = (text.match(/https?:\/\/\S+/g) ?? []).length;
  if (hashtags >= 5) score += 0.2;
  if (urls >= 3) score += 0.15;
  return Math.min(1, score);
};

export const computeRelevanceScore = (text: string, keywords: string[], excludeKeywords: string[]): number => {
  const t = text.toLowerCase();
  let hits = 0;
  for (const k of keywords) if (k && t.includes(k.toLowerCase())) hits++;
  for (const k of excludeKeywords) if (k && t.includes(k.toLowerCase())) return 0;
  if (keywords.length === 0) return 0.5;
  return Math.min(1, 0.4 + (hits / keywords.length) * 0.6);
};

export const computeEngagementTotal = (m: {
  likes?: number | null; comments?: number | null; shares?: number | null;
  reposts?: number | null; quotes?: number | null; saves?: number | null;
}): number =>
  (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) +
  (m.reposts ?? 0) + (m.quotes ?? 0) + (m.saves ?? 0);

// TF-IDF-ish keyword extraction for cluster titling.
export const topKeywords = (texts: string[], k = 5): string[] => {
  const df = new Map<string, number>();
  const tfs: Array<Map<string, number>> = [];
  for (const text of texts) {
    const tf = new Map<string, number>();
    const tokens = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    tfs.push(tf);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const scores = new Map<string, number>();
  const N = texts.length || 1;
  for (const tf of tfs) {
    for (const [t, c] of tf) {
      const idf = Math.log(N / (df.get(t) ?? 1));
      scores.set(t, (scores.get(t) ?? 0) + c * idf);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w);
};

// Jaccard similarity on token sets — used for naive clustering.
const tokenize = (text: string): Set<string> =>
  new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !STOPWORDS.has(w)));

export const jaccard = (a: string, b: string): number => {
  const A = tokenize(a); const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
};
