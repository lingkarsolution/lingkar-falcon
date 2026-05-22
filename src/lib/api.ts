// Typed API client against the CivicFalcon /api/v1 surface.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const BASE = '/api/v1';

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', res.statusText);
    return (await res.text()) as unknown as T;
  }
  const json = await res.json();
  if (!res.ok || json?.ok === false) {
    const err = json?.error ?? { code: 'HTTP_ERROR', message: res.statusText };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return json.data as T;
};

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  delete: <T>(p: string) => request<T>('DELETE', p),
};

// ---- Types (loose mirrors of server types — enough for UI) ----
export type Role = 'admin' | 'analyst' | 'viewer';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed';
export type Platform = string;

export interface User { id: string; email: string; name: string; role: Role; }
export interface Tenant { id: string; name: string; slug: string; }
export interface Topic {
  id: string; tenantId: string; title: string; description?: string | null; category?: string | null;
  keywords: string[]; excludeKeywords: string[]; platforms: string[]; languages: string[]; regions: string[];
  status: 'active' | 'paused' | 'archived'; collectionFrequencyMinutes: number;
  createdAt: string; updatedAt: string;
}
export interface Connector {
  id: string; tenantId: string; platform: Platform; name: string; displayName?: string; enabled: boolean;
  mode: 'free' | 'official_api' | 'paid_api' | 'scraper' | 'manual_import' | 'disabled';
  status: 'active' | 'limited' | 'disabled' | 'failed' | 'budget_exceeded' | 'not_configured';
  credentialConfigured: boolean;
  monthlyBudgetUsd?: number | null; currentMonthRequests?: number; currentMonthSpendUsd?: number;
  lastHealthCheckAt?: string | null; lastHealthMessage?: string | null;
}
export interface Mention {
  id: string; tenantId: string; topicId: string; platform: Platform;
  text: string; publishedAt?: string | null; collectedAt: string; sourceUrl?: string | null;
  author?: { username?: string; displayName?: string; followerCount?: number | null };
  nlp: { sentiment: Sentiment; sentimentScore: number; entities: { text: string; type: string }[]; keywords: string[]; language?: string };
  metrics?: { likeCount?: number; shareCount?: number; commentCount?: number; viewCount?: number };
  quality?: { relevanceScore: number; automationLikelihood: number };
}
export interface RiskEvent {
  id: string; tenantId: string; topicId: string; clusterId?: string | null;
  title: string; summary: string; score: number; severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewing' | 'mitigated' | 'dismissed'; category: string;
  detectedAt: string; evidenceMentionIds: string[]; narrativeTags?: string[]; code?: string;
}
export interface AlertEvent {
  id: string; tenantId: string; ruleId: string; topicId?: string | null;
  title: string; description: string; severity: string; status: 'new' | 'acknowledged' | 'resolved';
  triggeredAt: string;
}
export interface Insight {
  id: string; tenantId: string; topicId: string; title: string; summary: string;
  whyItMatters: string; recommendation: string; evidenceMentionIds: string[]; generatedAt: string;
}
export interface IssueCluster {
  id: string; tenantId: string; topicId: string; label: string; size: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  representativeMentionIds: string[]; keywords: string[];
}
export interface Actor {
  id: string; tenantId: string; platform: Platform; username: string; displayName: string;
  status: 'active' | 'archived'; tags: string[];
  riskScore?: number | null; riskLevel?: 'low' | 'medium' | 'high' | 'critical' | null; riskExplanation?: string | null;
  opportunityScore?: number | null; opportunityLevel?: string | null; opportunityExplanation?: string | null;
}
export interface IngestionJob {
  id: string; tenantId: string; topicId: string; connectorId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  itemsFetched: number; itemsStored: number; itemsDeduped: number;
  createdAt: string; startedAt?: string | null; finishedAt?: string | null;
}
export interface Report {
  id: string; tenantId: string; topicId: string; title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  fileUrl?: string | null; createdAt: string; finishedAt?: string | null;
}
export interface AuditLog {
  id: string; tenantId: string; actorUserId?: string | null; action: string;
  entityType?: string | null; entityId?: string | null; createdAt: string;
}

// ---- Endpoint helpers (typed wrappers) ----
export const auth = {
  login: (email: string, password: string) => api.post<{ user: User; tenantId: string }>('/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
  me: () => api.get<{ user: User | null; tenant: Tenant | null }>('/auth/me'),
};
