# Historical Intelligence Pipeline Proposal

## Goal

Make topic ingestion, daily briefs, and risk detection feel like one guided intelligence workflow instead of three disconnected buttons. A user should be able to define a topic, choose a lookback window, pull historical OSINT, and receive an AI-assisted daily analysis loop with clear evidence.

Default lookback: 30 calendar days.
Maximum lookback for v0.1: 90 calendar days, because GDELT DOC 2.0 supports a rolling recent window and most free/OSINT providers are more reliable in that range.

## User Experience

### 1. Topic Setup

When creating or editing a topic, add an `Intelligence horizon` control:

| Option | Default | Purpose |
|---|---:|---|
| Lookback days | 30 | How far back to pull historical data on manual or scheduled runs |
| Max records per connector | 50 | Keeps free sources responsive and costs predictable |
| Sources | GDELT, RSS, Web/SearXNG | OSINT-first default source bundle |
| Daily analysis time | 07:00 workspace timezone | Generates the morning brief |

The UI should show a compact preview: `GDELT + RSS + Web, last 30 days, 50 records/source`.

### 2. One-Click Intelligence Run

Replace the separate feeling of `Ingest`, `Daily brief`, and `Detect risk` with a guided action named `Run intelligence cycle`.

Cycle steps:

1. Pull historical data from enabled OSINT connectors.
2. Enrich and dedupe mentions.
3. Cluster narratives.
4. Detect risk events.
5. Generate an AI daily brief from evidence.
6. Update dashboard charts and the topic activity timeline.

Each step should have a visible status row: queued, running, completed, failed, skipped.

### 3. Historical Data Sources

| Source | Historical Strategy | Notes |
|---|---|---|
| GDELT DOC 2.0 | `timespan=Nd` or `startdatetime/enddatetime` | Best free source for global news history and translated coverage |
| RSS | Pull latest feed items, dedupe by URL | Most feeds only expose recent entries, so store snapshots daily |
| SearXNG | Search query with date terms, then `web_fetch` top results | Useful discovery layer, less reliable for exhaustive history |
| NewsAPI | Optional fallback where key exists | Free quota is limited; keep behind OSINT sources |
| Social providers | Platform-specific recent search where available | Most social APIs have short history or paid restrictions |

## AI Involvement

AI should not replace ingestion. It should operate after evidence is collected.

### Daily AI Analysis Outputs

| Output | Evidence Required | User Value |
|---|---|---|
| Daily brief | Recent mentions and prior brief | Morning executive summary |
| Narrative clusters | Mention text and entities | Shows what people are actually talking about |
| Risk events | Negative/mixed clusters plus velocity | Turns noisy discourse into reviewable incidents |
| Opportunity signals | Positive clusters and high-reach sources | Helps communications teams act proactively |
| Explainability notes | Mention IDs and scoring inputs | Keeps analysts confident and audit-ready |

### Suggested Prompt Contract

The AI daily analysis job should output strict JSON:

```json
{
  "title": "string",
  "summary": "string",
  "keyChangesSinceYesterday": ["string"],
  "topNarratives": [
    {
      "title": "string",
      "sentiment": "positive|neutral|negative|mixed",
      "evidenceMentionIds": ["mention_..."]
    }
  ],
  "risksToReview": [
    {
      "title": "string",
      "severity": "low|medium|high|critical",
      "reason": "string",
      "evidenceMentionIds": ["mention_..."]
    }
  ],
  "recommendedActions": ["string"]
}
```

## Backend Design

### Data Model Additions

Add scheduling and horizon metadata to topics or a dedicated `topicIntelligenceSettings` table:

| Field | Type | Default |
|---|---|---|
| `lookbackDays` | integer | 30 |
| `maxItemsPerConnector` | integer | 50 |
| `dailyAnalysisEnabled` | boolean | true |
| `dailyAnalysisTime` | string | `07:00` |
| `timezone` | string | tenant timezone |
| `lastCycleRunAt` | datetime | null |

### Job Types

Add an `intelligence_cycle` orchestration job that creates child jobs:

1. `ingestion:connector`
2. `analysis:cluster`
3. `analysis:risk_detection`
4. `analysis:daily_brief`
5. `report:optional_snapshot`

For v0.1 this can run in-process. For v1, move it to BullMQ or Azure Container Apps jobs.

### API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/topics/:id/intelligence-cycle` | Run the full cycle now |
| `GET /api/v1/topics/:id/intelligence-cycle/latest` | Show latest cycle status |
| `PATCH /api/v1/topics/:id/intelligence-settings` | Update lookback and schedule |
| `POST /api/v1/topics/:id/backfill` | Historical pull only |

## Failure Handling

Daily brief and risk detection should not silently fail when there is no data.

Expected states:

| Condition | User Message |
|---|---|
| No mentions after ingestion | `No new evidence found for this topic in the selected window.` |
| Connector timeout | `GDELT timed out. Try fewer records or a smaller lookback window.` |
| LLM unavailable | `Evidence was collected, but AI analysis is paused until LLM credentials are configured.` |
| No risk events | `No risk events crossed threshold. Narrative clusters were still updated.` |

## Implementation Phases

### Phase 1: Make Current Buttons Reliable

- Pass `days`, `dateFrom`, and `dateTo` through ingestion jobs.
- Default topic ingestion to 30 days.
- Fix connector dropdown labels and default selection.
- Show job failure details near the action buttons.
- Ensure GDELT uses DOC 2.0 `artlist` JSON with `timespan` and timeout handling.

### Phase 2: Add Full Intelligence Cycle

- Add a backend orchestration service.
- Add `Run intelligence cycle` UI action.
- Store cycle status and child job IDs.
- Reuse existing ingestion, clustering, risk, and daily brief services.

### Phase 3: Daily Scheduled AI Analysis

- Add tenant/topic daily schedule settings.
- Run the cycle once per day per active topic.
- Generate a daily brief only after new evidence exists.
- Compare against yesterday's brief for changes and emerging narratives.

### Phase 4: Analyst Review Loop

- Let users mark AI findings as useful, false positive, too broad, or needs follow-up.
- Feed these labels back into risk thresholds and future brief prompts.
- Add a `Review queue` for risk events and notable narrative changes.

## Success Criteria

- A new topic can produce useful evidence and an AI brief in one click.
- Default 30-day history works for GDELT-backed news topics.
- Users can see exactly which source and job step failed.
- Daily analysis produces evidence-backed summaries with mention IDs.
- Risk detection can return `no risk found` as a successful state, not a broken flow.
