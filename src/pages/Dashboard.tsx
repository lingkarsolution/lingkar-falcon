import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { SeverityBadge } from "@/components/ui/badges";
import { Activity, AlertTriangle, ListChecks, MessageSquare, Plug, Shield } from "lucide-react";
import { api, type RiskEvent, type AlertEvent } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

interface Summary {
  totalMentions: number;
  sentimentBreakdown?: Partial<Record<"positive" | "neutral" | "negative" | "mixed" | "unknown", number>>;
  sentiment24h?: Partial<Record<"positive" | "neutral" | "negative" | "mixed" | "unknown", number>>;
  activeTopics: number; totalTopics: number;
  connectorsActive: number; connectorsTotal: number;
  activeRisks: number; openAlerts: number;
  recentRisks: RiskEvent[]; recentAlerts: AlertEvent[];
}

const normalizeSentiment = (summary?: Summary) => ({
  positive: summary?.sentimentBreakdown?.positive ?? summary?.sentiment24h?.positive ?? 0,
  neutral: summary?.sentimentBreakdown?.neutral ?? summary?.sentiment24h?.neutral ?? 0,
  negative: summary?.sentimentBreakdown?.negative ?? summary?.sentiment24h?.negative ?? 0,
  mixed: summary?.sentimentBreakdown?.mixed ?? summary?.sentiment24h?.mixed ?? 0,
});

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<Summary>("/dashboard/summary"),
  });

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
