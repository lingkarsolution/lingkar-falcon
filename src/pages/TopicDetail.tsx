import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge, SentimentBadge, PlatformBadge } from "@/components/ui/badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend } from "recharts";
import { Play, Sparkles, Shield, FileText } from "lucide-react";
import { api, type Topic, type Mention, type Insight, type IssueCluster, type RiskEvent, type Connector } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

interface Timeseries { bucket: string; positive: number; neutral: number; negative: number; mixed: number; total: number }
interface PlatformDist { platform: string; count: number }
interface EntityCount { text: string; type: string; count: number }

const COLORS = ["#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

export default function TopicDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const topic = useQuery({ queryKey: qk.topic(id), queryFn: () => api.get<Topic>(`/topics/${id}`) });
  const timeseries = useQuery({ queryKey: qk.timeseries(id, "day", 14), queryFn: () => api.get<Timeseries[]>(`/analytics/topics/${id}/timeseries?bucket=day&days=14`) });
  const platforms = useQuery({ queryKey: qk.platforms(id), queryFn: () => api.get<PlatformDist[]>(`/analytics/topics/${id}/platforms`) });
  const sentiment = useQuery({ queryKey: qk.sentiment(id), queryFn: () => api.get<Record<string, number>>(`/analytics/topics/${id}/sentiment`) });
  const entities = useQuery({ queryKey: qk.entities(id), queryFn: () => api.get<EntityCount[]>(`/analytics/topics/${id}/entities`) });
  const insights = useQuery({ queryKey: qk.insights(id), queryFn: () => api.get<Insight[]>(`/ai/topics/${id}/insights`) });
  const clusters = useQuery({ queryKey: qk.clusters(id), queryFn: () => api.get<IssueCluster[]>(`/ai/topics/${id}/clusters`) });
  const riskEvents = useQuery({ queryKey: qk.riskEvents(id), queryFn: () => api.get<RiskEvent[]>(`/ai/topics/${id}/risk-events`) });
  const mentions = useQuery({ queryKey: ["mentions-topic", id], queryFn: () => api.get<{ items: Mention[] }>(`/mentions?topicId=${id}&limit=50`) });
  const connectors = useQuery({ queryKey: qk.connectors, queryFn: () => api.get<Connector[]>("/connectors") });

  const [connectorId, setConnectorId] = useState<string>("");

  const trigger = useMutation({
    mutationFn: () => api.post("/ingestion/trigger", { topicId: id, connectorId, maxItems: 50 }),
    onSuccess: () => { setTimeout(() => qc.invalidateQueries(), 1500); },
  });
  const brief = useMutation({
    mutationFn: () => api.post<Insight>("/ai/daily-brief", { topicId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.insights(id) }),
  });
  const cluster = useMutation({
    mutationFn: () => api.post<IssueCluster[]>("/ai/cluster", { topicId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clusters(id) }),
  });
  const detectRisk = useMutation({
    mutationFn: () => api.post<RiskEvent[]>("/ai/detect-risk", { topicId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.riskEvents(id) }),
  });
  const genReport = useMutation({
    mutationFn: () => api.post("/reports", { topicId: id }),
  });

  if (topic.isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!topic.data) return <div className="p-8 text-destructive">Topic not found.</div>;

  const sentEntries = Object.entries(sentiment.data ?? {}).map(([name, value]) => ({ name, value }));
  const enabledConnectors = (connectors.data ?? []).filter((c) => c.enabled && c.status === "active");

  return (
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
            <SelectContent>{enabledConnectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={() => trigger.mutate()} disabled={!connectorId || trigger.isPending}><Play className="h-4 w-4 mr-2" /> Ingest</Button>
          <Button variant="secondary" onClick={() => brief.mutate()} disabled={brief.isPending}><Sparkles className="h-4 w-4 mr-2" /> Daily brief</Button>
          <Button variant="secondary" onClick={() => { cluster.mutate(); detectRisk.mutate(); }}><Shield className="h-4 w-4 mr-2" /> Detect risk</Button>
          <Button variant="outline" onClick={() => genReport.mutate()}><FileText className="h-4 w-4 mr-2" /> Report</Button>
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
              <CardHeader><CardTitle className="text-base">By platform</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={platforms.data ?? []}>
                    <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="count" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
          {(clusters.data ?? []).map((c) => (
            <Card key={c.id}>
              <CardHeader><CardTitle className="text-base">{c.label}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">{c.size} mentions · keywords: {c.keywords.join(", ")}</p>
                <div className="flex gap-4 text-xs">
                  <span className="text-emerald-600">Positive {c.sentimentBreakdown.positive}</span>
                  <span className="text-slate-600">Neutral {c.sentimentBreakdown.neutral}</span>
                  <span className="text-red-600">Negative {c.sentimentBreakdown.negative}</span>
                </div>
              </CardContent>
            </Card>
          ))}
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
    </div>
  );
}
