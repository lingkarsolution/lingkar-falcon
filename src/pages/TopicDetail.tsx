import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge, SentimentBadge, PlatformBadge } from "@/components/ui/badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Brain, CheckCircle2, Clock3, FileText, Loader2, Play, RefreshCw, Sparkles, Shield, XCircle } from "lucide-react";
import { api, type BulkSentimentResult, type IngestionJob, type IngestionJobDetail, type IntelligenceCycleResult, type Topic, type Mention, type Insight, type IssueCluster, type RiskEvent, type Connector } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

interface Timeseries { bucket: string; positive: number; neutral: number; negative: number; mixed: number; total: number }
interface EntityCount { text: string; type: string; count: number }

const COLORS = ["#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];
type OperationKind = "ingest" | "cycle" | "sentiment" | "brief" | "risk" | "report";
type OperationState = { open: boolean; kind: OperationKind; title: string; description: string; progress: number; status: "running" | "completed" | "failed"; logs: string[]; jobId?: string };

const pct = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;
const jobProgress = (job?: IngestionJob): number => {
  if (!job) return 12;
  if (job.status === "completed") return 100;
  if (job.status === "failed" || job.status === "cancelled") return 100;
  if (job.status === "running") return 65;
  return 24;
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
  const clusters = useQuery({ queryKey: qk.clusters(id), queryFn: () => api.get<IssueCluster[]>(`/ai/topics/${id}/clusters`) });
  const riskEvents = useQuery({ queryKey: qk.riskEvents(id), queryFn: () => api.get<RiskEvent[]>(`/ai/topics/${id}/risk-events`) });
  const mentions = useQuery({ queryKey: ["mentions-topic", id], queryFn: () => api.get<{ items: Mention[] }>(`/mentions?topicId=${id}&limit=50`) });
  const connectors = useQuery({ queryKey: qk.connectors, queryFn: () => api.get<Connector[]>("/connectors") });

  const [connectorId, setConnectorId] = useState<string>("");
  const [historyDays, setHistoryDays] = useState("30");
  const [operation, setOperation] = useState<OperationState | null>(null);

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
      finishOperation({ progress: 24, jobId: createdJob.id, logs: [`Job ${createdJob.id} queued.`, "Watching connector progress."] });
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

  const sentEntries = Object.entries(sentiment.data ?? {}).map(([name, value]) => ({ name, value }));
  const enabledConnectors = (connectors.data ?? []).filter((c) => c.enabled && (c.status === "active" || c.status === "limited"));
  const mentionItems = mentions.data?.items ?? [];
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
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="raw">Raw Data</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="risk">Risk Events</TabsTrigger>
          <TabsTrigger value="entities">Entities</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
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
        </TabsContent>

        <TabsContent value="raw" className="space-y-3 mt-6">
          {(mentions.data?.items ?? []).map((m) => (
            <Card key={m.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PlatformBadge platform={m.platform} />
                      <SentimentBadge sentiment={m.nlp.sentiment} />
                      <span>{m.author?.displayName ?? m.author?.username ?? "unknown"}</span>
                      <span>·</span>
                      <span>{new Date(m.publishedAt ?? m.collectedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm">{m.text}</p>
                    {m.sourceUrl && <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open source ↗</a>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(mentions.data?.items ?? []).length === 0 && <Card><CardContent className="p-12 text-center text-muted-foreground">No mentions yet. Run an ingestion job.</CardContent></Card>}
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

        <TabsContent value="issues" className="space-y-3 mt-6">
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
