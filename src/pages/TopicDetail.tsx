import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SentimentBadge, PlatformBadge } from "@/components/ui/badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, BarChart, Bar, CartesianGrid } from "recharts";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, ExternalLink, FileText, ImageIcon, Loader2, MapPinned, MessagesSquare, Network, Pencil, Play, Send, Sparkles, Shield, TrendingDown, TrendingUp, UserRound, Video, XCircle } from "lucide-react";
import { api, type Connector, type IngestionJob, type Topic, type Mention, type Insight, type Report, type TopicSentimentStrategy } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { JobDetailDrawer } from "@/components/ingestion/JobDetailDrawer";
import "leaflet/dist/leaflet.css";

interface Timeseries { bucket: string; positive: number; neutral: number; negative: number; mixed: number; total: number }
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
type OperationKind = "report";
type OperationState = { open: boolean; kind: OperationKind; title: string; description: string; progress: number; status: "running" | "completed" | "failed"; logs: string[] };
type ReportMutationVars = { reportWindow: Window | null };
type TopicChatMessage = { role: "user" | "assistant"; content: string; createdAt: string; llmEnabled?: boolean };
type RawMediaFilter = "all" | "image" | "video" | "other" | "none";
type RawSentimentFilter = Extract<SentimentKey, "positive" | "negative" | "neutral">;
type OriginClassificationKind = "coordinated" | "mixed" | "genuine" | "unknown";
type OriginSignal = "genuine" | "review" | "coordinated";
type OriginSignalFilter = "all" | OriginSignal;

const pct = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;
const sentimentKeys: SentimentKey[] = ["negative", "mixed", "neutral", "positive"];
const sentimentFilterKeys: SentimentKey[] = ["negative", "mixed", "neutral", "positive", "unknown"];
const rawSentimentOptions: Array<{ value: RawSentimentFilter; label: string }> = [
  { value: "positive", label: "Positive" },
  { value: "negative", label: "Negative" },
  { value: "neutral", label: "Neutral" },
];
const originSignalOrder: OriginSignal[] = ["coordinated", "review", "genuine"];
const originSignalLabels: Record<OriginSignal, string> = { coordinated: "Coordinated signal", review: "Needs review", genuine: "Likely genuine" };
const mappableTrends = <T extends { latitude?: number | null; longitude?: number | null }>(trends: T[]) => trends.filter((trend) => Number.isFinite(trend.latitude) && Number.isFinite(trend.longitude));
const dominantSentiment = (trend: GeoTrend): SentimentKey => {
  const entries = Object.entries(trend.sentimentBreakdown ?? {}) as Array<[SentimentKey, number]>;
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
};
const mentionTimestamp = (mention: Mention): number => new Date(mention.publishedAt ?? mention.collectedAt).getTime();
const formatCompact = (value?: number | null): string => typeof value === "number" && Number.isFinite(value) ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value) : "-";
const formatWholeNumber = (value: number): string => Intl.NumberFormat().format(value);
const numberOrZero = (value?: number | null): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
const jobStatusVariant = (status: IngestionJob["status"]): ComponentProps<typeof Badge>["variant"] => {
  if (status === "completed") return "default";
  if (status === "failed" || status === "cancelled") return "destructive";
  return "secondary";
};
const jobPlatform = (job: IngestionJob, connectorsById?: Map<string, Connector>): string => {
  const progress = job.metadata?.ingestionProgress as { platform?: unknown } | undefined;
  if (typeof progress?.platform === "string" && progress.platform) return progress.platform;
  const connector = connectorsById?.get(job.connectorId);
  if (connector?.platform) return connector.platform;
  return "unknown";
};
const jobStoredCount = (job: IngestionJob): number => {
  if (typeof job.acceptedCount === "number") return job.acceptedCount;
  const rejected = typeof job.rejectedCount === "number" ? job.rejectedCount : 0;
  const progress = job.metadata?.ingestionProgress as { storedCount?: unknown; acceptedCount?: unknown } | undefined;
  if (typeof progress?.acceptedCount === "number") return progress.acceptedCount;
  const inserted = numberOrZero(job.insertedCount ?? job.itemsStored);
  if (typeof progress?.storedCount === "number") return Math.max(0, progress.storedCount - rejected);
  return Math.max(0, inserted - rejected);
};
const jobRejectedCount = (job: IngestionJob): number => {
  if (typeof job.rejectedCount === "number") return job.rejectedCount;
  const progress = job.metadata?.ingestionProgress as { rejectedCount?: unknown } | undefined;
  return typeof progress?.rejectedCount === "number" ? progress.rejectedCount : 0;
};
const comparisonMeta = (current: number, previous: number): { text: string; direction: "up" | "down" | "flat" } => {
  if (previous === 0 && current === 0) return { text: "No change from last week", direction: "flat" };
  if (previous === 0) return { text: "New from last week", direction: "up" };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.1) return { text: "No change from last week", direction: "flat" };
  const sign = change > 0 ? "+" : "-";
  return { text: `${sign}${Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.abs(change))}% from last week`, direction: change > 0 ? "up" : "down" };
};
const formatSpreadMinutes = (minutes: number): string => {
  if (!Number.isFinite(minutes)) return "Unknown duration";
  if (minutes < 1) return "Under 1 minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days} ${days === 1 ? "day" : "days"}`;
};
const SOCIAL_METRIC_PLATFORMS = new Set(["x", "twitter", "threads", "instagram", "tiktok"]);
const VIEW_METRIC_PLATFORMS = new Set(["youtube", "tiktok", "threads"]);
const positiveMetric = (...values: Array<number | null | undefined>): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
};
const metricLine = (label: string, value: number | null): { label: string; value: number } | null => value ? { label, value } : null;
const mentionViews = (mention: Mention): number | null => positiveMetric(mention.metrics?.views, mention.metrics?.viewCount);
const mentionLikes = (mention: Mention): number | null => positiveMetric(mention.metrics?.likes, mention.metrics?.likeCount);
const mentionComments = (mention: Mention): number | null => positiveMetric(mention.metrics?.comments, mention.metrics?.commentCount);
const mentionShares = (mention: Mention): number | null => positiveMetric(mention.metrics?.shares, mention.metrics?.shareCount);
const mentionInteractionTotal = (mention: Mention): number => {
  const values: Array<number | null> = [
    mentionLikes(mention),
    mentionComments(mention),
    mentionShares(mention),
    positiveMetric(mention.metrics?.reposts),
    positiveMetric(mention.metrics?.quotes),
    positiveMetric(mention.metrics?.saves),
  ];
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
};
const isVideoMention = (mention: Mention): boolean => mention.sourceType === "video" || (mention.media ?? []).some((asset) => asset.type === "video");
const mentionEngagement = (mention: Mention): number | null => {
  const interactions = mentionInteractionTotal(mention);
  if (interactions > 0) return interactions;
  const aggregate = positiveMetric(mention.metrics?.engagementTotal);
  if (aggregate) return aggregate;
  const views = mentionViews(mention);
  if (views && (VIEW_METRIC_PLATFORMS.has(mention.platform) || isVideoMention(mention))) return views;
  return null;
};
const mentionMetricLines = (mention: Mention): Array<{ label: string; value: number }> => {
  const showViews = VIEW_METRIC_PLATFORMS.has(mention.platform) || isVideoMention(mention);
  const socialLines = [
    showViews ? metricLine("views", mentionViews(mention)) : null,
    metricLine("likes", mentionLikes(mention)),
    metricLine("comments", mentionComments(mention)),
    metricLine("shares", mentionShares(mention)),
    metricLine("reposts", positiveMetric(mention.metrics?.reposts)),
    metricLine("quotes", positiveMetric(mention.metrics?.quotes)),
    metricLine("saves", positiveMetric(mention.metrics?.saves)),
  ].filter((line): line is { label: string; value: number } => Boolean(line));
  if (SOCIAL_METRIC_PLATFORMS.has(mention.platform) || socialLines.length > 0) return socialLines;
  const aggregate = positiveMetric(mention.metrics?.engagementTotal);
  return aggregate ? [{ label: "engagement", value: aggregate }] : [];
};
const authorFollowers = (mention: Mention): number | null => mention.author?.followersCount ?? mention.author?.followerCount ?? null;
const normalizeMentionText = (text: string): string => text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
const originAssessment = (mention: Mention, repeatedTextCount: number): { label: string; tone: "default" | "secondary" | "destructive"; note: string } => {
  const automation = mention.quality?.automationLikelihood ?? 0;
  if (automation >= 0.55 || repeatedTextCount >= 3) return { label: "Coordinated signal", tone: "destructive", note: "High automation or repeated wording in the first wave." };
  if (automation >= 0.3 || repeatedTextCount === 2) return { label: "Needs review", tone: "secondary", note: "Some automation or copy reuse signals are present." };
  return { label: "Likely genuine", tone: "default", note: "Low automation and no strong copy reuse in the first wave." };
};
const originSignalKey = (assessment: ReturnType<typeof originAssessment>): OriginSignal => {
  if (assessment.tone === "destructive") return "coordinated";
  if (assessment.tone === "secondary") return "review";
  return "genuine";
};
const originRowTone = (tone: "default" | "secondary" | "destructive") => {
  if (tone === "destructive") return "border-l-destructive bg-destructive/8 hover:bg-destructive/12";
  if (tone === "secondary") return "border-l-amber-500 bg-amber-500/10 hover:bg-amber-500/15";
  return "border-l-emerald-500 bg-emerald-500/8 hover:bg-emerald-500/12";
};
const originBannerTone = (kind: OriginClassificationKind): string => {
  if (kind === "coordinated") return "border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100";
  if (kind === "mixed") return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100";
  if (kind === "genuine") return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100";
  return "border-border bg-muted/40 text-foreground";
};
const originBadgeVariant = (kind: OriginClassificationKind): ComponentProps<typeof Badge>["variant"] => {
  if (kind === "coordinated") return "destructive";
  if (kind === "mixed") return "secondary";
  return "default";
};

export default function TopicDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const topic = useQuery({ queryKey: qk.topic(id), queryFn: () => api.get<Topic>(`/topics/${id}`) });
  const evidenceProbe = useQuery({ queryKey: ["mentions-topic-probe", id], queryFn: () => api.get<{ items: Mention[] }>(`/mentions?topicId=${id}&limit=1`), enabled: Boolean(id) });
  const hasEvidence = (evidenceProbe.data?.items.length ?? 0) > 0;
  const evidenceQueriesEnabled = evidenceProbe.isError || (evidenceProbe.isSuccess && hasEvidence);
  const timeseries = useQuery({ queryKey: qk.timeseries(id, "day", 14), queryFn: () => api.get<Timeseries[]>(`/analytics/topics/${id}/timeseries?bucket=day&days=14`), enabled: evidenceQueriesEnabled });
  const sentiment = useQuery({ queryKey: qk.sentiment(id), queryFn: () => api.get<Record<string, number>>(`/analytics/topics/${id}/sentiment`), enabled: evidenceQueriesEnabled });
  const insights = useQuery({ queryKey: qk.insights(id), queryFn: () => api.get<Insight[]>(`/ai/topics/${id}/insights`), enabled: evidenceQueriesEnabled });
  const sentimentStrategy = useQuery({ queryKey: ["topic-sentiment-strategy", id], queryFn: () => api.get<TopicSentimentStrategy | null>(`/ai/topics/${id}/sentiment-strategy`), enabled: evidenceQueriesEnabled });
  const collectionJobs = useQuery({ queryKey: [...qk.ingestionJobs, "topic", id], queryFn: () => api.get<IngestionJob[]>("/ingestion/jobs"), enabled: Boolean(id) });
  const connectorsList = useQuery({ queryKey: qk.connectors, queryFn: () => api.get<Connector[]>("/connectors") });
  const connectorsById = useMemo(() => new Map<string, Connector>((connectorsList.data ?? []).map((c) => [c.id, c])), [connectorsList.data]);
  const [rawMediaType, setRawMediaType] = useState<RawMediaFilter>("all");
  const [rawSource, setRawSource] = useState("all");
  const [rawSentiments, setRawSentiments] = useState<RawSentimentFilter[]>(["positive", "negative", "neutral"]);
  const mentions = useQuery({
    queryKey: ["mentions-topic", id, rawMediaType, rawSource],
    queryFn: () => {
      const params = new URLSearchParams({ topicId: id, limit: "1000" });
      if (rawMediaType !== "all") params.set("mediaType", rawMediaType);
      if (rawSource !== "all") params.set("platform", rawSource);
      return api.get<{ items: Mention[] }>(`/mentions?${params.toString()}`);
    },
    enabled: evidenceQueriesEnabled,
  });
  const sourceOptionMentions = useQuery({
    queryKey: ["mentions-topic-source-options", id],
    queryFn: () => api.get<{ items: Mention[] }>(`/mentions?topicId=${id}&limit=1000`),
    enabled: evidenceQueriesEnabled,
  });
  const originMentions = useQuery({ queryKey: ["mentions-topic-origins", id], queryFn: () => api.get<{ items: Mention[] }>(`/mentions?topicId=${id}&limit=500&sort=oldest&perPlatformLimit=20`), enabled: evidenceQueriesEnabled });
  const geoTrends = useQuery({ queryKey: qk.geoTrends(id), queryFn: () => api.get<GeoTrend[]>(`/analytics/topics/${id}/geo-trends?limit=20`), enabled: evidenceQueriesEnabled });

  const [operation, setOperation] = useState<OperationState | null>(null);
  const [originPanelOpen, setOriginPanelOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [originSourceFilter, setOriginSourceFilter] = useState("all");
  const [originSentimentFilter, setOriginSentimentFilter] = useState<"all" | SentimentKey>("all");
  const [originSignalFilter, setOriginSignalFilter] = useState<OriginSignalFilter>("all");
  const [topicChatInput, setTopicChatInput] = useState("");
  const [topicChatMessages, setTopicChatMessages] = useState<TopicChatMessage[]>([]);

  const openOperation = (next: Omit<OperationState, "open" | "status" | "progress" | "logs"> & { logs?: string[] }) => {
    setOperation({ open: true, status: "running", progress: 10, logs: next.logs ?? [`Started ${next.title.toLowerCase()}.`], ...next });
  };
  const finishOperation = (patch: Partial<OperationState>) => {
    setOperation((current) => current ? { ...current, status: patch.status ?? "completed", progress: patch.progress ?? 100, logs: [...current.logs, ...(patch.logs ?? [])] } : current);
  };
  const genReport = useMutation({
    mutationFn: (_variables: ReportMutationVars) => api.post<Report>("/reports", { topicId: id }),
    onMutate: () => openOperation({ kind: "report", title: "Report", description: "Queuing a report from current topic posts.", logs: ["Creating report job."] }),
    onSuccess: (report, variables) => {
      const reportUrl = report.fileUrl ?? `/api/v1/reports/${report.id}/download`;
      finishOperation({ logs: ["Report generated.", "Opening report in a new tab."] });
      qc.invalidateQueries({ queryKey: qk.reports });
      if (variables.reportWindow && !variables.reportWindow.closed) {
        variables.reportWindow.opener = null;
        variables.reportWindow.location.href = reportUrl;
      } else {
        window.open(reportUrl, "_blank", "noopener,noreferrer");
      }
    },
    onError: (error, variables) => {
      variables.reportWindow?.close();
      finishOperation({ status: "failed", progress: 100, logs: [(error as Error).message] });
    },
  });
  const handleGenerateReport = () => {
    const reportWindow = window.open("about:blank", "_blank");
    if (reportWindow) {
      reportWindow.document.title = "Generating report...";
      reportWindow.document.body.innerHTML = '<p style="font-family: system-ui, sans-serif; padding: 24px; color: #52525b;">Generating report...</p>';
    }
    genReport.mutate({ reportWindow });
  };
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
  const rawMentionItems = mentions.data?.items ?? [];
  const mentionItems = useMemo(() => {
    const allowed = new Set<SentimentKey>(rawSentiments);
    return rawMentionItems.filter((mention) => allowed.has(mention.nlp.sentiment));
  }, [rawMentionItems, rawSentiments]);
  const topicCollectionJobs = useMemo(() => (collectionJobs.data ?? []).filter((job) => job.topicId === id), [collectionJobs.data, id]);
  const originItems = originMentions.data?.items ?? [];
  const originTextCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mention of originItems) {
      const normalized = normalizeMentionText(mention.text);
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return counts;
  }, [originItems]);
  const originSourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mention of originItems) counts.set(mention.platform, (counts.get(mention.platform) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([platform, count]) => Boolean(platform) && count > 0)
      .sort(([platformA], [platformB]) => platformA.localeCompare(platformB))
      .map(([platform, count]) => ({ platform, count }));
  }, [originItems]);
  const originSentimentOptions = useMemo(() => {
    const counts = new Map<SentimentKey, number>();
    for (const mention of originItems) counts.set(mention.nlp.sentiment, (counts.get(mention.nlp.sentiment) ?? 0) + 1);
    return sentimentFilterKeys
      .map((sentiment) => ({ sentiment, count: counts.get(sentiment) ?? 0 }))
      .filter((option) => option.count > 0);
  }, [originItems]);
  const originSignalOptions = useMemo(() => {
    const counts = new Map<OriginSignal, number>();
    for (const mention of originItems) {
      const repeatCount = originTextCounts.get(normalizeMentionText(mention.text)) ?? 0;
      const signal = originSignalKey(originAssessment(mention, repeatCount));
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
    return originSignalOrder
      .map((signal) => ({ signal, count: counts.get(signal) ?? 0 }));
  }, [originItems, originTextCounts]);
  const visibleOriginItems = useMemo(() => {
    return originItems.filter((mention) => {
      if (originSourceFilter !== "all" && mention.platform !== originSourceFilter) return false;
      if (originSentimentFilter !== "all" && mention.nlp.sentiment !== originSentimentFilter) return false;
      if (originSignalFilter !== "all") {
        const repeatCount = originTextCounts.get(normalizeMentionText(mention.text)) ?? 0;
        const signal = originSignalKey(originAssessment(mention, repeatCount));
        if (signal !== originSignalFilter) return false;
      }
      return true;
    });
  }, [originItems, originSentimentFilter, originSignalFilter, originSourceFilter, originTextCounts]);
  useEffect(() => {
    if (originSourceFilter !== "all" && !originSourceOptions.some((source) => source.platform === originSourceFilter)) {
      setOriginSourceFilter("all");
    }
    if (originSentimentFilter !== "all" && !originSentimentOptions.some((sentiment) => sentiment.sentiment === originSentimentFilter)) {
      setOriginSentimentFilter("all");
    }
    if (originSignalFilter !== "all" && !originSignalOptions.some((signal) => signal.signal === originSignalFilter)) {
      setOriginSignalFilter("all");
    }
  }, [originSentimentFilter, originSentimentOptions, originSignalFilter, originSignalOptions, originSourceFilter, originSourceOptions]);
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
  const evidenceSummaryCards = useMemo(() => {
    const sortedTimes = mentionItems.map(mentionTimestamp).filter(Number.isFinite);
    const latestTime = sortedTimes.length > 0 ? Math.max(...sortedTimes) : Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const currentStart = latestTime - weekMs;
    const previousStart = latestTime - (weekMs * 2);
    const inWindow = (mention: Mention, start: number, end: number) => {
      const timestamp = mentionTimestamp(mention);
      return Number.isFinite(timestamp) && timestamp > start && timestamp <= end;
    };
    const current = mentionItems.filter((mention) => inWindow(mention, currentStart, latestTime));
    const previous = mentionItems.filter((mention) => inWindow(mention, previousStart, currentStart));
    const riskToned = (items: Mention[]) => items.filter((mention) => mention.nlp.sentiment === "negative" || mention.nlp.sentiment === "mixed").length;
    const linked = (items: Mention[]) => items.filter((mention) => Boolean(mention.sourceUrl)).length;
    const engagement = (items: Mention[]) => items.reduce((total, mention) => total + (mentionEngagement(mention) ?? 0), 0);
    const currentEngagement = engagement(current);
    const previousEngagement = engagement(previous);
    const rows = [
      { label: "Posts collected", current: current.length, previous: previous.length, format: formatWholeNumber, accent: "bg-sky-500" },
      { label: "Risk-toned items", current: riskToned(current), previous: riskToned(previous), format: formatWholeNumber, accent: "bg-amber-500" },
      ...(currentEngagement > 0 || previousEngagement > 0
        ? [{ label: "Total engagement", current: currentEngagement, previous: previousEngagement, format: formatCompact, accent: "bg-emerald-500" }]
        : []),
      { label: "Source-linked items", current: linked(current), previous: linked(previous), format: formatWholeNumber, accent: "bg-violet-500" },
    ];
    return rows.map((row) => ({
      ...row,
      value: row.format(row.current),
      previousValue: row.format(row.previous),
      comparison: comparisonMeta(row.current, row.previous),
    }));
  }, [mentionItems]);
  const rawSourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const platform of topic.data?.platforms ?? []) values.add(platform);
    for (const mention of sourceOptionMentions.data?.items ?? mentionItems) values.add(mention.platform);
    return [...values].filter(Boolean).sort();
  }, [mentionItems, sourceOptionMentions.data?.items, topic.data?.platforms]);
  useEffect(() => {
    if (rawSource !== "all" && rawSourceOptions.length > 0 && !rawSourceOptions.includes(rawSource)) setRawSource("all");
  }, [rawSource, rawSourceOptions]);
  const toggleRawSentiment = (sentiment: RawSentimentFilter) => {
    setRawSentiments((current) => current.includes(sentiment) ? current.filter((item) => item !== sentiment) : [...current, sentiment]);
  };
  const evidenceReadiness = useMemo(() => {
    const total = mentionItems.length;
    const sourceLinked = mentionItems.filter((m) => Boolean(m.sourceUrl)).length;
    const aiReviewed = mentionItems.filter((m) => m.nlp.sentimentSource === "llm").length;
    const highRelevance = mentionItems.filter((m) => (m.quality?.relevanceScore ?? 0) >= 0.65).length;
    const riskToned = mentionItems.filter((m) => m.nlp.sentiment === "negative" || m.nlp.sentiment === "mixed").length;
    return [
      { label: "Source-linked posts", value: sourceLinked, total, percent: pct(sourceLinked, total) },
      { label: "AI-reviewed sentiment", value: aiReviewed, total, percent: pct(aiReviewed, total) },
      { label: "High relevance", value: highRelevance, total, percent: pct(highRelevance, total) },
      { label: "Risk-toned mentions", value: riskToned, total, percent: pct(riskToned, total) },
    ];
  }, [mentionItems]);
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
  const originClassification = useMemo(() => {
    const total = originItems.length;
    const fastSpread = originStats.spreadMinutes <= 30 && total >= 8;
    const reasonParts = [
      `${originStats.coordinationScore}% coordination score`,
      `${originStats.highAutomation}/${total} high-automation early posts`,
      `${originStats.repeatedCopy}/${total} posts with similar copy`,
      total > 1 ? `first wave spread across ${formatSpreadMinutes(originStats.spreadMinutes)}` : "only one origin post available",
    ];
    if (total === 0) {
      return {
        kind: "unknown" as OriginClassificationKind,
        title: "Origin signal unavailable",
        label: "No posts",
        reason: "No origin posts are stored yet. Run collection to gather the earliest posts for this topic.",
      };
    }
    if (originStats.coordinationScore >= 60 || originStats.highAutomation >= Math.max(2, Math.ceil(total * 0.35))) {
      return {
        kind: "coordinated" as OriginClassificationKind,
        title: "Likely coordinated event",
        label: "Coordinated",
        reason: `This looks coordinated because ${reasonParts.join(", ")}${fastSpread ? ", including a fast first-wave spread" : ""}.`,
      };
    }
    if (originStats.coordinationScore >= 30 || originStats.highAutomation > 0 || originStats.repeatedCopy > 0 || fastSpread) {
      return {
        kind: "mixed" as OriginClassificationKind,
        title: "Mixed origin signal",
        label: "Mixed",
        reason: `This has both organic and coordinated-looking signals: ${reasonParts.join(", ")}. Review the earliest profiles before treating it as fully genuine or coordinated.`,
      };
    }
    return {
      kind: "genuine" as OriginClassificationKind,
      title: "Likely genuine issue",
      label: "Genuine",
      reason: `This looks more organic because ${reasonParts.join(", ")}, with low automation and no strong repeated-copy pattern in the first wave.`,
    };
  }, [originItems.length, originStats]);
  const askTopicAi = (message = topicChatInput.trim()) => {
    const trimmed = message.trim();
    if (!trimmed || topicChat.isPending) return;
    const history = topicChatMessages.slice(-10);
    setTopicChatMessages((current) => [...current, { role: "user", content: trimmed, createdAt: new Date().toISOString() }]);
    setTopicChatInput("");
    topicChat.mutate({ message: trimmed, history });
  };

  if (topic.isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!topic.data) return <div className="p-8 text-destructive">Topic not found.</div>;

  if (evidenceProbe.isLoading) return <div className="p-8 text-muted-foreground">Checking topic posts…</div>;

  return (
    <TooltipProvider>
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{topic.data.title}</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="outline" size="icon" className="h-8 w-8">
                  <Link to={`/topics/form/${topic.data.id}`} aria-label="Update topic">
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Update topic</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground mt-1">{topic.data.description ?? "No description"}</p>
          <div className="flex flex-wrap gap-1 mt-3">
            {topic.data.keywords.map((k) => <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}</Badge>)}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button asChild>
            <Link to={`/ingestions/form?_tid=${topic.data.id}`}><Play className="h-4 w-4" /> Collect Posts</Link>
          </Button>
          <Button type="button" variant="secondary" onClick={handleGenerateReport} disabled={genReport.isPending}>
            {genReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Report
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="raw">Recent Posts</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
          <TabsTrigger value="jobs">Collect Job History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className={`mb-6 rounded-lg border p-4 ${originBannerTone(originClassification.kind)}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 rounded-md bg-background/70 p-2 text-current shadow-xs">
                  {originClassification.kind === "genuine" ? <CheckCircle2 className="h-5 w-5" /> : originClassification.kind === "coordinated" ? <AlertTriangle className="h-5 w-5" /> : <Network className="h-5 w-5" />}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{originClassification.title}</p>
                    <Badge variant={originBadgeVariant(originClassification.kind)} className="rounded-md">{originClassification.label}</Badge>
                    <Badge variant="outline" className="rounded-md bg-background/70">Score {originStats.coordinationScore}%</Badge>
                  </div>
                  <p className="max-w-4xl text-sm leading-6 opacity-90">{originClassification.reason}</p>
                </div>
              </div>
              <Button type="button" variant="outline" className="bg-background/80" onClick={() => setOriginPanelOpen(true)}>
                <Network className="h-4 w-4 mr-2" /> See details
              </Button>
            </div>
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
          <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><MapPinned className="h-4 w-4" /> Topic regional heatmap</CardTitle>
              <p className="text-xs text-muted-foreground">Topic heatmap data is predictive by nature and based on user interaction context/user profile data.</p>
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
              <CardHeader><CardTitle className="text-base">Post readiness</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border border-border px-3 py-2">
                    <p className="text-muted-foreground text-xs">Mentions</p>
                    <p className="text-2xl font-semibold tabular-nums">{mentionItems.length}</p>
                  </div>
                  <div className="rounded-md border border-border px-3 py-2">
                    <p className="text-muted-foreground text-xs">Latest post</p>
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
                    <CardTitle className="text-base">AI Summary</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">Summarizes negative concerns, positive drivers, and a PR response from saved posts.</p>
                  </div>
                  <Button size="sm" onClick={() => generateStrategy.mutate()} disabled={generateStrategy.isPending || mentionItems.length === 0}>
                    {generateStrategy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {strategy ? "Refresh" : "Generate"}
                  </Button>
                </div>
                {strategy && (
                  <p className="text-xs text-muted-foreground">Analyzed {strategy.mentionsAnalyzed} posts · {new Date(strategy.generatedAt).toLocaleString()} · {strategy.llmEnabled ? "AI-assisted" : "Rules-based"}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {!strategy && (
                  <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                    Generate the summary after collection or sentiment analysis. It is cached here so page refreshes do not start a new analysis run.
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
                          {message.role === "assistant" && message.llmEnabled === false && <p className="mt-2 text-xs text-muted-foreground">Rules-based response</p>}
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

        <TabsContent value="raw" className="space-y-6 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <div>
              <h2 className="text-sm font-semibold">Recent posts</h2>
              <p className="text-xs text-muted-foreground">Saved public posts, articles, and media for this topic.</p>
            </div>
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
              <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Sentiment</span>
                {rawSentimentOptions.map((option) => {
                  const checked = rawSentiments.includes(option.value);
                  const id = `raw-sentiment-${option.value}`;
                  return (
                    <label key={option.value} htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                      <Checkbox id={id} checked={checked} onCheckedChange={() => toggleRawSentiment(option.value)} />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {evidenceSummaryCards.map((item) => (
              <Card key={item.label} className="rounded-lg border-border bg-card shadow-xs">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-4 w-1 rounded-full ${item.accent}`} />
                      <p className="truncate text-xs font-medium text-foreground">{item.label}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-foreground" />
                  </div>
                  <div className="mt-5 flex items-center gap-2">
                    <p className="text-3xl font-medium leading-none tracking-normal tabular-nums text-foreground">{item.value}</p>
                    {item.comparison.direction === "down" ? <TrendingDown className="h-4 w-4 text-red-600" /> : item.comparison.direction === "up" ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : null}
                  </div>
                  <p className={item.comparison.direction === "down" ? "mt-4 text-[11px] text-red-600" : item.comparison.direction === "up" ? "mt-4 text-[11px] text-emerald-600" : "mt-4 text-[11px] text-muted-foreground"}>{item.comparison.text}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Previous week: {item.previousValue}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Posts table</h3>
                <p className="text-xs text-muted-foreground">Showing {mentionItems.length} saved items from the current filters.</p>
              </div>
              <Badge variant="outline" className="rounded-md">Latest first</Badge>
            </div>
            {mentionItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] border-collapse text-sm">
                  <thead className="bg-muted/70 text-xs text-muted-foreground">
                    <tr className="h-10 text-left">
                      <th className="w-14 px-3 font-medium">#</th>
                      <th className="w-28 px-3 font-medium">Source</th>
                      <th className="w-28 px-3 font-medium">Sentiment</th>
                      <th className="w-32 px-3 font-medium">Type</th>
                      <th className="w-44 px-3 font-medium">Author</th>
                      <th className="w-44 px-3 font-medium">Published</th>
                      <th className="min-w-[360px] px-3 font-medium">Post</th>
                      <th className="w-36 px-3 text-right font-medium">Engage</th>
                      <th className="w-32 px-3 font-medium">Media</th>
                      <th className="w-28 px-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mentionItems.map((m, index) => {
                      const media = m.media ?? [];
                      const mediaWithNotes = media.filter((asset) => asset.summary || asset.error || asset.blobUrl || asset.thumbnailBlobUrl);
                      const author = m.author?.displayName ?? m.author?.username ?? "Unknown author";
                      const metricLines = mentionMetricLines(m);
                      return (
                        <tr key={m.id} className="border-t border-border align-top">
                          <td className="px-3 py-3 text-xs font-medium tabular-nums text-muted-foreground">#{index + 1}</td>
                          <td className="px-3 py-3"><PlatformBadge platform={m.platform} /></td>
                          <td className="px-3 py-3"><SentimentBadge sentiment={m.nlp.sentiment} /></td>
                          <td className="px-3 py-3"><Badge variant="outline" className="rounded-md text-[10px] capitalize">{m.sourceType?.replace("_", " ") ?? "source"}</Badge></td>
                          <td className="max-w-44 px-3 py-3">
                            <p className="truncate font-medium">{author}</p>
                            {m.author?.username && <p className="truncate text-xs text-muted-foreground">@{m.author.username}</p>}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(m.publishedAt ?? m.collectedAt).toLocaleString()}</td>
                          <td className="px-3 py-3">
                            <p className="line-clamp-3 leading-6">{m.text}</p>
                            {mediaWithNotes.length > 0 && (
                              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                {mediaWithNotes.map((asset) => (
                                  <div key={`${asset.id}-table-summary`}>
                                    {asset.summary && <p><span className="font-medium text-foreground">Media:</span> {asset.summary}</p>}
                                    {asset.error && <p className="text-destructive">{asset.error}</p>}
                                    {(asset.blobUrl || asset.thumbnailBlobUrl) && (
                                      <a href={asset.blobUrl ?? asset.thumbnailBlobUrl ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center text-primary hover:underline"><ExternalLink className="mr-1 h-3 w-3" /> Stored media</a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {metricLines.length > 0 ? (
                              <div className="space-y-1">
                                {metricLines.slice(0, 4).map((metric) => (
                                  <div key={metric.label}>
                                    <div className="font-semibold">{formatCompact(metric.value)}</div>
                                    <div className="text-[10px] font-normal text-muted-foreground">{metric.label}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs font-normal text-muted-foreground">No data</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {media.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                              {media.map((asset) => (
                                <Badge key={asset.id} variant="outline" className="gap-1 rounded-md text-[10px] capitalize">
                                  {asset.type === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                                  {asset.type}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {m.sourceUrl ? (
                              <Button asChild variant="outline" size="sm">
                                <a href={m.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> Open</a>
                              </Button>
                            ) : <span className="text-xs text-muted-foreground">No link</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {mentionItems.length === 0 && <div className="p-12 text-center text-sm text-muted-foreground">No posts match the current filters.</div>}
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Collect job history</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Collection runs linked to this topic, latest first.</p>
                </div>
                <Badge variant="outline" className="rounded-md">{topicCollectionJobs.length} jobs</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {collectionJobs.isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Loading collection jobs...</div>}
              {!collectionJobs.isLoading && topicCollectionJobs.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="bg-muted/70 text-xs text-muted-foreground">
                      <tr className="h-10 text-left">
                        <th className="px-3 font-medium">Run</th>
                        <th className="w-28 px-3 font-medium">Status</th>
                        <th className="w-28 px-3 font-medium">Source</th>
                        <th className="w-40 px-3 font-medium">Created</th>
                        <th className="w-40 px-3 font-medium">Finished</th>
                        <th className="w-24 px-3 text-right font-medium">Fetched</th>
                        <th className="w-24 px-3 text-right font-medium">Saved</th>
                        <th className="w-24 px-3 text-right font-medium">Skipped</th>
                        <th className="w-24 px-3 text-right font-medium">Rejected</th>
                        <th className="w-24 px-3 text-right font-medium">Errors</th>
                        <th className="w-24 px-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topicCollectionJobs.map((job) => (
                        <tr key={job.id} className="border-t border-border align-middle">
                          <td className="px-3 py-3">
                            <button type="button" className="font-mono text-xs font-medium text-blue-600 hover:underline" onClick={() => setActiveJobId(job.id)}>{job.id}</button>
                            <p className="mt-1 text-xs text-muted-foreground capitalize">{job.jobType ?? "manual"}</p>
                          </td>
                          <td className="px-3 py-3"><Badge variant={jobStatusVariant(job.status)} className="rounded-md capitalize">{job.status}</Badge></td>
                          <td className="px-3 py-3"><Badge variant="outline" className="rounded-md uppercase">{jobPlatform(job, connectorsById)}</Badge></td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "-"}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{numberOrZero(job.fetchedCount ?? job.itemsFetched)}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{jobStoredCount(job)}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{numberOrZero(job.skippedCount ?? job.itemsDeduped)}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums text-muted-foreground">{jobRejectedCount(job)}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums text-muted-foreground">{numberOrZero(job.errorCount)}</td>
                          <td className="px-3 py-3">
                            <Button type="button" variant="outline" size="sm" onClick={() => setActiveJobId(job.id)}>View logs</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!collectionJobs.isLoading && topicCollectionJobs.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No collection jobs are linked to this topic yet.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="space-y-3 mt-6">
          {(insights.data ?? []).map((i) => (
            <Card key={i.id}>
              <CardHeader><CardTitle className="text-base">{i.title}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{i.summary}</p>
                <div><span className="font-semibold">Why it matters: </span>{i.whyItMatters}</div>
                <div><span className="font-semibold">Recommendation: </span>{i.recommendation}</div>
                <div className="text-xs text-muted-foreground">Posts: {i.evidenceMentionIds.length} mentions · {new Date(i.generatedAt).toLocaleString()}</div>
              </CardContent>
            </Card>
          ))}
          {(insights.data ?? []).length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">No AI insights yet.</CardContent></Card>}
        </TabsContent>

      </Tabs>

      <Dialog open={originPanelOpen} onOpenChange={setOriginPanelOpen}>
        <DialogContent className="left-auto right-0 top-0 flex h-full max-w-2xl translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-r-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" /> Origin details
            </DialogTitle>
            <DialogDescription>{originClassification.reason}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className={`rounded-lg border p-4 ${originBannerTone(originClassification.kind)}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{originClassification.title}</p>
                  <p className="mt-1 text-sm opacity-90">Score {originStats.coordinationScore}% from the earliest saved origin posts.</p>
                </div>
                <Badge variant={originBadgeVariant(originClassification.kind)} className="rounded-md">{originClassification.label}</Badge>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><Clock3 className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">First seen</p>
                    <p className="truncate text-sm font-semibold">{originStats.first ? new Date(originStats.first.publishedAt ?? originStats.first.collectedAt).toLocaleString() : "No posts"}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><UserRound className="h-4 w-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Early profiles</p>
                    <p className="text-xl font-semibold tabular-nums">{originStats.uniqueProfiles}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><Network className="h-4 w-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">First-wave spread</p>
                    <p className="text-xl font-semibold tabular-nums">{originItems.length > 1 ? formatSpreadMinutes(originStats.spreadMinutes) : "-"}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2"><AlertTriangle className="h-4 w-4" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Coordination signal</p>
                    <p className="text-xl font-semibold tabular-nums">{originStats.coordinationScore}%</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div>
                  <h3 className="text-sm font-semibold">Origin list</h3>
                  <p className="text-xs text-muted-foreground">Oldest saved mentions for this topic, showing up to the first 20 posts for each source.</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Source</p>
                    <Select value={originSourceFilter} onValueChange={setOriginSourceFilter}>
                      <SelectTrigger><SelectValue placeholder="Filter source" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sources ({originItems.length})</SelectItem>
                        {originSourceOptions.map((source) => (
                          <SelectItem key={source.platform} value={source.platform}>{source.platform} ({source.count})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Sentiment</p>
                    <Select value={originSentimentFilter} onValueChange={(value) => setOriginSentimentFilter(value as "all" | SentimentKey)}>
                      <SelectTrigger><SelectValue placeholder="Filter sentiment" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sentiment ({originItems.length})</SelectItem>
                        {originSentimentOptions.map((sentiment) => (
                          <SelectItem key={sentiment.sentiment} value={sentiment.sentiment}>{SENTIMENT_LABELS[sentiment.sentiment]} ({sentiment.count})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Signal</p>
                    <Select value={originSignalFilter} onValueChange={(value) => setOriginSignalFilter(value as OriginSignalFilter)}>
                      <SelectTrigger><SelectValue placeholder="Filter signal" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All signals ({originItems.length})</SelectItem>
                        {originSignalOptions.map((signal) => (
                          <SelectItem key={signal.signal} value={signal.signal}>{originSignalLabels[signal.signal]} ({signal.count})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              {visibleOriginItems.map((mention, index) => {
                const normalized = normalizeMentionText(mention.text);
                const repeatCount = originTextCounts.get(normalized) ?? 0;
                const assessment = originAssessment(mention, repeatCount);
                const authorName = mention.author?.displayName ?? mention.author?.username ?? "Unknown profile";
                const automationPercent = Math.round((mention.quality?.automationLikelihood ?? 0) * 100);
                const metricLines = mentionMetricLines(mention);
                return (
                  <div key={mention.id} className={`rounded-lg border border-l-4 border-border p-4 ${originRowTone(assessment.tone)}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="rounded-md bg-background/70">#{index + 1}</Badge>
                          <PlatformBadge platform={mention.platform} />
                          <SentimentBadge sentiment={mention.nlp.sentiment} />
                          <Badge variant={assessment.tone} className="rounded-md">{assessment.label}</Badge>
                        </div>
                        <p className="font-medium">{authorName}</p>
                        <p className="text-xs text-muted-foreground">{mention.author?.username ? `@${mention.author.username}` : "No username"} · {new Date(mention.publishedAt ?? mention.collectedAt).toLocaleString()}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-right text-xs sm:min-w-44">
                        <div className="rounded-md border border-border bg-background/70 px-2 py-1.5"><p className="text-muted-foreground">Followers</p><p className="font-semibold tabular-nums">{formatCompact(authorFollowers(mention))}</p></div>
                        <div className="rounded-md border border-border bg-background/70 px-2 py-1.5">
                          <p className="text-muted-foreground">Metrics</p>
                          {metricLines.length > 0 ? (
                            <p className="font-semibold tabular-nums">{metricLines.slice(0, 2).map((metric) => `${formatCompact(metric.value)} ${metric.label}`).join(" / ")}</p>
                          ) : (
                            <p className="font-normal text-muted-foreground">No data</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6">{mention.text}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Reason</p>
                        <p className="text-sm">{assessment.note}</p>
                        {repeatCount >= 2 && <Badge variant="secondary" className="rounded-md">{repeatCount} similar early posts</Badge>}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">Automation</span>
                          <span className="font-medium tabular-nums">{automationPercent}%</span>
                        </div>
                        <Progress value={automationPercent} />
                        {mention.sourceUrl && (
                          <Button asChild variant="outline" size="sm" className="mt-2 w-full justify-center">
                            <a href={mention.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> Open post</a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {originItems.length === 0 && <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">No origin posts yet. Run collection to collect posts for this topic.</div>}
              {originItems.length > 0 && visibleOriginItems.length === 0 && <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">No origin posts match the selected filters.</div>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
      <JobDetailDrawer jobId={activeJobId} open={Boolean(activeJobId)} onOpenChange={(open) => { if (!open) setActiveJobId(null); }} />
    </div>
    </TooltipProvider>
  );
}
