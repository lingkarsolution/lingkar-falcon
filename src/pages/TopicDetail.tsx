import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Fragment, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge, SentimentBadge, PlatformBadge } from "@/components/ui/badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, BarChart, Bar, CartesianGrid } from "recharts";
import { AlertTriangle, Brain, CheckCircle2, ChevronDown, ChevronRight, Clock3, ExternalLink, FileText, ImageIcon, Loader2, MapPinned, MessagesSquare, Network, Pencil, Play, RefreshCw, Send, Sparkles, Shield, UserRound, Video, XCircle } from "lucide-react";
import { api, type BulkSentimentResult, type IngestionJob, type IngestionJobDetail, type IntelligenceCycleResult, type Topic, type Mention, type Insight, type IssueCluster, type RiskEvent, type Connector, type TopicSentimentStrategy } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import "leaflet/dist/leaflet.css";

interface Timeseries { bucket: string; positive: number; neutral: number; negative: number; mixed: number; total: number }
interface EntityCount { text: string; type: string; count: number }
type SentimentKey = "positive" | "neutral" | "negative" | "mixed" | "unknown";
interface GeoTrend {
  id: string;
  topicId: string;
  city: string;
  province?: string | null;
  mentionCount: number;
  engagementTotal: number;
  sentimentBreakdown: Partial<Record<SentimentKey, number>>;
  trendScore?: number | null;
  confidence: number;
  topKeywords: string[];
  latitude?: number | null;
  longitude?: number | null;
}

const COLORS = ["#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];
const SENTIMENT_COLORS: Record<SentimentKey, string> = {
  positive: "#10b981",
  neutral: "#94a3b8",
  negative: "#ef4444",
  mixed: "#f59e0b",
  unknown: "#a1a1aa",
};
const SENTIMENT_LABELS: Record<SentimentKey, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  mixed: "Mixed",
  unknown: "Unknown",
};
type OperationKind = "ingest" | "cycle" | "sentiment" | "brief" | "risk" | "report";
type OperationState = { open: boolean; kind: OperationKind; title: string; description: string; progress: number; status: "running" | "completed" | "failed"; logs: string[]; jobId?: string };
type TopicChatMessage = { role: "user" | "assistant"; content: string; createdAt: string; llmEnabled?: boolean };
type RawMediaFilter = "all" | "image" | "video" | "other" | "none";

const pct = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;
const sentimentKeys: SentimentKey[] = ["negative", "mixed", "neutral", "positive"];
const mappableTrends = <T extends { latitude?: number | null; longitude?: number | null }>(trends: T[]) => trends.filter((trend) => Number.isFinite(trend.latitude) && Number.isFinite(trend.longitude));
const dominantSentiment = (trend: GeoTrend): SentimentKey => {
  const entries = Object.entries(trend.sentimentBreakdown ?? {}) as Array<[SentimentKey, number]>;
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
};
const jobProgress = (job?: IngestionJob): number => {
  if (!job) return 12;
  if (job.status === "completed") return 100;
  if (job.status === "failed" || job.status === "cancelled") return 100;
  if (job.status === "running") return 65;
  return 24;
};
const mentionTimestamp = (mention: Mention): number => new Date(mention.publishedAt ?? mention.collectedAt).getTime();
const formatCompact = (value?: number | null): string => typeof value === "number" && Number.isFinite(value) ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value) : "-";
const mentionEngagement = (mention: Mention): number => mention.metrics?.engagementTotal
  ?? (mention.metrics?.likeCount ?? mention.metrics?.likes ?? 0)
  + (mention.metrics?.shareCount ?? mention.metrics?.shares ?? mention.metrics?.reposts ?? 0)
  + (mention.metrics?.commentCount ?? mention.metrics?.comments ?? 0)
  + (mention.metrics?.quotes ?? 0);
const authorFollowers = (mention: Mention): number | null => mention.author?.followersCount ?? mention.author?.followerCount ?? null;
const normalizeMentionText = (text: string): string => text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
const originAssessment = (mention: Mention, repeatedTextCount: number): { label: string; tone: "default" | "secondary" | "destructive"; note: string } => {
  const automation = mention.quality?.automationLikelihood ?? 0;
  if (automation >= 0.55 || repeatedTextCount >= 3) return { label: "Coordinated signal", tone: "destructive", note: "High automation or repeated wording in the first wave." };
  if (automation >= 0.3 || repeatedTextCount === 2) return { label: "Needs review", tone: "secondary", note: "Some automation or copy reuse signals are present." };
  return { label: "Likely genuine", tone: "default", note: "Low automation and no strong copy reuse in the first wave." };
};
const originRowTone = (tone: "default" | "secondary" | "destructive") => {
  if (tone === "destructive") return "border-l-destructive bg-destructive/8 hover:bg-destructive/12";
  if (tone === "secondary") return "border-l-amber-500 bg-amber-500/10 hover:bg-amber-500/15";
  return "border-l-emerald-500 bg-emerald-500/8 hover:bg-emerald-500/12";
};

function OperationButton({ tooltip, loading, loadingLabel, children, ...props }: ComponentProps<typeof Button> & { tooltip: string; loading?: boolean; loadingLabel: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button {...props} disabled={props.disabled || loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {loading ? loadingLabel : children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function TopicDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const topic = useQuery({ queryKey: qk.topic(id), queryFn: () => api.get<Topic>(`/topics/${id}`) });
  const timeseries = useQuery({ queryKey: qk.timeseries(id, "day", 14), queryFn: () => api.get<Timeseries[]>(`/analytics/topics/${id}/timeseries?bucket=day&days=14`) });
  const sentiment = useQuery({ queryKey: qk.sentiment(id), queryFn: () => api.get<Record<string, number>>(`/analytics/topics/${id}/sentiment`) });
  const entities = useQuery({ queryKey: qk.entities(id), queryFn: () => api.get<EntityCount[]>(`/analytics/topics/${id}/entities`) });
  const insights = useQuery({ queryKey: qk.insights(id), queryFn: () => api.get<Insight[]>(`/ai/topics/${id}/insights`) });
  const sentimentStrategy = useQuery({ queryKey: ["topic-sentiment-strategy", id], queryFn: () => api.get<TopicSentimentStrategy | null>(`/ai/topics/${id}/sentiment-strategy`) });
  const clusters = useQuery({ queryKey: qk.clusters(id), queryFn: () => api.get<IssueCluster[]>(`/ai/topics/${id}/clusters`) });
  const riskEvents = useQuery({ queryKey: qk.riskEvents(id), queryFn: () => api.get<RiskEvent[]>(`/ai/topics/${id}/risk-events`) });
  const [rawMediaType, setRawMediaType] = useState<RawMediaFilter>("all");
  const [rawSource, setRawSource] = useState("all");
  const mentions = useQuery({
    queryKey: ["mentions-topic", id, rawMediaType, rawSource],
    queryFn: () => {
      const params = new URLSearchParams({ topicId: id, limit: "50" });
      if (rawMediaType !== "all") params.set("mediaType", rawMediaType);
      if (rawSource !== "all") params.set("platform", rawSource);
      return api.get<{ items: Mention[] }>(`/mentions?${params.toString()}`);
    },
  });
  const originMentions = useQuery({ queryKey: ["mentions-topic-origins", id], queryFn: () => api.get<{ items: Mention[] }>(`/mentions?topicId=${id}&limit=20&sort=oldest`) });
  const connectors = useQuery({ queryKey: qk.connectors, queryFn: () => api.get<Connector[]>("/connectors") });
  const geoTrends = useQuery({ queryKey: qk.geoTrends(id), queryFn: () => api.get<GeoTrend[]>(`/analytics/topics/${id}/geo-trends?limit=20`) });

  const [connectorId, setConnectorId] = useState<string>("");
  const [historyDays, setHistoryDays] = useState("30");
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [expandedOriginIds, setExpandedOriginIds] = useState<Set<string>>(() => new Set());
  const [topicChatInput, setTopicChatInput] = useState("");
  const [topicChatMessages, setTopicChatMessages] = useState<TopicChatMessage[]>([]);

  const activeJobId = operation?.jobId;
  const jobDetail = useQuery({
    queryKey: ["ingestion-job-detail", activeJobId],
    queryFn: () => api.get<IngestionJobDetail>(`/ingestion/jobs/${activeJobId}`),
    enabled: Boolean(activeJobId && operation?.open && operation.status === "running"),
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "completed" || status === "failed" || status === "cancelled" ? false : 1200;
    },
  });

  const openOperation = (next: Omit<OperationState, "open" | "status" | "progress" | "logs"> & { logs?: string[] }) => {
    setOperation({ open: true, status: "running", progress: 10, logs: next.logs ?? [`Started ${next.title.toLowerCase()}.`], ...next });
  };
  const finishOperation = (patch: Partial<OperationState>) => {
    setOperation((current) => current ? { ...current, status: patch.status ?? "completed", progress: patch.progress ?? 100, logs: [...current.logs, ...(patch.logs ?? [])], jobId: patch.jobId ?? current.jobId } : current);
  };

  const trigger = useMutation({
    mutationFn: () => api.post("/ingestion/trigger", { topicId: id, connectorId, maxItems: 50, days: Number(historyDays) }),
    onMutate: () => openOperation({ kind: "ingest", title: "Ingestion", description: "Fetching public evidence for this topic.", logs: [`Queued ${historyDays}-day ingestion window.`] }),
    onSuccess: (job) => {
      const createdJob = job as IngestionJob;
      finishOperation({ status: "running", progress: 24, jobId: createdJob.id, logs: [`Job ${createdJob.id} queued.`, "Watching connector progress."] });
      setTimeout(() => qc.invalidateQueries(), 1500);
    },
    onError: (error) => finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] }),
  });
  const cycle = useMutation({
    mutationFn: () => api.post<IntelligenceCycleResult>(`/topics/${id}/intelligence-cycle`, { days: Number(historyDays), maxItemsPerConnector: 50, includeTrendingNews: true }),
    onMutate: () => openOperation({ kind: "cycle", title: "Intelligence cycle", description: "Running ingestion, LLM sentiment, clustering, risk detection, and daily brief.", logs: ["Preparing OSINT connectors.", "Running the cycle on the server."] }),
    onSuccess: (result) => {
      finishOperation({ logs: [
        `Completed ${result.jobs.length} ingestion jobs.`,
        `LLM sentiment updated ${result.sentiment.updated} mentions.`,
        `Created ${result.clusters.length} clusters and ${result.risks.length} risk events.`,
        result.brief ? "Generated daily brief." : "Daily brief skipped because no evidence was available.",
      ] });
      qc.invalidateQueries();
    },
    onError: (error) => finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] }),
  });
  const analyzeSentiment = useMutation({
    mutationFn: () => api.post<BulkSentimentResult>("/ai/analyze-sentiment", { topicId: id, limit: 200 }),
    onMutate: () => openOperation({ kind: "sentiment", title: "LLM sentiment", description: "Classifying saved mentions by narrative risk tone.", logs: ["Sending recent mentions for bulk analysis."] }),
    onSuccess: (result) => {
      finishOperation({ logs: [`Requested ${result.requested} mentions.`, `Updated ${result.updated}; failed ${result.failed}; skipped ${result.skipped}.`, ...result.errors] });
      qc.invalidateQueries();
    },
    onError: (error) => finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] }),
  });
  const brief = useMutation({
    mutationFn: () => api.post<Insight>("/ai/daily-brief", { topicId: id }),
    onMutate: () => openOperation({ kind: "brief", title: "Daily brief", description: "Generating an evidence-backed analyst summary.", logs: ["Collecting latest mentions and evidence IDs."] }),
    onSuccess: (result) => {
      finishOperation({ logs: [result ? "Generated daily brief." : "No brief generated because no evidence was available."] });
      qc.invalidateQueries({ queryKey: qk.insights(id) });
    },
    onError: (error) => finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] }),
  });
  const cluster = useMutation({
    mutationFn: () => api.post<IssueCluster[]>("/ai/cluster", { topicId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clusters(id) }),
  });
  const detectRisk = useMutation({
    mutationFn: () => api.post<RiskEvent[]>("/ai/detect-risk", { topicId: id }),
    onMutate: () => openOperation({ kind: "risk", title: "Risk detection", description: "Clustering narratives and scoring risk events.", logs: ["Refreshing clusters before scoring risk."] }),
    onSuccess: (events) => {
      finishOperation({ logs: [`Detected ${events.length} risk events.`] });
      qc.invalidateQueries({ queryKey: qk.riskEvents(id) });
      qc.invalidateQueries({ queryKey: qk.clusters(id) });
    },
    onError: (error) => finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] }),
  });
  const genReport = useMutation({
    mutationFn: () => api.post("/reports", { topicId: id }),
    onMutate: () => openOperation({ kind: "report", title: "Report", description: "Queuing a report from current topic evidence.", logs: ["Creating report job."] }),
    onSuccess: () => finishOperation({ logs: ["Report job queued."] }),
    onError: (error) => finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] }),
  });
  const generateStrategy = useMutation({
    mutationFn: () => api.post<TopicSentimentStrategy>(`/ai/topics/${id}/sentiment-strategy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["topic-sentiment-strategy", id] });
      qc.invalidateQueries({ queryKey: qk.insights(id) });
    },
  });
  const topicChat = useMutation({
    mutationFn: (payload: { message: string; history: TopicChatMessage[] }) => api.post<{ answer: string; llmEnabled: boolean; generatedAt: string }>(`/ai/topics/${id}/chat`, {
      message: payload.message,
      history: payload.history.map((turn) => ({ role: turn.role, content: turn.content })),
    }),
    onSuccess: (result) => {
      setTopicChatMessages((current) => [...current, { role: "assistant", content: result.answer, createdAt: result.generatedAt, llmEnabled: result.llmEnabled }]);
    },
    onError: (error) => {
      setTopicChatMessages((current) => [...current, { role: "assistant", content: (error as Error).message, createdAt: new Date().toISOString(), llmEnabled: false }]);
    },
  });

  const sentEntries = Object.entries(sentiment.data ?? {}).map(([name, value]) => ({ name, value }));
  const enabledConnectors = (connectors.data ?? []).filter((c) => c.enabled && (c.status === "active" || c.status === "limited"));
  const mentionItems = mentions.data?.items ?? [];
  const originItems = originMentions.data?.items ?? [];
  const strategy = sentimentStrategy.data;
  const cityRows = useMemo(() => (geoTrends.data ?? [])
    .map((trend) => {
      const total = Math.max(1, trend.mentionCount);
      return {
        ...trend,
        dominant: dominantSentiment(trend),
        positive: trend.sentimentBreakdown.positive ?? 0,
        neutral: trend.sentimentBreakdown.neutral ?? 0,
        negative: trend.sentimentBreakdown.negative ?? 0,
        mixed: trend.sentimentBreakdown.mixed ?? 0,
        unknown: trend.sentimentBreakdown.unknown ?? 0,
        riskShare: pct((trend.sentimentBreakdown.negative ?? 0) + (trend.sentimentBreakdown.mixed ?? 0), total),
      };
    })
    .sort((a, b) => b.mentionCount - a.mentionCount || b.engagementTotal - a.engagementTotal), [geoTrends.data]);
  const cityMaxMentions = Math.max(1, ...cityRows.map((row) => row.mentionCount));
  const leadCity = cityRows[0];
  const leadCityPie = leadCity
    ? sentimentKeys.map((key) => ({ name: SENTIMENT_LABELS[key], value: leadCity.sentimentBreakdown[key] ?? 0 })).filter((item) => item.value > 0)
    : [];
  const rawSentimentRows = useMemo(() => sentimentKeys
    .map((key) => ({ name: SENTIMENT_LABELS[key], value: mentionItems.filter((mention) => mention.nlp.sentiment === key).length, key }))
    .filter((item) => item.value > 0), [mentionItems]);
  const rawPlatformRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mention of mentionItems) counts.set(mention.platform, (counts.get(mention.platform) ?? 0) + 1);
    return [...counts.entries()]
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [mentionItems]);
  const rawSourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const platform of topic.data?.platforms ?? []) values.add(platform);
    for (const connector of connectors.data ?? []) values.add(connector.platform);
    for (const mention of mentionItems) values.add(mention.platform);
    return [...values].filter(Boolean).sort();
  }, [connectors.data, mentionItems, topic.data?.platforms]);
  const issueRows = useMemo(() => (clusters.data ?? []).map((cluster) => {
    const mentionCount = cluster.mentionCount ?? cluster.size ?? cluster.sampleMentionIds?.length ?? cluster.representativeMentionIds?.length ?? 0;
    const breakdown = cluster.sentimentBreakdown ?? {
      positive: cluster.sentiment === "positive" ? mentionCount : 0,
      neutral: cluster.sentiment === "neutral" ? mentionCount : 0,
      negative: cluster.sentiment === "negative" ? mentionCount : 0,
      mixed: cluster.sentiment === "mixed" ? mentionCount : 0,
      unknown: 0,
    };
    return {
      id: cluster.id,
      name: cluster.title ?? cluster.label ?? "Narrative cluster",
      mentionCount,
      riskToned: (breakdown.negative ?? 0) + (breakdown.mixed ?? 0),
      positive: breakdown.positive ?? 0,
      neutral: breakdown.neutral ?? 0,
      negative: breakdown.negative ?? 0,
      mixed: breakdown.mixed ?? 0,
      unknown: breakdown.unknown ?? 0,
    };
  }), [clusters.data]);
  const issueSentimentRows = useMemo(() => sentimentKeys
    .map((key) => ({ name: SENTIMENT_LABELS[key], value: issueRows.reduce((total, issue) => total + issue[key], 0), key }))
    .filter((item) => item.value > 0), [issueRows]);
  const evidenceReadiness = useMemo(() => {
    const total = mentionItems.length;
    const sourceLinked = mentionItems.filter((m) => Boolean(m.sourceUrl)).length;
    const llmReviewed = mentionItems.filter((m) => m.nlp.sentimentSource === "llm").length;
    const highRelevance = mentionItems.filter((m) => (m.quality?.relevanceScore ?? 0) >= 0.65).length;
    const riskToned = mentionItems.filter((m) => m.nlp.sentiment === "negative" || m.nlp.sentiment === "mixed").length;
    return [
      { label: "Source-linked evidence", value: sourceLinked, total, percent: pct(sourceLinked, total) },
      { label: "LLM-reviewed sentiment", value: llmReviewed, total, percent: pct(llmReviewed, total) },
      { label: "High relevance", value: highRelevance, total, percent: pct(highRelevance, total) },
      { label: "Risk-toned mentions", value: riskToned, total, percent: pct(riskToned, total) },
    ];
  }, [mentionItems]);
  const originTextCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mention of originItems) {
      const normalized = normalizeMentionText(mention.text);
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return counts;
  }, [originItems]);
  const originStats = useMemo(() => {
    const uniqueProfiles = new Set(originItems.map((mention) => `${mention.platform}:${mention.author?.username ?? mention.author?.displayName ?? mention.id}`)).size;
    const highAutomation = originItems.filter((mention) => (mention.quality?.automationLikelihood ?? 0) >= 0.55).length;
    const repeatedCopy = originItems.filter((mention) => (originTextCounts.get(normalizeMentionText(mention.text)) ?? 0) >= 2).length;
    const first = originItems[0];
    const last = originItems.length > 0 ? originItems[originItems.length - 1] : undefined;
    const spreadMinutes = first && last ? Math.max(0, Math.round((mentionTimestamp(last) - mentionTimestamp(first)) / 60000)) : 0;
    const coordinationScore = originItems.length > 0 ? Math.min(100, Math.round(((highAutomation / originItems.length) * 55) + ((repeatedCopy / originItems.length) * 35) + (spreadMinutes <= 30 && originItems.length >= 8 ? 10 : 0))) : 0;
    return { uniqueProfiles, highAutomation, repeatedCopy, first, last, spreadMinutes, coordinationScore };
  }, [originItems, originTextCounts]);
  const toggleOriginRow = (mentionId: string) => {
    setExpandedOriginIds((current) => {
      const next = new Set(current);
      if (next.has(mentionId)) next.delete(mentionId);
      else next.add(mentionId);
      return next;
    });
  };
  const askTopicAi = (message = topicChatInput.trim()) => {
    const trimmed = message.trim();
    if (!trimmed || topicChat.isPending) return;
    const history = topicChatMessages.slice(-10);
    setTopicChatMessages((current) => [...current, { role: "user", content: trimmed, createdAt: new Date().toISOString() }]);
    setTopicChatInput("");
    topicChat.mutate({ message: trimmed, history });
  };

  useEffect(() => {
    if (!operation?.jobId || !jobDetail.data?.job) return;
    const job = jobDetail.data.job;
    const errors = jobDetail.data.errors ?? [];
    setOperation((current) => {
      if (!current || current.jobId !== job.id) return current;
      const terminal = job.status === "completed" || job.status === "failed" || job.status === "cancelled";
      return {
        ...current,
        status: job.status === "failed" || job.status === "cancelled" ? "failed" : terminal ? "completed" : "running",
        progress: jobProgress(job),
        logs: [
          ...current.logs,
          `Status: ${job.status}; fetched ${job.fetchedCount ?? 0}, inserted ${job.insertedCount ?? 0}, skipped ${job.skippedCount ?? 0}.`,
          ...errors.map((error) => `Error: ${error.message}`),
        ].slice(-12),
      };
    });
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") qc.invalidateQueries();
  }, [jobDetail.data, operation?.jobId, qc]);

  useEffect(() => {
    if (!connectorId && enabledConnectors.length > 0) setConnectorId(enabledConnectors[0].id);
  }, [connectorId, enabledConnectors]);

  if (topic.isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!topic.data) return <div className="p-8 text-destructive">Topic not found.</div>;

  return (
    <TooltipProvider>
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{topic.data.title}</h1>
          <p className="text-muted-foreground mt-1">{topic.data.description ?? "No description"}</p>
          <div className="flex flex-wrap gap-1 mt-3">
            {topic.data.keywords.map((k) => <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to={`/topics/form/${topic.data.id}`}><Pencil className="h-4 w-4 mr-2" /> Update topic</Link>
          </Button>
          <Select value={connectorId} onValueChange={setConnectorId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Choose connector" /></SelectTrigger>
            <SelectContent>{enabledConnectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.displayName ?? c.name ?? c.platform}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={historyDays} onValueChange={setHistoryDays}>
            <SelectTrigger className="w-[116px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[7, 14, 30, 60, 90].map((days) => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}
            </SelectContent>
          </Select>
          <OperationButton tooltip="Fetch new evidence through the selected connector and save the ingestion job." loading={trigger.isPending} loadingLabel="Ingesting…" onClick={() => trigger.mutate()} disabled={!connectorId}>
            <Play className="h-4 w-4 mr-2" /> Ingest
          </OperationButton>
          <OperationButton tooltip="Run ingestion, LLM sentiment, clustering, risk detection, and daily brief in sequence." loading={cycle.isPending} loadingLabel="Running…" variant="secondary" onClick={() => cycle.mutate()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Run cycle
          </OperationButton>
          <OperationButton tooltip="Re-score saved mentions with the LLM using narrative risk tone." loading={analyzeSentiment.isPending} loadingLabel="Analyzing…" variant="outline" onClick={() => analyzeSentiment.mutate()}>
            <Brain className="h-4 w-4 mr-2" /> LLM sentiment
          </OperationButton>
          <OperationButton tooltip="Generate an evidence-backed daily brief from the latest mentions." loading={brief.isPending} loadingLabel="Generating…" variant="secondary" onClick={() => brief.mutate()}>
            <Sparkles className="h-4 w-4 mr-2" /> Daily brief
          </OperationButton>
          <OperationButton tooltip="Refresh narrative clusters and produce risk events when thresholds are crossed." loading={detectRisk.isPending || cluster.isPending} loadingLabel="Detecting…" variant="secondary" onClick={() => detectRisk.mutate()}>
            <Shield className="h-4 w-4 mr-2" /> Detect risk
          </OperationButton>
          <OperationButton tooltip="Create a report from the current topic evidence and analysis." loading={genReport.isPending} loadingLabel="Queuing…" variant="outline" onClick={() => genReport.mutate()}>
            <FileText className="h-4 w-4 mr-2" /> Report
          </OperationButton>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="origins">Origins</TabsTrigger>
          <TabsTrigger value="raw">Raw Data</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="risk">Risk Events</TabsTrigger>
          <TabsTrigger value="entities">Entities</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
          <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><MapPinned className="h-4 w-4" /> Topic regional heatmap</CardTitle>
              <p className="text-xs text-muted-foreground">City-level inferred signals for this monitored topic only.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative h-[430px] overflow-hidden rounded-lg border border-border bg-muted">
                <MapContainer
                  center={[-2.6, 118]}
                  zoom={4}
                  minZoom={4}
                  maxZoom={9}
                  scrollWheelZoom={false}
                  maxBounds={[[ -12, 94 ], [ 7, 143 ]]}
                  className="h-full w-full z-0"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {mappableTrends(cityRows).map((trend) => {
                    const dominant = dominantSentiment(trend);
                    const radius = 10 + Math.round((trend.mentionCount / cityMaxMentions) * 24);
                    const fillOpacity = 0.3 + Math.min(0.45, trend.mentionCount / cityMaxMentions / 2);
                    return (
                      <CircleMarker
                        key={trend.id}
                        center={[trend.latitude!, trend.longitude!]}
                        radius={radius}
                        pathOptions={{
                          color: SENTIMENT_COLORS[dominant],
                          fillColor: SENTIMENT_COLORS[dominant],
                          fillOpacity,
                          opacity: 0.9,
                          weight: 2,
                        }}
                      >
                        <Popup>
                          <div className="min-w-44 text-sm">
                            <p className="font-semibold">{trend.city}</p>
                            <p className="text-xs text-muted-foreground">{trend.province ?? "Indonesia"}</p>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                              <span>Mentions</span><strong>{trend.mentionCount}</strong>
                              <span>Dominant</span><strong>{SENTIMENT_LABELS[dominant]}</strong>
                              <span>Risk share</span><strong>{trend.riskShare}%</strong>
                              <span>Confidence</span><strong>{Math.round(trend.confidence * 100)}%</strong>
                            </div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
                {mappableTrends(cityRows).length === 0 && (
                  <div className="absolute inset-x-6 bottom-6 rounded-md border border-border bg-background/90 p-4 text-sm text-muted-foreground shadow-sm">
                    No city-level signals yet for this topic. New mentions are tagged locally when Indonesian city references are found.
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {cityRows.slice(0, 8).map((city) => (
                  <div key={city.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{city.city}</p>
                        <p className="text-xs text-muted-foreground truncate">{city.province ?? "Indonesia"}</p>
                      </div>
                      <span className="text-xs font-medium" style={{ color: SENTIMENT_COLORS[city.dominant] }}>{SENTIMENT_LABELS[city.dominant]}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="flex h-full w-full">
                        {sentimentKeys.map((key) => {
                          const value = city.sentimentBreakdown[key] ?? 0;
                          return value > 0 ? <div key={key} style={{ width: `${pct(value, city.mentionCount)}%`, backgroundColor: SENTIMENT_COLORS[key] }} /> : null;
                        })}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Mentions</p><p className="font-semibold tabular-nums">{city.mentionCount}</p></div>
                      <div><p className="text-muted-foreground">Risk</p><p className="font-semibold tabular-nums">{city.riskShare}%</p></div>
                      <div><p className="text-muted-foreground">Lift</p><p className="font-semibold tabular-nums">{city.trendScore?.toFixed(1) ?? "1.0"}x</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">City sentiment spread</CardTitle></CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cityRows.slice(0, 10)} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="city" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Legend />
                    <Bar dataKey="negative" stackId="sentiment" name="Negative" fill={SENTIMENT_COLORS.negative} />
                    <Bar dataKey="mixed" stackId="sentiment" name="Mixed" fill={SENTIMENT_COLORS.mixed} />
                    <Bar dataKey="neutral" stackId="sentiment" name="Neutral" fill={SENTIMENT_COLORS.neutral} />
                    <Bar dataKey="positive" stackId="sentiment" name="Positive" fill={SENTIMENT_COLORS.positive} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Lead city sentiment</CardTitle></CardHeader>
              <CardContent className="h-80">
                {leadCity ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={leadCityPie} dataKey="value" nameKey="name" outerRadius={92} label>
                        {leadCityPie.map((entry) => {
                          const key = entry.name.toLowerCase() as SentimentKey;
                          return <Cell key={entry.name} fill={SENTIMENT_COLORS[key]} />;
                        })}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No city sentiment data yet.</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Sentiment over time</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeseries.data ?? []}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Legend />
                  <Line type="monotone" dataKey="positive" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="negative" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="neutral" stroke="#64748b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Evidence readiness</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border border-border px-3 py-2">
                    <p className="text-muted-foreground text-xs">Mentions</p>
                    <p className="text-2xl font-semibold tabular-nums">{mentionItems.length}</p>
                  </div>
                  <div className="rounded-md border border-border px-3 py-2">
                    <p className="text-muted-foreground text-xs">Latest evidence</p>
                    <p className="text-sm font-medium truncate">{mentionItems[0] ? new Date(mentionItems[0].publishedAt ?? mentionItems[0].collectedAt).toLocaleDateString() : "None"}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  {evidenceReadiness.map((item) => (
                    <div key={item.label} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>{item.label}</span>
                        <span className="text-muted-foreground tabular-nums">{item.value}/{item.total}</span>
                      </div>
                      <Progress value={item.percent} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Sentiment distribution</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sentEntries} dataKey="value" nameKey="name" outerRadius={90} label>
                      {sentEntries.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          </div>

          <aside className="space-y-4 xl:self-start">
            <Card className="border-primary/20 bg-card">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">AI sentiment strategy</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">Summarizes negative concerns, positive drivers, and a PR response from saved posts.</p>
                  </div>
                  <Button size="sm" onClick={() => generateStrategy.mutate()} disabled={generateStrategy.isPending || mentionItems.length === 0}>
                    {generateStrategy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {strategy ? "Refresh" : "Generate"}
                  </Button>
                </div>
                {strategy && (
                  <p className="text-xs text-muted-foreground">Analyzed {strategy.mentionsAnalyzed} posts · {new Date(strategy.generatedAt).toLocaleString()} · {strategy.llmEnabled ? "LLM" : "Heuristic fallback"}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {!strategy && (
                  <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                    Generate the summary after ingestion or sentiment analysis. It is cached here so page refreshes do not spend LLM tokens.
                  </div>
                )}
                {strategy && (
                  <>
                    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
                      <div className="mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        <h3 className="text-sm font-semibold">{strategy.negative.title}</h3>
                      </div>
                      <p className="text-sm leading-6">{strategy.negative.summary}</p>
                      <div className="mt-3 space-y-1.5">
                        {strategy.negative.concerns.map((item) => <p key={item} className="text-xs">- {item}</p>)}
                      </div>
                    </section>
                    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100">
                      <div className="mb-2 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        <h3 className="text-sm font-semibold">{strategy.positive.title}</h3>
                      </div>
                      <p className="text-sm leading-6">{strategy.positive.summary}</p>
                      <div className="mt-3 space-y-1.5">
                        {strategy.positive.excitementDrivers.map((item) => <p key={item} className="text-xs">- {item}</p>)}
                      </div>
                    </section>
                    <section className="rounded-lg border border-primary/25 bg-primary/5 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold">{strategy.prStrategy.title}</h3>
                      </div>
                      <p className="text-sm leading-6">{strategy.prStrategy.recommendation}</p>
                      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                        {strategy.prStrategy.actions.map((item) => <p key={item}>- {item}</p>)}
                      </div>
                      <div className="mt-3 rounded-md border border-border bg-background/70 p-2 text-xs"><span className="font-medium">Tone: </span>{strategy.prStrategy.tone}</div>
                    </section>
                  </>
                )}
                <section className="border-t border-border pt-4">
                  <div className="mb-3 flex items-start gap-2">
                    <MessagesSquare className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <h3 className="text-sm font-semibold">Discuss with AI</h3>
                      <p className="text-xs text-muted-foreground">Ask for a PR statement, next steps, response timing, or how to interpret sentiment.</p>
                    </div>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {[
                      "Draft a short PR holding statement for this issue.",
                      "Should we respond now or wait 1 day?",
                      "What should our team do next?",
                    ].map((prompt) => (
                      <Button key={prompt} type="button" variant="outline" size="sm" className="h-auto whitespace-normal text-left text-xs" onClick={() => askTopicAi(prompt)} disabled={topicChat.isPending || mentionItems.length === 0}>{prompt}</Button>
                    ))}
                  </div>
                  <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
                    {topicChatMessages.length === 0 && <p className="text-sm text-muted-foreground">No chat yet. Start with a PR draft, timing question, or response plan.</p>}
                    {topicChatMessages.map((message, index) => (
                      <div key={`${message.createdAt}-${index}`} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                        <div className={message.role === "user" ? "max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[92%] rounded-md border border-border bg-background px-3 py-2 text-sm"}>
                          <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                          {message.role === "assistant" && message.llmEnabled === false && <p className="mt-2 text-xs text-muted-foreground">LLM fallback response</p>}
                        </div>
                      </div>
                    ))}
                    {topicChat.isPending && (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Thinking...</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={topicChatInput}
                      onChange={(event) => setTopicChatInput(event.target.value)}
                      placeholder="Ask what to do, request a PR statement, or discuss the sentiment..."
                      className="min-h-24 resize-none"
                      disabled={topicChat.isPending || mentionItems.length === 0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) askTopicAi();
                      }}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Ctrl+Enter to send. Uses saved posts and the latest strategy summary.</p>
                      <Button size="sm" onClick={() => askTopicAi()} disabled={topicChat.isPending || !topicChatInput.trim() || mentionItems.length === 0}>
                        {topicChat.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Send
                      </Button>
                    </div>
                  </div>
                </section>
              </CardContent>
            </Card>
          </aside>
          </div>
        </TabsContent>

        <TabsContent value="origins" className="space-y-6 mt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><Clock3 className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">First seen</p>
                    <p className="truncate text-sm font-semibold">{originStats.first ? new Date(originStats.first.publishedAt ?? originStats.first.collectedAt).toLocaleString() : "No evidence"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><UserRound className="h-4 w-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Early profiles</p>
                    <p className="text-2xl font-semibold tabular-nums">{originStats.uniqueProfiles}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><Network className="h-4 w-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">First-wave spread</p>
                    <p className="text-2xl font-semibold tabular-nums">{originItems.length > 1 ? `${originStats.spreadMinutes}m` : "-"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><AlertTriangle className="h-4 w-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Coordination signal</p>
                    <p className="text-2xl font-semibold tabular-nums">{originStats.coordinationScore}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">First 20 profiles that posted</CardTitle>
              <p className="text-xs text-muted-foreground">Oldest saved mentions for this topic, ranked by first observed post time.</p>
            </CardHeader>
            <CardContent>
              {originItems.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse text-sm">
                      <thead className="bg-muted/70 text-xs text-muted-foreground">
                        <tr className="h-10 text-left">
                          <th className="w-12 px-3 font-medium">Rank</th>
                          <th className="w-48 px-3 font-medium">Profile</th>
                          <th className="w-28 px-3 font-medium">Platform</th>
                          <th className="w-44 px-3 font-medium">First post</th>
                          <th className="px-3 font-medium">Post preview</th>
                          <th className="w-28 px-3 text-right font-medium">Followers</th>
                          <th className="w-28 px-3 text-right font-medium">Engage</th>
                          <th className="w-28 px-3 font-medium">Sentiment</th>
                          <th className="w-36 px-3 font-medium">Signal</th>
                          <th className="w-10 px-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {originItems.map((mention, index) => {
                          const normalized = normalizeMentionText(mention.text);
                          const repeatCount = originTextCounts.get(normalized) ?? 0;
                          const assessment = originAssessment(mention, repeatCount);
                          const authorName = mention.author?.displayName ?? mention.author?.username ?? "Unknown profile";
                          const automationPercent = Math.round((mention.quality?.automationLikelihood ?? 0) * 100);
                          const expanded = expandedOriginIds.has(mention.id);
                          return (
                            <Fragment key={mention.id}>
                              <tr className={`border-l-4 border-t border-border transition-colors ${originRowTone(assessment.tone)}`}>
                                <td className="h-12 px-3 align-middle font-semibold tabular-nums">#{index + 1}</td>
                                <td className="max-w-48 px-3 align-middle">
                                  <div className="min-w-0">
                                    <p className="truncate font-medium">{authorName}</p>
                                    <p className="truncate text-xs text-muted-foreground">{mention.author?.username ? `@${mention.author.username}` : "No username"}</p>
                                  </div>
                                </td>
                                <td className="px-3 align-middle"><PlatformBadge platform={mention.platform} /></td>
                                <td className="px-3 align-middle text-xs text-muted-foreground">{new Date(mention.publishedAt ?? mention.collectedAt).toLocaleString()}</td>
                                <td className="max-w-[360px] px-3 align-middle"><p className="truncate">{mention.text}</p></td>
                                <td className="px-3 text-right align-middle font-medium tabular-nums">{formatCompact(authorFollowers(mention))}</td>
                                <td className="px-3 text-right align-middle font-medium tabular-nums">{formatCompact(mentionEngagement(mention))}</td>
                                <td className="px-3 align-middle"><SentimentBadge sentiment={mention.nlp.sentiment} /></td>
                                <td className="px-3 align-middle">
                                  <div className="flex flex-col gap-1">
                                    <Badge variant={assessment.tone} className="w-fit">{assessment.label}</Badge>
                                    <span className="text-xs text-muted-foreground tabular-nums">Auto {automationPercent}%</span>
                                  </div>
                                </td>
                                <td className="px-2 align-middle">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleOriginRow(mention.id)} aria-label={expanded ? "Collapse origin row" : "Expand origin row"}>
                                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </Button>
                                </td>
                              </tr>
                              {expanded && (
                                <tr className={`border-l-4 border-t border-border ${originRowTone(assessment.tone)}`}>
                                  <td colSpan={10} className="p-4">
                                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                                      <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                          <SentimentBadge sentiment={mention.nlp.sentiment} />
                                          {repeatCount >= 2 && <Badge variant="secondary">{repeatCount} similar early posts</Badge>}
                                        </div>
                                        <p className="text-sm leading-6">{mention.text}</p>
                                        <p className="text-xs text-muted-foreground">{assessment.note}</p>
                                      </div>
                                      <div className="space-y-3 text-xs">
                                        <div>
                                          <div className="mb-1 flex items-center justify-between gap-2">
                                            <span className="text-muted-foreground">Automation likelihood</span>
                                            <span className="font-medium tabular-nums">{automationPercent}%</span>
                                          </div>
                                          <Progress value={automationPercent} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="rounded-md border border-border bg-background/70 px-2 py-1.5"><p className="text-muted-foreground">Similar copy</p><p className="font-semibold tabular-nums">{repeatCount}</p></div>
                                          <div className="rounded-md border border-border bg-background/70 px-2 py-1.5"><p className="text-muted-foreground">Sentiment</p><p className="font-semibold capitalize">{mention.nlp.sentiment}</p></div>
                                        </div>
                                        {mention.sourceUrl && (
                                          <Button asChild variant="outline" size="sm" className="w-full justify-center">
                                            <a href={mention.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> Open post</a>
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {originItems.length === 0 && <div className="rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">No origin evidence yet. Run ingestion to collect posts for this topic.</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw" className="space-y-6 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <div className="text-sm text-muted-foreground">Showing {mentionItems.length} saved mentions</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={rawMediaType} onValueChange={(value) => setRawMediaType(value as RawMediaFilter)}>
                <SelectTrigger className="w-[172px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All media</SelectItem>
                  <SelectItem value="image">Images</SelectItem>
                  <SelectItem value="video">Videos</SelectItem>
                  <SelectItem value="other">Other media</SelectItem>
                  <SelectItem value="none">No media</SelectItem>
                </SelectContent>
              </Select>
              <Select value={rawSource} onValueChange={setRawSource}>
                <SelectTrigger className="w-[172px]"><SelectValue placeholder="All sources" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {rawSourceOptions.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.7fr)_minmax(0,1.3fr)] gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Raw sentiment count</CardTitle></CardHeader>
              <CardContent className="h-72">
                {rawSentimentRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={rawSentimentRows} dataKey="value" nameKey="name" outerRadius={90} label>
                        {rawSentimentRows.map((entry) => <Cell key={entry.key} fill={SENTIMENT_COLORS[entry.key]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No raw sentiment data yet.</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Raw mentions by source</CardTitle></CardHeader>
              <CardContent className="h-72">
                {rawPlatformRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rawPlatformRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <RTooltip />
                      <Bar dataKey="count" name="Mentions" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No source distribution yet.</div>
                )}
              </CardContent>
            </Card>
          </div>
          {mentionItems.map((m) => (
            <Card key={m.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PlatformBadge platform={m.platform} />
                      <SentimentBadge sentiment={m.nlp.sentiment} />
                      <Badge variant="outline" className="text-[10px] capitalize">{m.sourceType?.replace("_", " ") ?? "source"}</Badge>
                      <span>{m.author?.displayName ?? m.author?.username ?? "unknown"}</span>
                      <span>·</span>
                      <span>{new Date(m.publishedAt ?? m.collectedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm">{m.text}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {m.sourceUrl && <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open source ↗</a>}
                      {(m.media ?? []).map((asset) => (
                        <Badge key={asset.id} variant="outline" className="gap-1 text-[10px] capitalize">
                          {asset.type === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          {asset.type} · {asset.status}
                        </Badge>
                      ))}
                    </div>
                    {(m.media ?? []).some((asset) => asset.summary || asset.error) && (
                      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                        {(m.media ?? []).map((asset) => (
                          <div key={`${asset.id}-summary`} className="space-y-1">
                            {asset.summary && <p><span className="font-medium">Media summary:</span> {asset.summary}</p>}
                            {asset.sentiment && <p className="text-muted-foreground">Media sentiment: {asset.sentiment}{typeof asset.sentimentConfidence === "number" ? ` (${Math.round(asset.sentimentConfidence * 100)}%)` : ""}</p>}
                            {asset.error && <p className="text-destructive">{asset.error}</p>}
                            {(asset.blobUrl || asset.thumbnailBlobUrl) && <a href={asset.blobUrl ?? asset.thumbnailBlobUrl ?? undefined} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open stored media ↗</a>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {mentionItems.length === 0 && <Card><CardContent className="p-12 text-center text-muted-foreground">No mentions match the current filters.</CardContent></Card>}
        </TabsContent>

        <TabsContent value="insights" className="space-y-3 mt-6">
          {(insights.data ?? []).map((i) => (
            <Card key={i.id}>
              <CardHeader><CardTitle className="text-base">{i.title}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{i.summary}</p>
                <div><span className="font-semibold">Why it matters: </span>{i.whyItMatters}</div>
                <div><span className="font-semibold">Recommendation: </span>{i.recommendation}</div>
                <div className="text-xs text-muted-foreground">Evidence: {i.evidenceMentionIds.length} mentions · {new Date(i.generatedAt).toLocaleString()}</div>
              </CardContent>
            </Card>
          ))}
          {(insights.data ?? []).length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">No insights yet. Click "Daily brief" to generate one.</CardContent></Card>}
        </TabsContent>

        <TabsContent value="issues" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.7fr)_minmax(0,1.3fr)] gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Issue sentiment count</CardTitle></CardHeader>
              <CardContent className="h-72">
                {issueSentimentRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={issueSentimentRows} dataKey="value" nameKey="name" outerRadius={90} label>
                        {issueSentimentRows.map((entry) => <Cell key={entry.key} fill={SENTIMENT_COLORS[entry.key]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No issue sentiment data yet.</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Issue volume by cluster</CardTitle></CardHeader>
              <CardContent className="h-72">
                {issueRows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={issueRows.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                      <RTooltip />
                      <Legend />
                      <Bar dataKey="riskToned" stackId="issue" name="Risk-toned" fill={SENTIMENT_COLORS.negative} radius={[0, 6, 6, 0]} />
                      <Bar dataKey="neutral" stackId="issue" name="Neutral" fill={SENTIMENT_COLORS.neutral} radius={[0, 6, 6, 0]} />
                      <Bar dataKey="positive" stackId="issue" name="Positive" fill={SENTIMENT_COLORS.positive} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No issue clusters yet.</div>
                )}
              </CardContent>
            </Card>
          </div>
          {(clusters.data ?? []).map((c) => {
            const mentionCount = c.mentionCount ?? c.size ?? c.sampleMentionIds?.length ?? c.representativeMentionIds?.length ?? 0;
            const keywords = c.keywords ?? c.title?.split(" / ").filter(Boolean) ?? [];
            const breakdown = c.sentimentBreakdown ?? {
              positive: c.sentiment === "positive" ? mentionCount : 0,
              neutral: c.sentiment === "neutral" ? mentionCount : 0,
              negative: c.sentiment === "negative" ? mentionCount : 0,
              mixed: c.sentiment === "mixed" ? mentionCount : 0,
            };
            return (
              <Card key={c.id}>
                <CardHeader><CardTitle className="text-base">{c.title ?? c.label ?? "Narrative cluster"}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {c.summary && <p>{c.summary}</p>}
                  <p className="text-muted-foreground">{mentionCount} mentions{keywords.length > 0 ? ` · keywords: ${keywords.join(", ")}` : ""}</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-emerald-600">Positive {breakdown.positive ?? 0}</span>
                    <span className="text-slate-600">Neutral {breakdown.neutral ?? 0}</span>
                    <span className="text-red-600">Negative {breakdown.negative ?? 0}</span>
                    {(breakdown.mixed ?? 0) > 0 && <span className="text-amber-600">Mixed {breakdown.mixed}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(clusters.data ?? []).length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">No clusters yet. Click "Detect risk" to cluster + analyze.</CardContent></Card>}
        </TabsContent>

        <TabsContent value="risk" className="space-y-3 mt-6">
          {(riskEvents.data ?? []).map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{r.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">{r.score}</span>
                    <SeverityBadge severity={r.severity} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{r.summary}</p>
                <div className="flex flex-wrap gap-1">
                  {(r.narrativeTags ?? []).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                </div>
                <div className="text-xs text-muted-foreground">Category: {r.category} · Evidence: {r.evidenceMentionIds.length} mentions</div>
              </CardContent>
            </Card>
          ))}
          {(riskEvents.data ?? []).length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">No risk events. Run "Detect risk".</CardContent></Card>}
        </TabsContent>

        <TabsContent value="entities" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Top entities</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {(entities.data ?? []).map((e) => (
                  <div key={`${e.type}-${e.text}`} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.text}</p>
                      <p className="text-xs text-muted-foreground">{e.type}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{e.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={operation?.open ?? false} onOpenChange={(open) => setOperation((current) => current ? { ...current, open } : current)}>
        <DialogContent className="left-auto right-0 top-0 h-full max-w-md translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {operation?.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : operation?.status === "failed" ? <XCircle className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {operation?.title ?? "Operation"}
            </DialogTitle>
            <DialogDescription>{operation?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="capitalize text-muted-foreground">{operation?.status ?? "running"}</span>
                <span className="tabular-nums">{operation?.progress ?? 0}%</span>
              </div>
              <Progress value={operation?.progress ?? 0} />
            </div>
            <div className="space-y-3">
              {(operation?.logs ?? []).map((log, index) => (
                <div key={`${index}-${log}`} className="flex gap-3 text-sm">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p>{log}</p>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
