import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type IngestionJob } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function IngestionJobs() {
  const { data = [] } = useQuery({
    queryKey: qk.ingestionJobs,
    queryFn: () => api.get<IngestionJob[]>("/ingestion/jobs"),
    refetchInterval: 5000,
  });
  const color = (s: string) => ({
    completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
    running: "bg-sky-100 text-sky-700 border-sky-200",
    pending: "bg-slate-100 text-slate-700 border-slate-200",
    failed: "bg-red-100 text-red-700 border-red-200",
    cancelled: "bg-slate-100 text-slate-700 border-slate-200",
  } as Record<string, string>)[s];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ingestion Jobs</h1>
        <p className="text-muted-foreground mt-1">Live view of data collection runs (auto-refreshes every 5s).</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Job</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Fetched</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Stored</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Deduped</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Started</th>
              </tr>
            </thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs">{j.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={color(j.status)}>{j.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums">{j.itemsFetched}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{j.itemsStored}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{j.itemsDeduped}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No ingestion jobs yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

