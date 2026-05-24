import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { SeverityBadge } from "@/components/ui/badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, AlertTriangle, ListChecks, MapPinned, MessageSquare, Plug, Shield } from "lucide-react";
import { api, type RiskEvent, type AlertEvent, type Topic } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import "leaflet/dist/leaflet.css";

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

interface Summary {
  totalMentions: number;
  sentimentBreakdown?: Partial<Record<SentimentKey, number>>;
  sentiment24h?: Partial<Record<SentimentKey, number>>;
  activeTopics: number; totalTopics: number;
  connectorsActive: number; connectorsTotal: number;
  activeRisks: number; openAlerts: number;
  recentRisks: RiskEvent[]; recentAlerts: AlertEvent[];
  geoTrends?: GeoTrend[];
}

const normalizeSentiment = (summary?: Summary) => ({
  positive: summary?.sentimentBreakdown?.positive ?? summary?.sentiment24h?.positive ?? 0,
  neutral: summary?.sentimentBreakdown?.neutral ?? summary?.sentiment24h?.neutral ?? 0,
  negative: summary?.sentimentBreakdown?.negative ?? summary?.sentiment24h?.negative ?? 0,
  mixed: summary?.sentimentBreakdown?.mixed ?? summary?.sentiment24h?.mixed ?? 0,
});

const sentimentStyles: Record<SentimentKey, { label: string; color: string; text: string }> = {
  positive: { label: "Positive", color: "#10b981", text: "text-emerald-700 dark:text-emerald-300" },
  neutral: { label: "Neutral", color: "#94a3b8", text: "text-slate-700 dark:text-slate-300" },
  negative: { label: "Negative", color: "#ef4444", text: "text-red-700 dark:text-red-300" },
  mixed: { label: "Mixed", color: "#f59e0b", text: "text-amber-700 dark:text-amber-300" },
  unknown: { label: "Unknown", color: "#a1a1aa", text: "text-muted-foreground" },
};

const dominantSentiment = (trend: GeoTrend): SentimentKey => {
  const entries = Object.entries(trend.sentimentBreakdown ?? {}) as Array<[SentimentKey, number]>;
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
};

const maxMentionCount = (trends: GeoTrend[]) => Math.max(1, ...trends.map((trend) => trend.mentionCount));

const mappableTrends = (trends: GeoTrend[]) => trends.filter((trend) => Number.isFinite(trend.latitude) && Number.isFinite(trend.longitude));

const sentimentOptions: Array<{ value: SentimentKey | "all"; label: string }> = [
  { value: "all", label: "All sentiment" },
  { value: "negative", label: "Negative" },
  { value: "mixed", label: "Mixed" },
  { value: "neutral", label: "Neutral" },
  { value: "positive", label: "Positive" },
];

const mergeGeoTrends = (trends: GeoTrend[]): GeoTrend[] => {
  const grouped = new Map<string, GeoTrend>();
  for (const trend of trends) {
    const existing = grouped.get(trend.city);
    if (!existing) {
      grouped.set(trend.city, { ...trend, id: `all_${trend.city}`, topicId: "all", topKeywords: [...trend.topKeywords] });
      continue;
    }
    const mentionCount = existing.mentionCount + trend.mentionCount;
    const confidence = mentionCount > 0
      ? ((existing.confidence * existing.mentionCount) + (trend.confidence * trend.mentionCount)) / mentionCount
      : existing.confidence;
    const sentimentBreakdown = { ...existing.sentimentBreakdown };
    for (const key of ["positive", "neutral", "negative", "mixed", "unknown"] as SentimentKey[]) {
      sentimentBreakdown[key] = (sentimentBreakdown[key] ?? 0) + (trend.sentimentBreakdown[key] ?? 0);
    }
    grouped.set(trend.city, {
      ...existing,
      mentionCount,
      engagementTotal: existing.engagementTotal + trend.engagementTotal,
      sentimentBreakdown,
      trendScore: Math.max(existing.trendScore ?? 1, trend.trendScore ?? 1),
      confidence: Number(confidence.toFixed(2)),
      topKeywords: [...new Set([...existing.topKeywords, ...trend.topKeywords])].slice(0, 5),
    });
  }
  return [...grouped.values()].sort((a, b) => b.mentionCount - a.mentionCount || b.engagementTotal - a.engagementTotal);
};

const visibleMentionCount = (trend: GeoTrend, sentimentFilter: SentimentKey | "all") =>
  sentimentFilter === "all" ? trend.mentionCount : trend.sentimentBreakdown[sentimentFilter] ?? 0;

export default function Dashboard() {
  const [topicFilter, setTopicFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentKey | "all">("all");
  const { data, isLoading } = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<Summary>("/dashboard/summary"),
  });
  const { data: topics = [] } = useQuery({ queryKey: qk.topics, queryFn: () => api.get<Topic[]>("/topics") });
  const filteredGeoTrends = useMemo(() => {
    const topicRows = topicFilter === "all"
      ? mergeGeoTrends(data?.geoTrends ?? [])
      : (data?.geoTrends ?? []).filter((trend) => trend.topicId === topicFilter);
    return topicRows
      .filter((trend) => visibleMentionCount(trend, sentimentFilter) > 0)
      .sort((a, b) => visibleMentionCount(b, sentimentFilter) - visibleMentionCount(a, sentimentFilter));
  }, [data?.geoTrends, sentimentFilter, topicFilter]);
  const visibleMax = Math.max(1, ...filteredGeoTrends.map((trend) => visibleMentionCount(trend, sentimentFilter)));

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading dashboard…</div>;
  if (!data) return <div className="p-8 text-destructive">Failed to load dashboard.</div>;

  const sentiment = normalizeSentiment(data);
  const totalSent = Object.values(sentiment).reduce((a, b) => a + b, 0) || 1;
  const negPct = Math.round((sentiment.negative / totalSent) * 100);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Real-time view of public conversation and risk posture.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Mentions" value={data.totalMentions} hint="Across all topics" icon={MessageSquare} tint="purple" />
        <MetricCard label="Active Topics" value={`${data.activeTopics}/${data.totalTopics}`} icon={ListChecks} tint="sky" />
        <MetricCard label="Connectors" value={`${data.connectorsActive}/${data.connectorsTotal}`} hint="Healthy / total" icon={Plug} tint="mint" />
        <MetricCard label="Negative share" value={`${negPct}%`} hint={`${sentiment.negative} negative mentions`} icon={Activity} tint="rose" />
      </div>

      <Card>
        <CardHeader className="gap-4 space-y-0 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><MapPinned className="h-4 w-4" /> Indonesia Regional Pulse</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">AI-inferred city signals from collected public mentions.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={topicFilter} onValueChange={setTopicFilter}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Topic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics</SelectItem>
                {topics.map((topic) => <SelectItem key={topic.id} value={topic.id}>{topic.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sentimentFilter} onValueChange={(value) => setSentimentFilter(value as SentimentKey | "all")}>
              <SelectTrigger className="w-full sm:w-[170px]">
                <SelectValue placeholder="Sentiment" />
              </SelectTrigger>
              <SelectContent>
                {sentimentOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="relative h-[440px] overflow-hidden rounded-lg border border-border bg-muted">
              <MapContainer
                center={[-2.6, 118]}
                zoom={4}
                minZoom={4}
                maxZoom={9}
                scrollWheelZoom={false}
                maxBounds={[[-12, 94], [7, 143]]}
                className="h-full w-full z-0"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mappableTrends(filteredGeoTrends).map((trend) => {
                  const sentimentKey = sentimentFilter === "all" ? dominantSentiment(trend) : sentimentFilter;
                  const styles = sentimentStyles[sentimentKey];
                  const count = visibleMentionCount(trend, sentimentFilter);
                  const radius = 8 + Math.round((count / visibleMax) * 18);
                  return (
                    <CircleMarker
                      key={trend.id}
                      center={[trend.latitude!, trend.longitude!]}
                      radius={radius}
                      pathOptions={{
                        color: styles.color,
                        fillColor: styles.color,
                        fillOpacity: 0.55,
                        opacity: 0.9,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <div className="min-w-40 text-sm">
                          <p className="font-semibold">{trend.city}</p>
                          <p className="text-xs text-muted-foreground">{trend.province ?? "Indonesia"}</p>
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <span>Mentions</span><strong>{count}</strong>
                            <span>Sentiment</span><strong>{styles.label}</strong>
                            <span>Lift</span><strong>{trend.trendScore?.toFixed(1) ?? "1.0"}x</strong>
                            <span>Confidence</span><strong>{Math.round(trend.confidence * 100)}%</strong>
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
              {mappableTrends(filteredGeoTrends).length === 0 && (
                <div className="absolute inset-x-6 bottom-6 rounded-md border border-border bg-background/90 p-4 text-sm text-muted-foreground shadow-sm">
                  No inferred regional signals match this topic and sentiment filter yet.
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {filteredGeoTrends.slice(0, 8).map((trend) => {
                const sentimentKey = sentimentFilter === "all" ? dominantSentiment(trend) : sentimentFilter;
                const styles = sentimentStyles[sentimentKey];
                const count = visibleMentionCount(trend, sentimentFilter);
                return (
                  <div key={trend.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{trend.city}</p>
                        <p className="text-xs text-muted-foreground truncate">{trend.province ?? "Indonesia"}</p>
                      </div>
                      <span className={`text-xs font-medium ${styles.text}`}>{styles.label}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Mentions</p><p className="font-semibold tabular-nums">{count}</p></div>
                      <div><p className="text-muted-foreground">Lift</p><p className="font-semibold tabular-nums">{trend.trendScore?.toFixed(1) ?? "1.0"}x</p></div>
                      <div><p className="text-muted-foreground">Confidence</p><p className="font-semibold tabular-nums">{Math.round(trend.confidence * 100)}%</p></div>
                    </div>
                    {trend.topKeywords.length > 0 && <p className="mt-2 truncate text-xs text-muted-foreground">{trend.topKeywords.join(" · ")}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Top Risk Events</CardTitle>
            <Link to="/topics" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentRisks.length === 0 && <p className="text-sm text-muted-foreground">No risk events yet. Run ingestion + risk detection on a topic.</p>}
            {data.recentRisks.map((r) => (
              <div key={r.id} className="flex items-start justify-between border-b border-border pb-3 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{r.summary}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-sm font-semibold tabular-nums">{r.score}</span>
                  <SeverityBadge severity={r.severity} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Recent Alerts</CardTitle>
            <Link to="/alerts" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentAlerts.length === 0 && <p className="text-sm text-muted-foreground">No active alerts. Configure alert rules under Alerts.</p>}
            {data.recentAlerts.map((a) => (
              <div key={a.id} className="flex items-start justify-between border-b border-border pb-3 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(a.triggeredAt).toLocaleString()}</p>
                </div>
                <SeverityBadge severity={a.severity} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Sentiment breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="flex h-6 rounded-md overflow-hidden border border-border">
            <div className="bg-emerald-500" style={{ width: `${(sentiment.positive / totalSent) * 100}%` }} />
            <div className="bg-slate-400" style={{ width: `${(sentiment.neutral / totalSent) * 100}%` }} />
            <div className="bg-amber-500" style={{ width: `${(sentiment.mixed / totalSent) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(sentiment.negative / totalSent) * 100}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1" />Positive {sentiment.positive}</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-slate-400 mr-1" />Neutral {sentiment.neutral}</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-1" />Mixed {sentiment.mixed}</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-red-500 mr-1" />Negative {sentiment.negative}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
