# CivicFalcon AI — PRD, Technical Specification, API Contracts, and Implementation Plan

## 0. Naming

**Product name:** CivicFalcon AI  
**Short product name:** CivicFalcon  
**Code name / package prefix:** `civicfalcon`  
**Product category:** OSINT-first Public Narrative Intelligence Platform

**Naming rationale:** “CivicFalcon” sounds more like a single product name than “Civic Falcon.” It suggests public/civic awareness, fast detection, high-level visibility, and command-center intelligence.

---

## 1. Executive Summary

CivicFalcon AI is a rebuild of the previous Nexorus-style topic intelligence product into a modern, scalable, OSINT-first narrative intelligence platform.

The v0.1 product must support **pure OSINT and lean paid API ingestion** for:

- News and web OSINT
- RSS and RSSHub-style feeds
- GDELT-style open news intelligence
- DuckDuckGo/SearXNG-style discovery where appropriate
- Brave Search or SERP API as optional lean paid search
- Meta: Facebook and Instagram, within official API limitations
- YouTube
- X.com
- TikTok, with realistic official/research/provider/manual modes

The product must not be a dashboard-only clone. It must be built around a reusable intelligence engine:

```text
Connectors → Canonical Data → Enrichment → Issue/Risk Engine → Dashboards → Alerts → Reports
```

v0.1 must be small enough to build quickly, but structured so v1.0 can become a multi-tenant government/enterprise-grade product.

---

## 2. Product Goals

### 2.1 v0.1 Goals

CivicFalcon AI v0.1 must allow users to:

1. Create monitored topics using keywords and excluded keywords.
2. Configure source connectors.
3. Run ingestion jobs from OSINT and lean paid APIs.
4. Normalize all source data into a single canonical mention schema.
5. View raw posts/articles/videos/comments in a searchable analyst table.
6. Correct sentiment and mark irrelevant records.
7. View topic overview metrics and charts.
8. Generate AI insights backed by evidence records.
9. Detect issue clusters and risk events.
10. Monitor selected public actors/accounts where APIs allow.
11. Create basic alerts.
12. Generate simple PDF reports.
13. Track connector usage and cost caps.

### 2.2 v1.0 Scalability Goals

The v0.1 architecture must support later expansion into:

1. Multi-tenant customer workspaces.
2. Tenant-level connector credentials.
3. Tenant-level quotas and billing.
4. Advanced RBAC and audit controls.
5. Case management for risk events.
6. Real-time ingestion for selected sources.
7. Larger search/indexing infrastructure.
8. On-premise deployment.
9. Customer-provided API keys.
10. Additional paid social/listening providers.
11. PowerPoint reports.
12. WhatsApp/Telegram/Teams alert channels.
13. Human-in-the-loop AI feedback and model evaluation.

---

## 3. Product Scope

### 3.1 v0.1 In Scope

| Module | Scope |
|---|---|
| Authentication | Simple login/session abstraction, SSO-ready later |
| Dashboard | Summary cards, risk cards, latest issues, topic filters |
| Topic Management | CRUD, keywords, exclude keywords, platforms, status |
| Connector Management | Configure and test source connectors |
| Ingestion Jobs | Manual and scheduled jobs, usage tracking, error logs |
| Raw Data | Search, filter, sort, paginate, sentiment correction, relevance marking, CSV export |
| Overview Analytics | Mentions, reach estimate, engagement, sentiment, platform distribution, time series |
| AI Insights | Evidence-backed summaries, recommendations, confidence scores |
| Issue Clustering | Group related mentions into narrative clusters |
| Risk Events | Detect reputational/legal/fiscal/operational risks |
| Top Entities | Extract and rank people, organizations, locations, events, products |
| Actor Monitoring | Basic watchlist for accounts/entities |
| Alerts | Volume spike, negative spike, risk event, actor mention, keyword alert |
| Reports | PDF topic report and risk event report |
| Usage Control | Connector request count, spend caps, AI cost caps |
| Audit Log | Track important changes |

### 3.2 v0.1 Out of Scope

1. Full commercial social listening firehose.
2. Private profile scraping.
3. Login bypassing.
4. Closed/private group monitoring.
5. Private messages.
6. Automatic posting/replying to social media.
7. Guaranteed TikTok/Instagram broad monitoring.
8. Hard claims that a real person is a bot.
9. Hard claims about demographic identity.
10. Enterprise billing.
11. Advanced case workflow.
12. Full multi-tenant deployment, although schema must be tenant-ready.

---

## 4. Positioning and UX Principles

### 4.1 Product Positioning

CivicFalcon AI helps analysts, public affairs teams, government teams, and communications teams detect and understand public narratives from open-source and authorized public data.

### 4.2 Design Principles

1. **Evidence-first:** Every AI insight must link back to real mentions.
2. **Connector-aware:** The UI must show which sources are active, limited, failed, or capped.
3. **Cost-aware:** Paid API usage must be visible and controllable.
4. **Analyst-friendly:** Raw data review must be treated as a core feature, not an afterthought.
5. **No black box claims:** Sentiment, risk, and automation scores must explain their basis.
6. **Scalable by design:** v0.1 can be small, but boundaries must support v1.0.

---

## 5. User Roles

### 5.1 Admin

Can:

- Manage connector credentials.
- Manage usage caps.
- Manage users.
- Create, edit, pause, archive, and delete topics.
- View ingestion logs.
- View connector health.
- View audit logs.

### 5.2 Analyst

Can:

- Create and manage topics.
- Run ingestion jobs.
- Review raw data.
- Correct sentiment.
- Mark records irrelevant.
- Generate insights.
- Generate reports.
- Configure alerts.

### 5.3 Viewer

Can:

- View dashboards.
- View existing insights.
- View existing reports.
- Export reports if allowed.

---

## 6. Recommended Technical Stack

### 6.1 Frontend

| Layer | Recommendation |
|---|---|
| Framework | Vite + React + TypeScript |
| Routing | React Router |
| State/query | TanStack Query |
| Forms | React Hook Form + Zod |
| UI | Tailwind CSS + shadcn/ui |
| Charts | Apache ECharts |
| Maps | Leaflet or ECharts map |
| Tables | TanStack Table |
| API client | Typed fetch wrapper or generated OpenAPI client |

### 6.2 Backend

| Layer | Recommendation |
|---|---|
| Runtime | Node.js 24+ |
| Language | TypeScript strict mode |
| API | Fastify or Express |
| Validation | Zod |
| ORM | Drizzle ORM |
| Database | PostgreSQL |
| Queue | Redis + BullMQ |
| Search | PostgreSQL full-text for v0.1; Meilisearch/OpenSearch later |
| PDF | Playwright HTML-to-PDF |
| Auth | Cookie/session or JWT abstraction |
| Logs | Structured JSON logs |

### 6.3 AI/NLP

v0.1 should avoid sending every record to an expensive LLM.

Recommended approach:

1. Use deterministic filtering and rule-based relevance first.
2. Use lightweight local/open-source NLP for language, sentiment, and entity extraction where possible.
3. Use LLM only for:
   - Insight summary
   - Issue cluster titles
   - Risk explanation
   - Recommendations
   - Report generation

---

## 7. High-Level Architecture

```text
apps/web
  React UI
  Typed API client
  Dashboards
  Raw data review
  Reports

apps/api
  REST API
  Auth
  Topic service
  Connector service
  Ingestion service
  Mention service
  Analytics service
  AI service
  Alert service
  Report service

apps/worker
  BullMQ workers
  Connector jobs
  NLP enrichment jobs
  AI generation jobs
  Report generation jobs

packages/shared
  Shared TypeScript types
  Zod schemas
  API DTOs
  constants
```

### 7.1 Data Flow

```text
1. User creates a topic.
2. User selects platforms/connectors.
3. User starts ingestion job.
4. Connector fetches raw source items.
5. Connector normalizes raw items into CanonicalMention.
6. Deduplication checks run.
7. Mention is stored.
8. NLP enrichment runs.
9. Aggregates update.
10. AI insights/risk events can be generated.
11. Dashboard, alerts, and reports consume normalized data.
```

---

## 8. Core Domain Model

### 8.1 Entities

```text
Tenant
User
Topic
TopicKeyword
Connector
ConnectorCredential
ConnectorUsage
IngestionJob
IngestionJobError
Mention
Author
MentionMetric
Entity
MentionEntity
IssueCluster
IssueClusterMention
RiskEvent
RiskEventMention
Insight
InsightMention
Actor
AlertRule
AlertEvent
Report
AuditLog
```

### 8.2 Tenant Strategy

v0.1 can run as a single-tenant app, but all main tables must include `tenant_id`.

This prevents painful migration later.

---

## 9. TypeScript Domain Types

### 9.1 Platform

```ts
export type Platform =
  | "news"
  | "rss"
  | "web"
  | "gdelt"
  | "facebook"
  | "instagram"
  | "youtube"
  | "x"
  | "tiktok"
  | "reddit"
  | "bluesky"
  | "mastodon";
```

### 9.2 Topic

```ts
export type TopicStatus = "active" | "paused" | "archived";

export type Topic = {
  id: string;
  tenantId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  keywords: string[];
  excludeKeywords: string[];
  platforms: Platform[];
  languages: string[];
  regions: string[];
  status: TopicStatus;
  collectionFrequencyMinutes?: number | null;
  createdAt: string;
  updatedAt: string;
};
```

### 9.3 Connector

```ts
export type ConnectorMode =
  | "free"
  | "official_api"
  | "paid_api"
  | "scraper"
  | "manual_import"
  | "disabled";

export type ConnectorStatus =
  | "active"
  | "limited"
  | "disabled"
  | "failed"
  | "budget_exceeded"
  | "not_configured";

export type Connector = {
  id: string;
  tenantId: string;
  platform: Platform;
  name: string;
  mode: ConnectorMode;
  status: ConnectorStatus;
  enabled: boolean;
  credentialId?: string | null;
  rateLimitPerMinute?: number | null;
  dailyRequestLimit?: number | null;
  monthlyBudgetUsd?: number | null;
  currentMonthSpendUsd?: number;
  currentMonthRequests?: number;
  lastHealthCheckAt?: string | null;
  lastHealthMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### 9.4 Canonical Mention

```ts
export type SourceType =
  | "social_post"
  | "news_article"
  | "video"
  | "comment"
  | "web_page"
  | "rss_item";

export type Sentiment =
  | "positive"
  | "negative"
  | "neutral"
  | "mixed"
  | "unknown";

export type CanonicalMention = {
  id: string;
  tenantId: string;
  topicId: string;

  platform: Platform;
  sourceType: SourceType;
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourceUrlHash?: string | null;

  title?: string | null;
  text: string;
  language?: string | null;

  author?: {
    id?: string | null;
    username?: string | null;
    displayName?: string | null;
    profileUrl?: string | null;
    followersCount?: number | null;
    verified?: boolean | null;
  } | null;

  publishedAt?: string | null;
  collectedAt: string;

  metrics: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    reposts?: number | null;
    quotes?: number | null;
    saves?: number | null;
    engagementTotal?: number | null;
    reachEstimate?: number | null;
  };

  nlp: {
    sentiment?: Sentiment;
    sentimentConfidence?: number | null;
    emotions?: string[];
    intent?: string | null;
    entities?: ExtractedEntity[];
    topics?: string[];
    summary?: string | null;
  };

  quality: {
    isDuplicate: boolean;
    duplicateOfId?: string | null;
    isIrrelevant: boolean;
    relevanceScore?: number | null;
    automationLikelihood?: number | null;
    sourceReliability?: number | null;
  };

  rawPayloadRef?: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### 9.5 Extracted Entity

```ts
export type EntityType =
  | "person"
  | "organization"
  | "location"
  | "event"
  | "product"
  | "other";

export type ExtractedEntity = {
  text: string;
  normalizedName?: string | null;
  type: EntityType;
  confidence: number;
  sentiment?: Sentiment;
};
```

### 9.6 Insight

```ts
export type InsightType =
  | "summary"
  | "issue"
  | "risk_event"
  | "opportunity"
  | "entity"
  | "daily_brief";

export type Insight = {
  id: string;
  tenantId: string;
  topicId: string;
  type: InsightType;
  title: string;
  summary: string;
  whyItMatters?: string | null;
  impact?: string | null;
  recommendation?: string | null;
  metrics: {
    mentionCount?: number;
    reachEstimate?: number;
    engagementTotal?: number;
    positiveCount?: number;
    negativeCount?: number;
    neutralCount?: number;
  };
  evidenceMentionIds: string[];
  confidence: number;
  generatedBy: "system" | "user";
  generatedAt: string;
};
```

### 9.7 Risk Event

```ts
export type RiskCategory =
  | "reputation"
  | "legal"
  | "fiscal"
  | "operational"
  | "security"
  | "political"
  | "other";

export type RiskSeverity = "critical" | "high" | "medium" | "low";

export type RiskEventStatus =
  | "new"
  | "reviewing"
  | "acknowledged"
  | "resolved"
  | "dismissed";

export type RiskEvent = {
  id: string;
  tenantId: string;
  topicId: string;
  code: string;
  title: string;
  summary: string;
  category: RiskCategory;
  severity: RiskSeverity;
  sentiment: "negative" | "mixed" | "neutral";
  score: number;
  keyTrigger: string;
  narrativeTags: string[];
  metrics: {
    mentions: number;
    impressions?: number;
    reachEstimate?: number;
    engagementTotal?: number;
    velocityScore?: number;
  };
  firstSeenAt: string;
  lastSeenAt: string;
  evidenceMentionIds: string[];
  status: RiskEventStatus;
};
```

---

## 10. Database Specification

### 10.1 Minimum Tables

```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  name text,
  role text NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);

CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  description text,
  category text,
  platforms jsonb NOT NULL DEFAULT '[]',
  languages jsonb NOT NULL DEFAULT '[]',
  regions jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active',
  collection_frequency_minutes integer,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topic_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  keyword_type text NOT NULL CHECK (keyword_type IN ('include', 'exclude')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  platform text NOT NULL,
  name text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'not_configured',
  enabled boolean NOT NULL DEFAULT false,
  credential_id uuid,
  rate_limit_per_minute integer,
  daily_request_limit integer,
  monthly_budget_usd numeric(12, 2),
  current_month_spend_usd numeric(12, 2) NOT NULL DEFAULT 0,
  current_month_requests integer NOT NULL DEFAULT 0,
  last_health_check_at timestamptz,
  last_health_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connector_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connector_id uuid NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connector_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connector_id uuid NOT NULL REFERENCES connectors(id),
  ingestion_job_id uuid,
  request_count integer NOT NULL DEFAULT 1,
  estimated_cost_usd numeric(12, 6),
  actual_cost_usd numeric(12, 6),
  endpoint text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  connector_id uuid REFERENCES connectors(id),
  job_type text NOT NULL CHECK (job_type IN ('manual', 'scheduled', 'backfill', 'refresh_metrics')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  requested_by uuid REFERENCES users(id),
  started_at timestamptz,
  finished_at timestamptz,
  fetched_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_job_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ingestion_job_id uuid NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  error_code text,
  message text NOT NULL,
  raw_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  platform text NOT NULL,
  source_author_id text,
  username text,
  display_name text,
  profile_url text,
  followers_count integer,
  verified boolean,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, platform, source_author_id)
);

CREATE TABLE mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  author_id uuid REFERENCES authors(id),
  platform text NOT NULL,
  source_type text NOT NULL,
  source_id text,
  source_url text,
  source_url_hash text,
  title text,
  text text NOT NULL,
  language text,
  published_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  sentiment text NOT NULL DEFAULT 'unknown',
  sentiment_confidence numeric(5, 4),
  emotions jsonb NOT NULL DEFAULT '[]',
  intent text,
  topics jsonb NOT NULL DEFAULT '[]',
  summary text,
  is_duplicate boolean NOT NULL DEFAULT false,
  duplicate_of_id uuid REFERENCES mentions(id),
  is_irrelevant boolean NOT NULL DEFAULT false,
  relevance_score numeric(5, 4),
  automation_likelihood numeric(5, 4),
  source_reliability numeric(5, 4),
  raw_payload_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, platform, source_id),
  UNIQUE(tenant_id, source_url_hash)
);

CREATE TABLE mention_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  views integer,
  likes integer,
  comments integer,
  shares integer,
  reposts integer,
  quotes integer,
  saves integer,
  engagement_total integer,
  reach_estimate integer,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  normalized_name text NOT NULL,
  entity_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, normalized_name, entity_type)
);

CREATE TABLE mention_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id),
  original_text text NOT NULL,
  confidence numeric(5, 4),
  sentiment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text,
  sentiment text,
  trend_direction text,
  mention_count integer NOT NULL DEFAULT 0,
  engagement_total integer NOT NULL DEFAULT 0,
  reach_estimate integer NOT NULL DEFAULT 0,
  confidence numeric(5, 4),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_cluster_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  issue_cluster_id uuid NOT NULL REFERENCES issue_clusters(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issue_cluster_id, mention_id)
);

CREATE TABLE risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  issue_cluster_id uuid REFERENCES issue_clusters(id),
  code text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  sentiment text NOT NULL,
  score integer NOT NULL,
  key_trigger text,
  narrative_tags jsonb NOT NULL DEFAULT '[]',
  mentions integer NOT NULL DEFAULT 0,
  impressions integer,
  reach_estimate integer,
  engagement_total integer,
  velocity_score numeric(8, 4),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, topic_id, code)
);

CREATE TABLE risk_event_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  risk_event_id uuid NOT NULL REFERENCES risk_events(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(risk_event_id, mention_id)
);

CREATE TABLE insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  why_it_matters text,
  impact text,
  recommendation text,
  metrics jsonb NOT NULL DEFAULT '{}',
  confidence numeric(5, 4) NOT NULL,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE insight_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  insight_id uuid NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(insight_id, mention_id)
);

CREATE TABLE actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  platform text NOT NULL,
  username text NOT NULL,
  display_name text,
  profile_url text,
  monitoring_reason text,
  tags jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  risk_score integer,
  risk_level text,
  opportunity_score integer,
  opportunity_level text,
  last_refreshed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid REFERENCES topics(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  severity text,
  config jsonb NOT NULL DEFAULT '{}',
  channels jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  alert_rule_id uuid REFERENCES alert_rules(id),
  topic_id uuid REFERENCES topics(id),
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'new',
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic_id uuid REFERENCES topics(id),
  report_type text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  date_from timestamptz,
  date_to timestamptz,
  file_url text,
  error_message text,
  requested_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 10.2 Required Indexes

```sql
CREATE INDEX idx_topics_tenant_status ON topics(tenant_id, status);
CREATE INDEX idx_mentions_topic_platform_date ON mentions(topic_id, platform, published_at DESC);
CREATE INDEX idx_mentions_topic_sentiment ON mentions(topic_id, sentiment);
CREATE INDEX idx_mentions_topic_irrelevant ON mentions(topic_id, is_irrelevant);
CREATE INDEX idx_mentions_source_url_hash ON mentions(source_url_hash);
CREATE INDEX idx_mentions_text_search ON mentions USING gin(to_tsvector('simple', coalesce(title, '') || ' ' || text));
CREATE INDEX idx_ingestion_jobs_topic_status ON ingestion_jobs(topic_id, status, created_at DESC);
CREATE INDEX idx_risk_events_topic_severity ON risk_events(topic_id, severity, status);
CREATE INDEX idx_alert_events_tenant_status ON alert_events(tenant_id, status, triggered_at DESC);
```

---

## 11. Connector Architecture

### 11.1 Connector Interface

```ts
export interface SourceConnector {
  platform: Platform;

  testConnection(input: ConnectorTestInput): Promise<ConnectorHealth>;

  estimateCost?(request: IngestionRequest): Promise<CostEstimate>;

  fetchMentions(
    request: IngestionRequest
  ): AsyncGenerator<RawSourceItem>;

  normalize(
    item: RawSourceItem,
    context: NormalizeContext
  ): Promise<CanonicalMention>;
}
```

### 11.2 Shared Connector Types

```ts
export type ConnectorHealth = {
  ok: boolean;
  status: ConnectorStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type CostEstimate = {
  estimatedRequests: number;
  estimatedCostUsd: number;
  budgetRemainingUsd?: number;
  canRun: boolean;
  reason?: string;
};

export type IngestionRequest = {
  tenantId: string;
  topicId: string;
  connectorId: string;
  keywords: string[];
  excludeKeywords: string[];
  platforms: Platform[];
  languages?: string[];
  regions?: string[];
  dateFrom?: string;
  dateTo?: string;
  maxItems?: number;
  jobId: string;
};

export type RawSourceItem = {
  platform: Platform;
  sourceType: SourceType;
  raw: unknown;
};

export type NormalizeContext = {
  tenantId: string;
  topicId: string;
  connectorId: string;
  jobId: string;
};
```

### 11.3 Connector Rules

Every connector must:

1. Implement `testConnection`.
2. Implement `fetchMentions`.
3. Implement `normalize`.
4. Respect rate limits.
5. Respect monthly budget caps.
6. Log usage events.
7. Return clear limitation messages.
8. Never throw unhandled errors into the worker process.
9. Never expose secrets in logs.
10. Support idempotent ingestion.

---

## 12. External Source Strategy

### 12.1 GDELT Connector

**Mode:** free  
**Use:** news/event baseline

v0.1 must support:

- Keyword search.
- Date range.
- Country/region filter where available.
- URL/title/source extraction.
- Deduplication by URL hash.

Output:

```ts
platform = "gdelt";
sourceType = "news_article";
```

### 12.2 RSS Connector

**Mode:** free  
**Use:** official RSS feeds and RSSHub-compatible routes

v0.1 must support:

- Add feed URL.
- Poll feed.
- Filter by topic keywords.
- Exclude by excluded keywords.
- Deduplicate by GUID/link.

Output:

```ts
platform = "rss";
sourceType = "rss_item";
```

### 12.3 Search Connector

**Modes:** free / paid_api

The Search Connector is implemented as a **provider-abstracted Web Search layer** (full design in §31), not a single backend. v0.1 must ship with the following provider waterfall, in order of preference:

1. **SearXNG** (self-hosted, free) — primary aggregator. Returns JSON; aggregates many engines; ToS-clean.
2. **DuckDuckGo Instant Answer API** (`https://api.duckduckgo.com/?format=json`) — free, no key, but limited to zero-click answers. Use for entity disambiguation and quick facts only.
3. **Brave Search API** (paid, cheap) — preferred paid web search. ~$3 / 1k queries, 2k/mo free tier.
4. **Tavily / Serper / SerpAPI** — optional premium fallback for high-value queries.

Mandatory rules:

- **No HTML scraping of `html.duckduckgo.com`, Google, or Bing.** It violates ToS, returns anomaly/captcha pages from cloud egress IPs, and is brittle. Any such code must be removed.
- All providers implement a common `WebSearchProvider` interface and are routed by a `WebSearchRouter` with Redis caching and per-provider budget guards (see §31).
- Default cache TTL: 6h for web search, 15min for news-flavored queries.
- Provider escalation only when prior tier returned `< minResults` (configurable, default 3).
- Every search call writes a `connector_usage_events` row tagged with the provider name.

### 12.4 Facebook Connector

**Mode:** official_api / limited

v0.1 support:

- Authorized Facebook Pages.
- Page posts.
- Page comments if permissions allow.
- Engagement metrics where available.

Out of scope:

- Private profiles.
- Private groups.
- Private messages.
- Broad Facebook public firehose.

### 12.5 Instagram Connector

**Mode:** official_api / limited

v0.1 support:

- Instagram Business/Creator account connection.
- Owned media retrieval.
- Owned media comments where allowed.
- Limited hashtag tracking.

UI must show limitations clearly.

### 12.6 YouTube Connector

**Mode:** official_api

v0.1 support:

- Search videos by keyword.
- Fetch video metadata.
- Fetch channel metadata.
- Fetch comments where available.
- Track quota usage.

### 12.7 X.com Connector

**Mode:** paid_api

v0.1 support:

- Recent search by keyword.
- User lookup.
- User posts.
- Post metrics.
- Account watchlist.
- Budget cap.

### 12.8 TikTok Connector

**Modes:** disabled / research_api / paid_provider / manual_import

v0.1 support:

- Connector skeleton.
- Manual import.
- Provider interface.
- Research API mode only if eligible.

UI must not imply TikTok is always available.

---

## 13. API Design Standards

### 13.1 Base URL

```text
/api/v1
```

### 13.2 Authentication

All protected endpoints require authenticated user session.

### 13.3 Standard Response Envelope

```ts
export type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

### 13.4 Pagination Contract

Use cursor pagination for large lists.

```ts
export type PageInfo = {
  nextCursor?: string | null;
  previousCursor?: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type PaginatedResponse<T> = {
  items: T[];
  pageInfo: PageInfo;
  totalEstimate?: number;
};
```

### 13.5 Standard Query Parameters

```text
limit=50
cursor=<opaque_cursor>
dateFrom=2026-01-01T00:00:00Z
dateTo=2026-01-31T23:59:59Z
sort=publishedAt:desc
```

### 13.6 Standard Error Codes

```text
AUTH_REQUIRED
FORBIDDEN
VALIDATION_ERROR
NOT_FOUND
CONFLICT
RATE_LIMITED
CONNECTOR_DISABLED
CONNECTOR_LIMITED
BUDGET_EXCEEDED
UPSTREAM_ERROR
INGESTION_JOB_FAILED
AI_GENERATION_FAILED
REPORT_GENERATION_FAILED
INTERNAL_ERROR
```

---

# 14. Frontend API Contracts

The following contracts are the API surface the frontend should consume.

---

## 14.1 Auth API

### GET `/api/v1/auth/me`

Returns current user and tenant context.

#### Response

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "usr_123",
      "email": "analyst@example.com",
      "name": "Analyst User",
      "role": "analyst"
    },
    "tenant": {
      "id": "ten_123",
      "name": "Lingkar Demo",
      "slug": "lingkar-demo"
    }
  }
}
```

### POST `/api/v1/auth/login`

#### Request

```json
{
  "email": "admin@example.com",
  "password": "password"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "usr_123",
      "email": "admin@example.com",
      "name": "Admin",
      "role": "admin"
    }
  }
}
```

### POST `/api/v1/auth/logout`

#### Response

```json
{
  "ok": true,
  "data": {
    "loggedOut": true
  }
}
```

---

## 14.2 Dashboard API

### GET `/api/v1/dashboard/summary`

#### Query Parameters

```text
topicId?=<uuid>
dateFrom?=<iso>
dateTo?=<iso>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "totalMentions": 423311,
    "socialMentions": 422144,
    "newsMentions": 967,
    "activeTopics": 2,
    "activeRiskEvents": 8,
    "negativeSpikeCount": 3,
    "estimatedReach": 12003000,
    "engagementTotal": 884200,
    "sentiment": {
      "positive": 69500,
      "negative": 45400,
      "neutral": 158000,
      "mixed": 500
    },
    "platformDistribution": [
      { "platform": "x", "count": 270100 },
      { "platform": "news", "count": 967 },
      { "platform": "youtube", "count": 337 }
    ]
  }
}
```

### GET `/api/v1/dashboard/latest-risk-events`

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "risk_123",
        "topicId": "topic_123",
        "code": "RE-001",
        "title": "Negative issue around policy transparency",
        "severity": "high",
        "score": 74,
        "status": "new",
        "lastSeenAt": "2026-05-22T10:00:00Z"
      }
    ]
  }
}
```

### GET `/api/v1/dashboard/geo-distribution`

#### Query Parameters

```text
topicId?=<uuid>
dateFrom?=<iso>
dateTo?=<iso>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "regions": [
      {
        "regionCode": "ID-JK",
        "regionName": "DKI Jakarta",
        "mentionCount": 1200,
        "sentiment": {
          "positive": 300,
          "negative": 500,
          "neutral": 400
        }
      }
    ]
  }
}
```

---

## 14.3 Topic API

### GET `/api/v1/topics`

#### Query Parameters

```text
status?=active|paused|archived
q?=<search>
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "topic_123",
        "title": "Pidato Presiden",
        "description": "Monitor public response to presidential speech",
        "category": "Politics",
        "keywords": ["pidato presiden", "prabowo"],
        "excludeKeywords": ["joke"],
        "platforms": ["gdelt", "rss", "youtube", "x"],
        "languages": ["id", "en"],
        "regions": ["ID"],
        "status": "active",
        "createdAt": "2026-05-22T10:00:00Z",
        "updatedAt": "2026-05-22T10:00:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### POST `/api/v1/topics`

#### Request

```json
{
  "title": "Pidato Presiden",
  "description": "Monitor public response to presidential speech",
  "category": "Politics",
  "keywords": ["pidato presiden", "prabowo", "rupiah"],
  "excludeKeywords": ["parody", "unrelated"],
  "platforms": ["gdelt", "rss", "youtube", "x"],
  "languages": ["id"],
  "regions": ["ID"],
  "collectionFrequencyMinutes": 60
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "topic_123",
    "title": "Pidato Presiden",
    "status": "active"
  }
}
```

### GET `/api/v1/topics/:topicId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "topic_123",
    "title": "Pidato Presiden",
    "description": "Monitor public response to presidential speech",
    "category": "Politics",
    "keywords": ["pidato presiden", "prabowo"],
    "excludeKeywords": ["parody"],
    "platforms": ["gdelt", "rss", "youtube", "x"],
    "languages": ["id"],
    "regions": ["ID"],
    "status": "active",
    "collectionFrequencyMinutes": 60,
    "createdAt": "2026-05-22T10:00:00Z",
    "updatedAt": "2026-05-22T10:00:00Z"
  }
}
```

### PATCH `/api/v1/topics/:topicId`

#### Request

```json
{
  "title": "Pidato Presiden Updated",
  "keywords": ["pidato presiden", "prabowo", "ekonomi"],
  "excludeKeywords": ["parody"],
  "platforms": ["gdelt", "rss", "youtube", "x", "instagram"]
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "topic_123",
    "updatedAt": "2026-05-22T11:00:00Z"
  }
}
```

### POST `/api/v1/topics/:topicId/pause`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "topic_123",
    "status": "paused"
  }
}
```

### POST `/api/v1/topics/:topicId/resume`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "topic_123",
    "status": "active"
  }
}
```

### DELETE `/api/v1/topics/:topicId`

Soft archive by default.

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "topic_123",
    "status": "archived"
  }
}
```

---

## 14.4 Connector API

### GET `/api/v1/connectors`

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "conn_gdelt",
        "platform": "gdelt",
        "name": "GDELT",
        "mode": "free",
        "status": "active",
        "enabled": true,
        "monthlyBudgetUsd": 0,
        "currentMonthSpendUsd": 0,
        "currentMonthRequests": 120,
        "lastHealthCheckAt": "2026-05-22T10:00:00Z",
        "lastHealthMessage": "OK"
      },
      {
        "id": "conn_x",
        "platform": "x",
        "name": "X API",
        "mode": "paid_api",
        "status": "active",
        "enabled": true,
        "monthlyBudgetUsd": 500,
        "currentMonthSpendUsd": 122.5,
        "currentMonthRequests": 6400,
        "lastHealthCheckAt": "2026-05-22T10:00:00Z",
        "lastHealthMessage": "OK"
      }
    ]
  }
}
```

### POST `/api/v1/connectors`

#### Request

```json
{
  "platform": "x",
  "name": "X API",
  "mode": "paid_api",
  "enabled": true,
  "rateLimitPerMinute": 60,
  "dailyRequestLimit": 2000,
  "monthlyBudgetUsd": 500
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "conn_x",
    "platform": "x",
    "status": "not_configured"
  }
}
```

### PATCH `/api/v1/connectors/:connectorId`

#### Request

```json
{
  "enabled": true,
  "monthlyBudgetUsd": 750,
  "dailyRequestLimit": 3000
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "conn_x",
    "updatedAt": "2026-05-22T11:00:00Z"
  }
}
```

### POST `/api/v1/connectors/:connectorId/credentials`

Secrets must never be returned to frontend after creation.

#### Request

```json
{
  "payload": {
    "apiKey": "secret",
    "apiSecret": "secret",
    "bearerToken": "secret"
  }
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "connectorId": "conn_x",
    "credentialConfigured": true
  }
}
```

### POST `/api/v1/connectors/:connectorId/test`

#### Response

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "status": "active",
    "message": "Connection successful",
    "details": {
      "remainingDailyRequests": 1800
    }
  }
}
```

### GET `/api/v1/connectors/:connectorId/usage`

#### Query Parameters

```text
month=2026-05
```

#### Response

```json
{
  "ok": true,
  "data": {
    "connectorId": "conn_x",
    "month": "2026-05",
    "monthlyBudgetUsd": 500,
    "currentSpendUsd": 122.5,
    "remainingBudgetUsd": 377.5,
    "requestCount": 6400,
    "events": [
      {
        "id": "usage_1",
        "endpoint": "recent_search",
        "requestCount": 1,
        "estimatedCostUsd": 0.01,
        "actualCostUsd": 0.01,
        "createdAt": "2026-05-22T10:00:00Z"
      }
    ]
  }
}
```

---

## 14.5 Ingestion API

### POST `/api/v1/topics/:topicId/ingestion-jobs`

Starts ingestion job.

#### Request

```json
{
  "connectorIds": ["conn_gdelt", "conn_rss", "conn_youtube", "conn_x"],
  "jobType": "manual",
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z",
  "maxItemsPerConnector": 500
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "jobs": [
      {
        "id": "job_1",
        "connectorId": "conn_gdelt",
        "status": "queued"
      },
      {
        "id": "job_2",
        "connectorId": "conn_x",
        "status": "queued"
      }
    ]
  }
}
```

### GET `/api/v1/ingestion-jobs`

#### Query Parameters

```text
topicId?=<uuid>
connectorId?=<uuid>
status?=queued|running|completed|failed|cancelled
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "job_1",
        "topicId": "topic_123",
        "connectorId": "conn_gdelt",
        "jobType": "manual",
        "status": "completed",
        "fetchedCount": 500,
        "insertedCount": 420,
        "skippedCount": 80,
        "errorCount": 0,
        "startedAt": "2026-05-22T10:00:00Z",
        "finishedAt": "2026-05-22T10:03:00Z",
        "createdAt": "2026-05-22T10:00:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### GET `/api/v1/ingestion-jobs/:jobId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "job_1",
    "status": "completed",
    "fetchedCount": 500,
    "insertedCount": 420,
    "skippedCount": 80,
    "errorCount": 0,
    "errors": []
  }
}
```

### POST `/api/v1/ingestion-jobs/:jobId/cancel`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "job_1",
    "status": "cancelled"
  }
}
```

---

## 14.6 Mention / Raw Data API

### GET `/api/v1/topics/:topicId/mentions`

#### Query Parameters

```text
platform?=x|youtube|gdelt|rss|instagram|facebook|tiktok
sentiment?=positive|negative|neutral|mixed|unknown
isIrrelevant?=true|false
q?=<search text>
dateFrom?=<iso>
dateTo?=<iso>
sort?=publishedAt:desc|engagementTotal:desc|reachEstimate:desc|sentiment:asc
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "mention_123",
        "topicId": "topic_123",
        "platform": "x",
        "sourceType": "social_post",
        "sourceUrl": "https://x.com/example/status/123",
        "title": null,
        "text": "Public discussion text...",
        "language": "id",
        "author": {
          "username": "example",
          "displayName": "Example User",
          "profileUrl": "https://x.com/example",
          "followersCount": 12000,
          "verified": false
        },
        "publishedAt": "2026-05-22T10:00:00Z",
        "metrics": {
          "views": 5000,
          "likes": 100,
          "comments": 20,
          "shares": 30,
          "engagementTotal": 150,
          "reachEstimate": 12000
        },
        "nlp": {
          "sentiment": "negative",
          "sentimentConfidence": 0.83,
          "emotions": ["anger"],
          "intent": "complaint",
          "entities": [
            {
              "text": "Prabowo",
              "normalizedName": "Prabowo Subianto",
              "type": "person",
              "confidence": 0.91,
              "sentiment": "negative"
            }
          ]
        },
        "quality": {
          "isDuplicate": false,
          "isIrrelevant": false,
          "relevanceScore": 0.88,
          "automationLikelihood": 0.22,
          "sourceReliability": 0.75
        }
      }
    ],
    "pageInfo": {
      "nextCursor": "abc",
      "previousCursor": null,
      "hasNextPage": true,
      "hasPreviousPage": false
    },
    "totalEstimate": 7565
  }
}
```

### GET `/api/v1/mentions/:mentionId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "mention_123",
    "topicId": "topic_123",
    "platform": "x",
    "sourceType": "social_post",
    "sourceUrl": "https://x.com/example/status/123",
    "text": "Public discussion text...",
    "author": {
      "username": "example",
      "displayName": "Example User"
    },
    "metrics": {
      "likes": 100,
      "comments": 20,
      "shares": 30,
      "engagementTotal": 150
    },
    "nlp": {
      "sentiment": "negative",
      "sentimentConfidence": 0.83
    },
    "quality": {
      "isIrrelevant": false
    }
  }
}
```

### PATCH `/api/v1/mentions/:mentionId/sentiment`

#### Request

```json
{
  "sentiment": "positive",
  "reason": "Manual analyst correction"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "mention_123",
    "sentiment": "positive",
    "updatedAt": "2026-05-22T11:00:00Z"
  }
}
```

### PATCH `/api/v1/mentions/:mentionId/relevance`

#### Request

```json
{
  "isIrrelevant": true,
  "reason": "Unrelated to monitored topic"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "mention_123",
    "isIrrelevant": true,
    "updatedAt": "2026-05-22T11:00:00Z"
  }
}
```

### GET `/api/v1/topics/:topicId/mentions/export.csv`

Exports mentions based on current filters.

#### Query Parameters

Same as mentions list.

#### Response

```text
Content-Type: text/csv
Content-Disposition: attachment; filename="mentions-topic_123.csv"
```

---

## 14.7 Topic Overview Analytics API

### GET `/api/v1/topics/:topicId/overview`

#### Query Parameters

```text
dateFrom?=<iso>
dateTo?=<iso>
includeIrrelevant?=false
```

#### Response

```json
{
  "ok": true,
  "data": {
    "topicId": "topic_123",
    "metrics": {
      "mentions": 273100,
      "reachEstimate": 100630000,
      "interactions": 118000000,
      "positive": 69500,
      "negative": 45400,
      "neutral": 158200,
      "mixed": 0
    },
    "platformCounts": [
      { "platform": "x", "count": 270100 },
      { "platform": "news", "count": 746 },
      { "platform": "instagram", "count": 740 },
      { "platform": "facebook", "count": 693 },
      { "platform": "tiktok", "count": 539 },
      { "platform": "youtube", "count": 337 }
    ]
  }
}
```

### GET `/api/v1/topics/:topicId/timeseries`

#### Query Parameters

```text
metric=mentions|reachEstimate|engagementTotal|sentiment
interval=hour|day|week
dateFrom=<iso>
dateTo=<iso>
platform?=x
```

#### Response

```json
{
  "ok": true,
  "data": {
    "interval": "day",
    "series": [
      {
        "timestamp": "2026-05-15T00:00:00Z",
        "mentions": 50000,
        "reachEstimate": 200000,
        "positive": 1000,
        "negative": 2000,
        "neutral": 47000
      }
    ]
  }
}
```

### GET `/api/v1/topics/:topicId/platform-distribution`

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      { "platform": "x", "count": 270100, "percentage": 98.8 },
      { "platform": "facebook", "count": 900, "percentage": 0.3 },
      { "platform": "news", "count": 746, "percentage": 0.3 }
    ]
  }
}
```

### GET `/api/v1/topics/:topicId/sentiment-by-platform`

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "platform": "x",
        "positive": 69000,
        "negative": 45000,
        "neutral": 156000,
        "mixed": 100
      }
    ]
  }
}
```

---

## 14.8 AI Insight API

### POST `/api/v1/topics/:topicId/ai/insights/generate`

#### Request

```json
{
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z",
  "focus": "executive_summary",
  "maxEvidence": 5
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "jobId": "ai_job_123",
    "status": "queued"
  }
}
```

### GET `/api/v1/topics/:topicId/ai/insights`

#### Query Parameters

```text
type?=summary|issue|risk_event|opportunity|entity|daily_brief
limit?=20
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "insight_123",
        "type": "summary",
        "title": "Public discussion increased around economic policy",
        "summary": "Mentions increased across X and news sources over the selected period.",
        "whyItMatters": "The conversation may influence public trust and policy perception.",
        "impact": "Potential reputational risk if not addressed.",
        "recommendation": "Prepare a concise clarification and monitor top sources.",
        "metrics": {
          "mentionCount": 1200,
          "reachEstimate": 500000,
          "engagementTotal": 45000,
          "negativeCount": 420
        },
        "evidenceMentionIds": ["mention_1", "mention_2", "mention_3"],
        "confidence": 0.82,
        "generatedAt": "2026-05-22T11:00:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### GET `/api/v1/ai/jobs/:jobId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "ai_job_123",
    "status": "completed",
    "resultType": "insight",
    "resultId": "insight_123",
    "startedAt": "2026-05-22T11:00:00Z",
    "finishedAt": "2026-05-22T11:01:00Z"
  }
}
```

---

## 14.9 Issue Cluster API

### POST `/api/v1/topics/:topicId/ai/issues/cluster`

#### Request

```json
{
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z",
  "minMentions": 5,
  "maxClusters": 20
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "jobId": "cluster_job_123",
    "status": "queued"
  }
}
```

### GET `/api/v1/topics/:topicId/issues`

#### Query Parameters

```text
sentiment?=positive|negative|neutral|mixed
status?=active|dismissed
sort?=mentionCount:desc|engagementTotal:desc|reachEstimate:desc
limit?=20
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "issue_123",
        "title": "Concerns about policy transparency",
        "summary": "A cluster of negative mentions discussing transparency and public communication.",
        "sentiment": "negative",
        "trendDirection": "rising",
        "mentionCount": 250,
        "engagementTotal": 12000,
        "reachEstimate": 350000,
        "confidence": 0.79,
        "sampleMentionIds": ["mention_1", "mention_2", "mention_3"]
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### PATCH `/api/v1/issues/:issueId`

#### Request

```json
{
  "status": "dismissed",
  "reason": "Duplicate of another issue"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "issue_123",
    "status": "dismissed"
  }
}
```

---

## 14.10 Risk Event API

### POST `/api/v1/topics/:topicId/ai/risk-events/detect`

#### Request

```json
{
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z",
  "minScore": 40
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "jobId": "risk_job_123",
    "status": "queued"
  }
}
```

### GET `/api/v1/topics/:topicId/risk-events`

#### Query Parameters

```text
severity?=critical|high|medium|low
status?=new|reviewing|acknowledged|resolved|dismissed
sentiment?=negative|mixed|neutral
sort?=score:desc|lastSeenAt:desc|mentions:desc
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "risk_123",
        "code": "RE-001",
        "title": "Manipulation narrative around export policy",
        "summary": "Public conversation suggests a reputational risk around export policy transparency.",
        "category": "reputation",
        "severity": "high",
        "sentiment": "negative",
        "score": 78,
        "keyTrigger": "A viral post accusing policy inconsistency",
        "narrativeTags": ["transparency", "export", "public trust"],
        "metrics": {
          "mentions": 120,
          "reachEstimate": 678000,
          "engagementTotal": 34000,
          "velocityScore": 0.72
        },
        "firstSeenAt": "2026-05-21T08:00:00Z",
        "lastSeenAt": "2026-05-22T10:00:00Z",
        "evidenceMentionIds": ["mention_1", "mention_2", "mention_3"],
        "status": "new"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### GET `/api/v1/risk-events/:riskEventId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "risk_123",
    "code": "RE-001",
    "title": "Manipulation narrative around export policy",
    "summary": "Public conversation suggests a reputational risk around export policy transparency.",
    "category": "reputation",
    "severity": "high",
    "score": 78,
    "keyTrigger": "A viral post accusing policy inconsistency",
    "narrativeTags": ["transparency", "export", "public trust"],
    "evidence": [
      {
        "mentionId": "mention_1",
        "platform": "x",
        "text": "Evidence post text...",
        "sourceUrl": "https://x.com/example/status/123"
      }
    ],
    "status": "new"
  }
}
```

### PATCH `/api/v1/risk-events/:riskEventId`

#### Request

```json
{
  "status": "acknowledged"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "risk_123",
    "status": "acknowledged",
    "updatedAt": "2026-05-22T11:00:00Z"
  }
}
```

---

## 14.11 Entity API

### GET `/api/v1/topics/:topicId/entities`

#### Query Parameters

```text
type?=person|organization|location|event|product|other
sort?=mentions:desc|reachEstimate:desc|mostPositive:desc|mostNegative:desc
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "entity_123",
        "normalizedName": "Prabowo Subianto",
        "type": "person",
        "mentionCount": 1500,
        "reachEstimate": 1200000,
        "engagementTotal": 95000,
        "sentiment": {
          "positive": 40,
          "neutral": 25,
          "negative": 35
        },
        "summary": "Frequently mentioned in discussions around economic policy.",
        "topIssues": [
          {
            "title": "Currency stability",
            "mentionCount": 120,
            "percentage": 8
          }
        ]
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

---

## 14.12 Actor Monitoring API

### GET `/api/v1/actors`

#### Query Parameters

```text
platform?=x|youtube|instagram|facebook|tiktok
status?=pending|active|limited|failed
riskLevel?=critical|high|moderate|low
opportunityLevel?=excellent|good|fair|poor
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "actor_123",
        "platform": "x",
        "username": "example",
        "displayName": "Example User",
        "profileUrl": "https://x.com/example",
        "monitoringReason": "Potential influencer",
        "tags": ["politics", "media"],
        "status": "active",
        "riskScore": 22,
        "riskLevel": "low",
        "opportunityScore": 78,
        "opportunityLevel": "good",
        "lastRefreshedAt": "2026-05-22T10:00:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### POST `/api/v1/actors`

#### Request

```json
{
  "platform": "x",
  "username": "example",
  "displayName": "Example User",
  "profileUrl": "https://x.com/example",
  "monitoringReason": "Potential influencer",
  "tags": ["politics", "media"]
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "actor_123",
    "status": "pending"
  }
}
```

### POST `/api/v1/actors/:actorId/refresh`

#### Response

```json
{
  "ok": true,
  "data": {
    "jobId": "actor_job_123",
    "status": "queued"
  }
}
```

### GET `/api/v1/actors/:actorId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "actor_123",
    "platform": "x",
    "username": "example",
    "displayName": "Example User",
    "riskScore": 22,
    "riskLevel": "low",
    "riskExplanation": "Low negative ratio and moderate engagement velocity.",
    "opportunityScore": 78,
    "opportunityLevel": "good",
    "opportunityExplanation": "Positive engagement and relevant audience alignment.",
    "recentMentions": ["mention_1", "mention_2"]
  }
}
```

---

## 14.13 Automation Likelihood API

### POST `/api/v1/automation-likelihood/analyze`

Do not call this Bot Detection in the UI.

#### Request

```json
{
  "platform": "x",
  "username": "example"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "platform": "x",
    "username": "example",
    "score": 72,
    "label": "high_automation_likelihood",
    "explanation": "The account shows high posting frequency, repeated text patterns, and abnormal engagement timing.",
    "signals": [
      {
        "name": "posting_frequency",
        "score": 0.82,
        "description": "High posting frequency over a short time window."
      },
      {
        "name": "content_repetition",
        "score": 0.76,
        "description": "Repeated or highly similar content detected."
      }
    ],
    "disclaimer": "This is not a definitive bot classification. It only indicates automation-like signals."
  }
}
```

---

## 14.14 Alert API

### GET `/api/v1/alerts/rules`

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "alert_123",
        "topicId": "topic_123",
        "name": "Negative Spike Alert",
        "type": "negative_sentiment_spike",
        "enabled": true,
        "severity": "high",
        "channels": ["email", "in_app"],
        "config": {
          "thresholdPercentage": 30,
          "windowHours": 24
        }
      }
    ]
  }
}
```

### POST `/api/v1/alerts/rules`

#### Request

```json
{
  "topicId": "topic_123",
  "name": "Negative Spike Alert",
  "type": "negative_sentiment_spike",
  "enabled": true,
  "severity": "high",
  "channels": ["email", "in_app"],
  "config": {
    "thresholdPercentage": 30,
    "windowHours": 24,
    "recipients": ["analyst@example.com"]
  }
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "alert_123"
  }
}
```

### PATCH `/api/v1/alerts/rules/:ruleId`

#### Request

```json
{
  "enabled": false
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "alert_123",
    "enabled": false
  }
}
```

### GET `/api/v1/alerts/events`

#### Query Parameters

```text
topicId?=<uuid>
status?=new|acknowledged|dismissed
severity?=critical|high|medium|low
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "alert_event_123",
        "alertRuleId": "alert_123",
        "topicId": "topic_123",
        "title": "Negative sentiment spike detected",
        "message": "Negative mentions increased by 42% in the last 24 hours.",
        "severity": "high",
        "evidence": [
          {
            "mentionId": "mention_123",
            "text": "Evidence text..."
          }
        ],
        "status": "new",
        "triggeredAt": "2026-05-22T10:00:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### POST `/api/v1/alerts/events/:eventId/acknowledge`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "alert_event_123",
    "status": "acknowledged"
  }
}
```

---

## 14.15 Report API

### POST `/api/v1/reports`

#### Request

```json
{
  "topicId": "topic_123",
  "reportType": "topic_report",
  "title": "Pidato Presiden Topic Report",
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z",
  "sections": [
    "executive_summary",
    "topic_metrics",
    "sentiment_breakdown",
    "platform_distribution",
    "top_issues",
    "risk_events",
    "top_entities",
    "evidence",
    "recommendations"
  ],
  "format": "pdf"
}
```

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "report_123",
    "status": "queued"
  }
}
```

### GET `/api/v1/reports`

#### Query Parameters

```text
topicId?=<uuid>
status?=queued|running|completed|failed
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "report_123",
        "topicId": "topic_123",
        "reportType": "topic_report",
        "title": "Pidato Presiden Topic Report",
        "status": "completed",
        "dateFrom": "2026-05-01T00:00:00Z",
        "dateTo": "2026-05-22T23:59:59Z",
        "createdAt": "2026-05-22T10:00:00Z",
        "finishedAt": "2026-05-22T10:02:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

### GET `/api/v1/reports/:reportId`

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "report_123",
    "topicId": "topic_123",
    "reportType": "topic_report",
    "title": "Pidato Presiden Topic Report",
    "status": "completed",
    "downloadUrl": "/api/v1/reports/report_123/download",
    "createdAt": "2026-05-22T10:00:00Z",
    "finishedAt": "2026-05-22T10:02:00Z"
  }
}
```

### GET `/api/v1/reports/:reportId/download`

#### Response

```text
Content-Type: application/pdf
Content-Disposition: attachment; filename="civicfalcon-report.pdf"
```

---

## 14.16 Audit Log API

### GET `/api/v1/audit-logs`

Admin only.

#### Query Parameters

```text
action?=<action>
entityType?=<entity type>
userId?=<uuid>
dateFrom?=<iso>
dateTo?=<iso>
limit?=50
cursor?=<cursor>
```

#### Response

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "audit_123",
        "actorUserId": "usr_123",
        "action": "mention.sentiment.updated",
        "entityType": "mention",
        "entityId": "mention_123",
        "before": {
          "sentiment": "negative"
        },
        "after": {
          "sentiment": "positive"
        },
        "createdAt": "2026-05-22T11:00:00Z"
      }
    ],
    "pageInfo": {
      "nextCursor": null,
      "previousCursor": null,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

---

## 15. Frontend Pages and Required API Calls

### 15.1 `/dashboard`

Consumes:

- `GET /dashboard/summary`
- `GET /dashboard/latest-risk-events`
- `GET /dashboard/geo-distribution`
- `GET /topics`

### 15.2 `/topics`

Consumes:

- `GET /topics`
- `POST /topics`
- `PATCH /topics/:topicId`
- `DELETE /topics/:topicId`

### 15.3 `/topics/:topicId/overview`

Consumes:

- `GET /topics/:topicId`
- `GET /topics/:topicId/overview`
- `GET /topics/:topicId/timeseries`
- `GET /topics/:topicId/platform-distribution`
- `GET /topics/:topicId/sentiment-by-platform`

### 15.4 `/topics/:topicId/raw-data`

Consumes:

- `GET /topics/:topicId/mentions`
- `PATCH /mentions/:mentionId/sentiment`
- `PATCH /mentions/:mentionId/relevance`
- `GET /topics/:topicId/mentions/export.csv`

### 15.5 `/topics/:topicId/ai-insights`

Consumes:

- `POST /topics/:topicId/ai/insights/generate`
- `GET /topics/:topicId/ai/insights`
- `GET /ai/jobs/:jobId`

### 15.6 `/topics/:topicId/issues`

Consumes:

- `POST /topics/:topicId/ai/issues/cluster`
- `GET /topics/:topicId/issues`
- `PATCH /issues/:issueId`

### 15.7 `/topics/:topicId/risk-events`

Consumes:

- `POST /topics/:topicId/ai/risk-events/detect`
- `GET /topics/:topicId/risk-events`
- `GET /risk-events/:riskEventId`
- `PATCH /risk-events/:riskEventId`

### 15.8 `/topics/:topicId/entities`

Consumes:

- `GET /topics/:topicId/entities`

### 15.9 `/actors`

Consumes:

- `GET /actors`
- `POST /actors`
- `GET /actors/:actorId`
- `POST /actors/:actorId/refresh`
- `POST /automation-likelihood/analyze`

### 15.10 `/connectors`

Consumes:

- `GET /connectors`
- `POST /connectors`
- `PATCH /connectors/:connectorId`
- `POST /connectors/:connectorId/credentials`
- `POST /connectors/:connectorId/test`
- `GET /connectors/:connectorId/usage`

### 15.11 `/ingestion-jobs`

Consumes:

- `GET /ingestion-jobs`
- `GET /ingestion-jobs/:jobId`
- `POST /ingestion-jobs/:jobId/cancel`

### 15.12 `/alerts`

Consumes:

- `GET /alerts/rules`
- `POST /alerts/rules`
- `PATCH /alerts/rules/:ruleId`
- `GET /alerts/events`
- `POST /alerts/events/:eventId/acknowledge`

### 15.13 `/reports`

Consumes:

- `GET /reports`
- `POST /reports`
- `GET /reports/:reportId`
- `GET /reports/:reportId/download`

### 15.14 `/commander` (AI Commander)

Unified chat-driven control surface that orchestrates every backend capability via typed tool calls (full design in §32).

Consumes:

- `POST /commander/conversations` — start a new conversation
- `GET /commander/conversations` — list user's conversations
- `GET /commander/conversations/:conversationId` — load history
- `POST /commander/conversations/:conversationId/messages` — send a user message (server streams assistant tokens + tool invocations via SSE)
- `GET /commander/tools` — list available tools and JSON Schemas (admin debug)
- `GET /commander/tool-invocations/:invocationId` — fetch full tool result for a card
- `POST /commander/macros` — save a conversation as a re-runnable macro
- `POST /commander/macros/:macroId/run` — execute a saved macro

UI must render typed tool results as cards (mention list, time-series chart, entity comparison, report link), not raw markdown. Every factual claim must cite at least 3 `mentionId`s — uncited claims are visually flagged.

---

## 16. Analytics Definitions

### 16.1 Mentions

Number of non-irrelevant records matching the topic.

### 16.2 Reach Estimate

Estimated exposure based on available source metadata.

Formula v0.1:

```text
reach_estimate = author_followers_count OR views OR source_default_estimate
```

### 16.3 Engagement Total

Formula:

```text
engagement_total = likes + comments + shares + reposts + quotes + saves
```

### 16.4 Sentiment

Allowed values:

```text
positive
negative
neutral
mixed
unknown
```

Manual analyst correction overrides automated sentiment.

### 16.5 Risk Score

v0.1 formula:

```text
risk_score =
  negative_sentiment_weight
+ engagement_velocity_weight
+ reach_estimate_weight
+ source_reliability_weight
+ actor_influence_weight
+ issue_category_weight
- duplicate_penalty
- low_relevance_penalty
```

Severity thresholds:

| Score | Severity |
|---:|---|
| 80–100 | Critical |
| 60–79 | High |
| 40–59 | Medium |
| 0–39 | Low |

---

## 17. AI Prompting and Evidence Rules

### 17.1 AI Must Not Invent Evidence

Every AI insight must be generated from selected evidence mentions.

The prompt must include:

- Topic title
- Date range
- Aggregate metrics
- Evidence mentions
- Required output schema

### 17.2 AI Output Schema

```ts
export type GenerateInsightOutput = {
  title: string;
  summary: string;
  whyItMatters: string;
  impact: string;
  recommendation: string;
  confidence: number;
  evidenceMentionIds: string[];
};
```

### 17.3 AI Refusal Case

If there is insufficient evidence, return:

```json
{
  "title": "Insufficient evidence",
  "summary": "There are not enough relevant mentions to generate a reliable insight.",
  "confidence": 0.1,
  "evidenceMentionIds": []
}
```

---

## 18. Safety and Compliance Requirements

### 18.1 Data Collection

The system may ingest:

- Public data.
- Authorized account data.
- Licensed API data.
- Manual user-uploaded data.

The system must not ingest:

- Private messages.
- Private groups.
- Login-protected content unless explicitly authorized by API terms.
- Content collected by bypassing platform restrictions.

### 18.2 Bot/Automation Wording

Do not use:

```text
This account is a bot.
```

Use:

```text
This account shows high automation-like behavior based on posting frequency, repetition, and engagement patterns.
```

### 18.3 Demographic Wording

Do not present inferred demographic signals as fact.

Use:

```text
The available public signals suggest a likely audience segment, but confidence is limited.
```

---

## 19. Security Requirements

### 19.1 Required Security Controls

1. Encrypt connector credentials at rest.
2. Never return secrets to frontend.
3. Never log secrets.
4. Validate all request bodies with Zod.
5. Escape user-generated and external content in UI.
6. Add rate limiting to API endpoints.
7. Add audit logs for critical changes.
8. Use role-based access checks.
9. Use secure cookies if cookie sessions are used.
10. Protect report downloads with auth.

### 19.2 Audit Events

Log:

```text
topic.created
topic.updated
topic.archived
connector.created
connector.updated
connector.credential.updated
connector.tested
ingestion.started
ingestion.cancelled
mention.sentiment.updated
mention.relevance.updated
insight.generated
risk_event.updated
alert_rule.created
alert_rule.updated
report.generated
user.login
```

---

## 20. Cost Control Requirements

### 20.1 Connector Budget Controls

Each paid connector must have:

- Monthly budget USD.
- Daily request limit.
- Per-job max items.
- Current month spend.
- Current month request count.
- Budget exceeded status.

### 20.2 AI Budget Controls

AI service must have:

- Monthly budget USD.
- Per-job max evidence mentions.
- Model selection.
- Token estimate logging.
- Job rejection if budget exceeded.

### 20.3 Required Behavior

If a budget cap is reached:

1. Connector status becomes `budget_exceeded`.
2. Ingestion for that connector is paused.
3. UI shows clear warning.
4. Other connectors continue to work.

### 20.4 Caching Layer (mandatory)

All external API calls must route through a Redis-backed cache keyed by `sha256(provider, endpoint, normalized_params)`:

- Web search: 6h TTL
- News/RSS lookups: 15min TTL
- Social platform reads: 5–30min TTL depending on endpoint
- LLM insight generation: cache key includes the sorted list of evidence `mentionId`s; same input set returns same insight without re-spending tokens

Cross-topic deduplication: if two topics issue the same upstream query within TTL, the second call is served from cache.

### 20.5 LLM Cost Tiering (mandatory)

AI service must route tasks to model tiers by cost class:

| Tier | Use cases | Example models |
|---|---|---|
| Local / tiny | language detect, sentiment, NER, intent, irrelevance filter | fastText, RoBERTa-sentiment, spaCy, local Llama 3.x 8B |
| Small hosted | issue cluster titles, short summaries, query rewriting | GPT-4o-mini, Claude Haiku, Llama 3.1 8B hosted |
| Frontier | final topic summary, risk explanation, report narrative, Commander reasoning | GPT-4-class, Claude Sonnet |

Rules:

- Default to the cheapest tier that meets the task SLA.
- Cluster-then-summarize: pass cluster centroids to the frontier model, never raw mention sets > 50 items.
- Embed once per mention (pgvector); reuse for clustering, dedup, semantic search, similar-mention lookup.
- Stream LLM output; cancel as soon as the consumer has what it needs.

### 20.6 AI Commander Cost Guards

Per-user (and per-tenant) daily token budgets enforced by the Commander runtime:

- Soft cap (e.g. 80%): warning banner, throttle to small-tier models only.
- Hard cap: new conversations rejected; existing conversations read-only.
- Tool-result truncation before re-feeding to the LLM: top-K only, snippets not full text.
- System prompt forces `search_mentions` before any paid external tool; cached insights (< 6h) must be reused via `get_recent_insight` before regeneration.
- Conversation pruning: keep last N turns + a rolling summary; drop stale tool outputs.

---

## 21. Background Jobs

### 21.1 Queues

Use BullMQ queues:

```text
ingestion
nlp-enrichment
ai-generation
report-generation
alert-evaluation
actor-refresh
```

### 21.2 Job Payload Examples

#### Ingestion Job

```json
{
  "jobId": "job_123",
  "tenantId": "tenant_123",
  "topicId": "topic_123",
  "connectorId": "conn_x",
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z",
  "maxItems": 500
}
```

#### AI Generation Job

```json
{
  "jobId": "ai_job_123",
  "tenantId": "tenant_123",
  "topicId": "topic_123",
  "type": "insight",
  "dateFrom": "2026-05-01T00:00:00Z",
  "dateTo": "2026-05-22T23:59:59Z"
}
```

#### Report Job

```json
{
  "reportId": "report_123",
  "tenantId": "tenant_123",
  "topicId": "topic_123",
  "reportType": "topic_report",
  "format": "pdf"
}
```

---

## 22. Frontend Implementation Plan

### 22.1 Layout

Main layout:

```text
Sidebar
Topbar
Content area
Global date/topic filter
Connector status indicator
```

### 22.2 Navigation

```text
Dashboard
Topics
  Overview
  Raw Data
  AI Insights
  Issues
  Risk Events
  Entities
Actors
Connectors
Ingestion Jobs
Alerts
Reports
Settings
```

### 22.3 Key Components

```text
MetricCard
PlatformBadge
SentimentBadge
RiskSeverityBadge
ConnectorStatusBadge
TopicSelector
DateRangePicker
MentionTable
EvidenceMentionList
InsightCard
IssueClusterCard
RiskEventCard
EntityCard
UsageBudgetBar
ReportStatusBadge
```

### 22.4 Data Fetching Rules

1. Use TanStack Query for all API reads.
2. Use optimistic update only for simple UI toggles.
3. Invalidate related query keys after mutation.
4. Poll background job status every 2–5 seconds while running.
5. Stop polling after terminal status.

---

## 23. Backend Implementation Plan

### 23.1 Modules

```text
modules/auth
modules/topics
modules/connectors
modules/ingestion
modules/mentions
modules/analytics
modules/ai
modules/issues
modules/risk-events
modules/entities
modules/actors
modules/alerts
modules/reports
modules/audit
```

### 23.2 Service Boundaries

- Route handlers validate request and call services.
- Services implement business logic.
- Repositories handle database operations.
- Connectors handle external API details.
- Workers process long-running jobs.

### 23.3 Route Example Pattern

```ts
app.post('/api/v1/topics', async (request, reply) => {
  const input = CreateTopicSchema.parse(request.body);
  const result = await topicService.createTopic({
    tenantId: request.user.tenantId,
    userId: request.user.id,
    input,
  });
  return reply.send({ ok: true, data: result });
});
```

---

## 24. Suggested Repository Structure

```text
civicfalcon/
  apps/
    web/
      src/
        app/
        pages/
        components/
        features/
          dashboard/
          topics/
          mentions/
          connectors/
          insights/
          risk-events/
          actors/
          alerts/
          reports/
        lib/
          api-client.ts
          query-keys.ts
          formatters.ts
    api/
      src/
        index.ts
        config/
        db/
          schema.ts
          migrations/
        middleware/
        routes/
        modules/
          auth/
          topics/
          connectors/
          ingestion/
          mentions/
          analytics/
          ai/
          issues/
          risk-events/
          entities/
          actors/
          alerts/
          reports/
          audit/
        connectors/
          gdelt/
          rss/
          search/
          facebook/
          instagram/
          youtube/
          x/
          tiktok/
        workers/
        lib/
    worker/
      src/
        index.ts
        queues/
        processors/
  packages/
    shared/
      src/
        types/
        schemas/
        constants/
        api-contracts/
```

---

## 25. v0.1 Milestones

### Milestone 1 — Foundation

Deliver:

1. Monorepo scaffold.
2. Shared types and Zod schemas.
3. PostgreSQL schema.
4. Auth skeleton.
5. Topic CRUD.
6. Connector CRUD.
7. Basic app shell.

Acceptance:

```text
User can log in, create a topic, and configure connectors.
```

### Milestone 2 — OSINT Ingestion

Deliver:

1. RSS connector.
2. GDELT connector.
3. Search connector abstraction.
4. Ingestion jobs.
5. Canonical mention storage.
6. Raw data table.

Acceptance:

```text
User can create a topic, run ingestion, and review raw OSINT mentions.
```

### Milestone 3 — Social Connectors

Deliver:

1. YouTube connector.
2. X connector with budget cap.
3. Facebook connector limited official mode.
4. Instagram connector limited official mode.
5. TikTok connector modes.
6. Manual import fallback.

Acceptance:

```text
User can ingest from YouTube and X, and see honest limitation states for Meta and TikTok.
```

### Milestone 4 — Analytics

Deliver:

1. Topic overview metrics.
2. Platform distribution.
3. Sentiment time series.
4. Sentiment by platform.
5. Manual sentiment correction.
6. Mark irrelevant.
7. CSV export.

Acceptance:

```text
User can analyze a topic, correct records, and export filtered raw data.
```

### Milestone 5 — AI Intelligence

Deliver:

1. AI Insights.
2. Issue clustering.
3. Risk event detection.
4. Top entities.
5. Evidence-backed AI output.
6. Confidence scores.

Acceptance:

```text
User can generate AI insights and risk events with evidence records.
```

### Milestone 6 — Alerts and Reports

Deliver:

1. Alert rules.
2. Alert events.
3. Email/in-app alert support.
4. PDF report generation.
5. Report download.

Acceptance:

```text
User can receive alerts and download a topic report.
```

---

## 26. Definition of Done for v0.1

v0.1 is done when:

1. Topic CRUD works.
2. Connector CRUD works.
3. RSS ingestion works.
4. GDELT/news ingestion works.
5. YouTube ingestion works with quota awareness.
6. X ingestion works with budget caps.
7. Meta connectors show supported and limited states honestly.
8. TikTok connector supports at least disabled/manual/provider-ready modes.
9. Raw data table works.
10. Sentiment correction works.
11. Relevance marking works.
12. Topic overview analytics work.
13. AI insights are evidence-backed.
14. Issue clustering works.
15. Risk event detection works.
16. Entity extraction works.
17. Alerts work.
18. PDF reports work.
19. Usage/cost caps are visible.
20. Audit logs are written.
21. No secrets are logged.
22. API contracts are stable enough for frontend development.

---

## 27. v1.0 Roadmap

### 27.1 Data Platform

1. True multi-tenancy.
2. Tenant quotas.
3. Data retention rules.
4. Partitioned mention tables.
5. OpenSearch or Meilisearch cluster.
6. Object storage for raw payload archive.
7. Materialized aggregates.

### 27.2 Product

1. Topic comparison.
2. Social network analysis.
3. Advanced actor intelligence.
4. Case management.
5. War room mode.
6. Daily/weekly executive brief.
7. PowerPoint export.
8. WhatsApp/Telegram/Teams alerts.
9. Advanced geographic intelligence.
10. Custom client report templates.

### 27.3 AI

1. Prompt registry.
2. Model routing by task.
3. Evaluation dataset.
4. Human feedback loop.
5. Entity resolution graph.
6. Narrative timeline.
7. Prediction/forecasting.
8. Local LLM option.

### 27.4 Connectors

1. Paid social data provider integration.
2. Better TikTok/Instagram coverage through legal provider.
3. Reddit connector.
4. Bluesky connector.
5. Mastodon connector.
6. Telegram public channel monitoring where legally appropriate.
7. Government open data connectors.

---

## 28. First Claude Code / Copilot Task List

Implement in this order:

```text
1. Create monorepo scaffold.
2. Add shared types and Zod schemas.
3. Add PostgreSQL + Drizzle schema.
4. Add auth middleware and seed admin user.
5. Implement Topic CRUD API.
6. Implement Connector CRUD API.
7. Implement connector credential encryption.
8. Implement IngestionJob model and queue.
9. Implement RSS connector.
10. Implement GDELT connector.
11. Implement CanonicalMention persistence.
12. Build Topics frontend page.
13. Build Connectors frontend page.
14. Build Raw Data frontend page.
15. Add sentiment/relevance mutation APIs.
16. Build Overview analytics API and page.
17. Implement YouTube connector.
18. Implement X connector with budget cap.
19. Add Meta/TikTok connector skeletons and limitation UX.
20. Implement AI Insights generation.
21. Implement Issue Clustering.
22. Implement Risk Events.
23. Implement Entities API.
24. Implement Alerts.
25. Implement PDF Reports.
```

Important instruction:

```text
Do not start with charts first. Start with the connector engine, canonical data model, raw data review, and analytics APIs.
```

---

## 29. Engineering Rules

1. Use strict TypeScript.
2. Use Zod for every request body and query parser.
3. Never put connector-specific logic inside React components.
4. Never put external API response formats directly into frontend state.
5. Never log API keys, bearer tokens, cookies, or credentials.
6. Every mutation must write audit log where relevant.
7. Every paid connector must check budget before API calls.
8. Every AI insight must include evidence IDs.
9. Every report must include source/evidence appendix.
10. Every connector limitation must be explicit in UI.

---

## 31. Web Search Provider Architecture

This section is the authoritative spec for the Search Connector (§12.3). All web/OSINT discovery in v0.1 must use this layer.

### 31.1 Why an abstraction

- DuckDuckGo's `html.duckduckgo.com` endpoint serves anomaly/captcha pages to cloud egress IPs and any non-browser POST traffic. Spoofing browser headers may pass intermittently but **violates DDG's ToS and is not reliable**.
- A single search provider is a single point of failure and a single point of cost overrun.
- Different providers have different strengths (Brave = real web results, DDG Instant Answer = quick facts, SearXNG = free aggregator, Tavily = LLM-tuned snippets).

The architecture is a typed `WebSearchProvider` interface + a `WebSearchRouter` that handles caching, budget, and waterfall fallback.

### 31.2 Provider interface

```ts
// packages/search/types.ts
export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;          // provider name
  score?: number;           // 0..1 relevance if provider reports
};

export type SearchOptions = {
  maxResults?: number;
  freshnessDays?: number;
  region?: string;          // e.g. "us-en"
  safeSearch?: "off" | "moderate" | "strict";
  cacheTtlSec?: number;     // default 21600 (6h)
};

export interface WebSearchProvider {
  name: string;
  costPerQueryUsd: number;
  search(query: string, opts: SearchOptions): Promise<SearchResult[]>;
}
```

### 31.3 Built-in providers

#### Brave Search API (preferred paid)

```ts
export class BraveSearchProvider implements WebSearchProvider {
  name = "brave";
  costPerQueryUsd = 0.003;
  constructor(private apiKey: string) {}

  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(opts.maxResults ?? 10));
    if (opts.freshnessDays) url.searchParams.set("freshness", `pd${opts.freshnessDays}`);
    if (opts.safeSearch) url.searchParams.set("safesearch", opts.safeSearch);

    const r = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
    });
    if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
    const json = await r.json();
    return (json.web?.results ?? []).map((x: any) => ({
      title: x.title,
      url: x.url,
      snippet: x.description,
      publishedAt: x.age,
      source: "brave",
    }));
  }
}
```

#### DuckDuckGo Instant Answer (free, zero-click only)

```ts
// Real DDG JSON API. Free, no key, no scraping.
// Limited to zero-click facts (definitions, Wikipedia abstracts, etc).
export class DuckDuckGoInstantProvider implements WebSearchProvider {
  name = "ddg_ia";
  costPerQueryUsd = 0;

  async search(query: string): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`DDG IA HTTP ${r.status}`);
    const j = await r.json();
    const out: SearchResult[] = [];
    if (j.AbstractURL) {
      out.push({ title: j.Heading, url: j.AbstractURL, snippet: j.AbstractText, source: "ddg_ia" });
    }
    for (const t of j.RelatedTopics ?? []) {
      if (t.FirstURL) {
        out.push({
          title: (t.Text ?? "").split(" - ")[0] || t.Text,
          url: t.FirstURL,
          snippet: t.Text,
          source: "ddg_ia",
        });
      }
    }
    return out;
  }
}
```

#### SearXNG (self-hosted aggregator, free)

```ts
export class SearxngProvider implements WebSearchProvider {
  name = "searxng";
  costPerQueryUsd = 0;
  constructor(private baseUrl: string) {}

  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const safe = opts.safeSearch === "strict" ? 2 : opts.safeSearch === "off" ? 0 : 1;
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&format=json&safesearch=${safe}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`SearXNG HTTP ${r.status}`);
    const j = await r.json();
    return (j.results ?? []).slice(0, opts.maxResults ?? 10).map((x: any) => ({
      title: x.title,
      url: x.url,
      snippet: x.content,
      source: "searxng",
      score: x.score,
    }));
  }
}
```

Stand SearXNG up in `docker-compose.yml` next to Postgres and Redis. Zero ongoing cost.

### 31.4 Router (cache + budget + waterfall)

```ts
// packages/search/router.ts
import { createHash } from "node:crypto";

export interface SearchCache {
  get<T>(k: string): Promise<T | null>;
  set<T>(k: string, v: T, ttlSec: number): Promise<void>;
}

export interface SearchBudget {
  canSpend(provider: string, usd: number): Promise<boolean>;
  record(provider: string, usd: number): Promise<void>;
}

export class WebSearchRouter {
  constructor(
    private providers: WebSearchProvider[],     // ordered: cheapest viable first
    private cache: SearchCache,
    private budget: SearchBudget,
    private minResults = 3,
  ) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const key =
      "search:" +
      createHash("sha256").update(JSON.stringify({ query, opts })).digest("hex");

    const hit = await this.cache.get<SearchResult[]>(key);
    if (hit) return hit;

    const errors: string[] = [];
    for (const p of this.providers) {
      if (!(await this.budget.canSpend(p.name, p.costPerQueryUsd))) continue;
      try {
        const results = await p.search(query, opts);
        await this.budget.record(p.name, p.costPerQueryUsd);
        if (results.length >= this.minResults) {
          await this.cache.set(key, results, opts.cacheTtlSec ?? 21600);
          return results;
        }
      } catch (e) {
        errors.push(`${p.name}: ${String(e)}`);
      }
    }
    throw new Error(`All search providers exhausted: ${errors.join("; ") || "no results"}`);
  }
}
```

### 31.5 Wiring

```ts
const router = new WebSearchRouter(
  [
    new SearxngProvider(process.env.SEARXNG_URL!),
    new DuckDuckGoInstantProvider(),
    new BraveSearchProvider(process.env.BRAVE_API_KEY!),
    // new TavilyProvider(process.env.TAVILY_API_KEY!), // optional
  ],
  redisSearchCache,
  connectorBudgetAdapter,
);
```

### 31.6 Forbidden patterns (lint rule)

- Direct `fetch()` calls to `html.duckduckgo.com`, `google.com/search`, `www.bing.com/search`, or any provider's HTML search page.
- Browser-header spoofing to bypass anti-bot pages.
- Search calls that bypass `WebSearchRouter` (no caching, no budget accounting).

---

## 32. AI Commander — Tool-Calling Control Plane

The AI Commander is the unified, chat-driven surface where users ask natural-language questions ("What is Donald Trump doing recently?", "Compare sentiment on Brand X vs Brand Y this week", "Who is amplifying narrative N?") and the system orchestrates module calls to answer them with evidence.

### 32.1 Design principles

1. **Every backend capability is a typed tool.** No hidden orchestration. The LLM picks tools; the system enforces budgets, validation, and audit.
2. **Tool-first, not freeform.** System prompt forbids answering factual questions without a tool call. Stops cheap hallucination and forces grounded, auditable runs.
3. **Cited or it didn't happen.** UI visually flags any claim lacking ≥ 3 `mentionId` citations.
4. **Cheap-tier first.** Always try `search_mentions` (local) before `search_web` (paid). Always try `get_recent_insight` before `summarize_topic` (LLM).
5. **Replayable.** Every conversation is a deterministic-ish DAG of tool calls. Re-runnable as a macro.

### 32.2 Tool catalog (v0.1)

| Tool | Purpose | Cost class |
|---|---|---|
| `search_mentions` | Query tenant's stored mentions (FTS + filters) | free |
| `get_recent_insight` | Return cached insight if < 6h old | free |
| `search_web` | Multi-provider web search (§31) | free→cheap |
| `search_news` | GDELT + RSS + (optional) news API; date-bounded | free |
| `get_sentiment_timeseries` | Aggregate over `mentions` for chart | free |
| `get_platform_distribution` | Share-of-voice by platform | free |
| `compare_entities` | Side-by-side metrics for N entities | free |
| `cluster_narratives` | Run/refresh issue clustering for a topic + window | medium (LLM) |
| `detect_risk_events` | Risk scoring on recent mentions | medium |
| `summarize_topic` | LLM summary with evidence IDs | medium |
| `explain_spike` | Given a timestamp/window, return likely drivers | medium |
| `find_amplifiers` | Top authors by reach for a narrative | free |
| `monitor_actor` | Add to watchlist; return recent posts | varies |
| `create_topic` | Bootstrap a topic from a natural-language brief | free |
| `create_alert_rule` | Translate "ping me if X spikes" into `AlertRule` | free |
| `generate_report` | Trigger PDF report; returns signed URL | low |
| `explain_score` | Open the black box for sentiment/risk/automation | free |
| `usage_status` | Current spend vs caps per connector + LLM | free |

### 32.3 Tool definition pattern (Zod → JSON Schema)

```ts
// apps/api/src/commander/tools/searchMentions.ts
import { z } from "zod";
import type { ToolContext } from "../runtime";

export const searchMentionsTool = {
  name: "search_mentions",
  description:
    "Search the tenant's stored mentions. Use this BEFORE any external search tool.",
  schema: z.object({
    topicId: z.string().uuid().optional(),
    query: z.string().min(2),
    platforms: z
      .array(z.enum([
        "x", "youtube", "facebook", "instagram", "tiktok",
        "news", "rss", "reddit", "bluesky", "mastodon", "web", "gdelt",
      ]))
      .optional(),
    sentiment: z.enum(["positive", "negative", "neutral", "mixed"]).optional(),
    sinceDays: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  async handler(input: any, ctx: ToolContext) {
    return ctx.mentionService.search({ tenantId: ctx.tenantId, ...input });
  },
};
```

A single dispatcher loads all tools, exposes their JSON Schemas to the LLM, validates inputs with Zod, enforces RBAC, checks budget, invokes, and stamps a `tool_invocations` row (audit + replay).

### 32.4 Runtime loop

```text
user message
  → LLM (system prompt + tool schemas, see §32.5)
  → tool_calls[] (parallelized when independent)
  → Zod-validate inputs → budget check → invoke handlers
  → stream results back as typed cards (mention list, chart, table, report link)
  → optional follow-up tool calls until model emits final answer
  → persist Conversation, ConversationTurn, ToolInvocation rows
```

Responses are streamed over SSE. Each tool invocation gets an `invocationId`; the UI fetches full results lazily via `GET /commander/tool-invocations/:invocationId`.

### 32.5 System prompt (extract)

```text
You are CivicFalcon Commander. You answer questions about public narratives
using tools. You never answer factual questions without first calling a tool.

Routing rules (must follow):
1. For "what is being said about X" → call search_mentions first. Only call
   search_web/search_news if search_mentions returns < 5 relevant items.
2. For "summarize topic" → call get_recent_insight first. Only call
   summarize_topic if the cached insight is missing or older than 6 hours.
3. For comparisons → call compare_entities.
4. For "why did X spike" → call get_sentiment_timeseries then explain_spike.
5. Every factual claim in your final answer must cite ≥ 3 mentionIds returned
   by a tool. Format citations as [mention:<id>].
6. Refuse: claims that a real person IS a bot, demographic identity claims,
   monitoring of private profiles, automated posting on behalf of the user.
```

### 32.6 Persistence

Add to schema:

```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content jsonb NOT NULL,
  token_count_input integer,
  token_count_output integer,
  estimated_cost_usd numeric(12, 6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES conversation_turns(id),
  tool_name text NOT NULL,
  input jsonb NOT NULL,
  output jsonb,
  status text NOT NULL CHECK (status IN ('ok','error','rejected_budget','rejected_rbac')),
  duration_ms integer,
  estimated_cost_usd numeric(12, 6),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commander_macros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  description text,
  conversation_id uuid REFERENCES conversations(id),
  prompt_template text NOT NULL,
  schedule_cron text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 32.7 Example flows

**"What is Donald Trump doing recently?"**

1. `search_mentions(query="Donald Trump", sinceDays=7, limit=50)`
2. If < 5 hits: `search_news(query="Donald Trump", sinceDays=7)`
3. `cluster_narratives(mentionIds=[…])`
4. `summarize_topic(clusters=[…])`
5. Render: summary + cluster cards + citations.

**"Compare sentiment on Brand A and Brand B this month."**

1. `compare_entities(entities=["Brand A","Brand B"], sinceDays=30)` → returns two timeseries + share-of-voice.
2. Render side-by-side ECharts cards. No LLM round-trip needed for the chart — only for the prose summary.

---

## 33. Persona-Driven Feature Backlog

Groups features by the persona that most values them. All features ride on the Commander tool layer (§32); a feature = a curated tool sequence + a card UI.

### 33.1 Analyst (power user)

- **Commander macros** — save a chat as a re-runnable playbook ("Morning brief: Topic X"). One click re-runs the same tool sequence.
- **Compare tray** — drop 2–5 entities/topics; Commander auto-runs side-by-side sentiment, SoV, top narratives.
- **"Why did this spike?"** — button on any time-series point; Commander pulls mentions in the window, clusters them, returns 3 candidate drivers with evidence.
- **Counter-narrative drafter** — given a risk event, draft 3 response options (defensive / factual / empathetic), each labeled with tone and risk.
- **Sentiment correction loop** — analyst corrections feed a labeled set; weekly retrain a small local classifier (much cheaper than LLM at inference).

### 33.2 Communications / PR lead

- **Daily Brief** — 7am email + Teams card from a fixed macro. Zero clicks. 1-page PDF attached.
- **Stakeholder map** — auto-extracts top amplifiers (journalists, accounts) per narrative; "who do I need to call today?"
- **Tone preview** — paste a draft press release; Commander predicts likely public reaction by matching against historical sentiment on similar messaging.
- **Crisis room mode** — elevated polling + alert channel for a single topic during an active event; auto-disables after N hours to cap cost.

### 33.3 Government / public policy

- **Geographic heatmaps** — mentions per region/issue (ECharts map). Drill into region → Commander session pre-loaded.
- **Public-trust index** — composite of sentiment + verified-source share + automation-likelihood, tracked per topic over time.
- **FOIA-friendly export** — every report bundles a CSV of `mentionId → sourceUrl → collectedAt` for chain-of-custody.
- **Cross-topic radar** — surface narratives that appear in N topics simultaneously (early-warning signal).

### 33.4 Executive / viewer

- **3-card morning view** — "What changed overnight," "Top risk," "Top opportunity." Each card opens a Commander session pre-loaded with the question.
- **Voice mode** — STT + TTS over Commander; turns it into a briefing assistant for commutes.
- **Weekly digest** — plain-language email with the 5 most important narrative shifts.

### 33.5 Cross-cutting platform ideas

- **Narrative timeline** — chronological story view auto-built from issue clusters (Wikipedia-style "what happened, when").
- **Coordination signals** (not "bot detection") — show posting cadence, account age clusters, lexical similarity; label as "coordination signal," never "bot," per §3.2.
- **Public-share permalinks** — read-only snapshot of an insight + evidence; shareable outside the app.
- **BYO data** — let users upload a CSV of mentions from another tool to enrich a topic.
- **Webhook / Zapier outbound** — fire on alert events so other systems can react.

---

## 34. Extended Cost-Control Playbook

This section extends §20 with operational tactics that have measurable impact on monthly spend.

### 34.1 Search and ingestion

- **Cache hit ratio is the #1 metric.** Target ≥ 60% cache hits for `search_web`. Surface this on the Connectors page.
- **Cross-topic dedup.** If two topics share an upstream query within TTL, the second is a cache hit. Implement at the router layer (§31.4), not per-connector.
- **Adaptive polling.** Topics with zero new mentions for 48h auto-demote from 15-min polling to 6-hour polling. Re-promote on a manual run or detected spike.
- **Per-connector soft cap at 80%.** Switch to cache-only mode and post a banner; analyst can request override.
- **News before web.** GDELT and RSS are free; always try them first for news-flavored queries.

### 34.2 LLM spend

- **Tier router** (mandated in §20.5). Track per-tier token spend per day; alert if frontier-tier > 30% of total cost.
- **Local NLP for hot path.** Language, sentiment, NER, intent on enrichment workers — zero per-call cost. Reserve LLM for narrative work.
- **Embed once.** Use pgvector. Reuse embeddings across clustering, dedup, semantic search, similar-mention lookup. One embed amortized across many features.
- **Cluster-then-summarize.** Pass cluster centroids (5–10 items) to the frontier model, never raw mention sets > 50. Typical 10× token reduction.
- **Insight content-hash cache.** Hash the sorted evidence `mentionId[]`; same input set returns the cached insight. Same applies to risk explanations.
- **Streaming + early stop.** Cancel LLM stream as soon as the consumer has enough.
- **Prompt compression.** Use short, structured tool descriptions; avoid restating schemas every turn.

### 34.3 Commander-specific

- **Force grounding.** System prompt (§32.5) forbids freeform factual answers; everything routes through a tool.
- **Tool-result truncation.** Top-K + snippet only when feeding back to the model. Full results stay in `tool_invocations` for the UI to fetch lazily.
- **Per-user daily token budget.** Soft cap → throttle to small-tier; hard cap → read-only.
- **Conversation pruning.** Keep last N turns + rolling summary; drop stale tool outputs.
- **Macro economics.** Scheduled macros run on a separate, lower-priority budget envelope so they can't starve interactive use.

### 34.4 Storage

- **Cold-tier raw payloads** to S3/Blob after 30 days. Keep canonical `mentions` row hot in Postgres.
- **Embedding index** (`ivfflat` or `hnsw` in pgvector). Far cheaper than re-embedding on demand.
- **TTL on connector_usage_events** detail rows after 90 days; keep daily roll-ups indefinitely.

### 34.5 Observability for cost

Add a "Cost" tab on the existing Usage page showing:

- Daily spend per connector and per LLM tier (line chart).
- Cache hit ratio per connector.
- Top 10 most expensive queries / conversations this month.
- Forecast: projected month-end spend vs cap.
- Anomaly flag: any connector or user > 3σ above 14-day baseline.

---

## 35. Final Product Principle

CivicFalcon AI should not merely show charts.

It should answer:

```text
What is happening?
Why is it happening?
Who or what is driving it?
How risky is it?
What evidence supports it?
What should we do next?
```

That is the core difference between a dashboard and an intelligence product.

