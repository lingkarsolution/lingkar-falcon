import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RefreshCw, Rows3, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type IngestionJob } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { JobDetailDrawer } from "@/components/ingestion/JobDetailDrawer";

const jobCount = (job: IngestionJob, key: "fetched" | "saved" | "rejected" | "skipped" | "errors") => {
  if (key === "fetched") return job.fetchedCount ?? job.itemsFetched ?? 0;
  if (key === "saved") {
    if (typeof job.acceptedCount === "number") return job.acceptedCount;
    const rejected = typeof job.rejectedCount === "number" ? job.rejectedCount : 0;
    return Math.max(0, (job.insertedCount ?? job.itemsStored ?? 0) - rejected);
  }
  if (key === "rejected") return job.rejectedCount ?? 0;
  if (key === "errors") return job.errorCount ?? 0;
  return job.skippedCount ?? job.itemsDeduped ?? 0;
};

const statusClass = (status: string) => ({
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
  running: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900",
  queued: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
  pending: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
  failed: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
} as Record<string, string>)[status] ?? "bg-muted text-muted-foreground border-border";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;
const isJobStalled = (job: IngestionJob): boolean => {
  if (job.status !== "running") return false;
  const progress = job.metadata?.ingestionProgress as { updatedAt?: unknown } | undefined;
  const ref = (typeof progress?.updatedAt === "string" && progress.updatedAt) || job.startedAt;
  if (!ref) return false;
  const t = new Date(ref).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > STALL_THRESHOLD_MS;
};

export default function IngestionJobs() {
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: qk.ingestionJobs,
    queryFn: () => api.get<IngestionJob[]>("/ingestion/jobs"),
  });
  const data = jobs.data ?? [];
  const queuedCount = useMemo(() => data.filter((j) => j.status === "queued" || j.status === "pending").length, [data]);
  const cancelJob = useMutation({
    mutationFn: (jobId: string) => api.post<IngestionJob>(`/ingestion/jobs/${jobId}/cancel`, {}),
    onSuccess: (job) => {
      toast.success(`Cancelled job ${job.id.slice(0, 12)}`);
      void qc.invalidateQueries({ queryKey: qk.ingestionJobs });
      void qc.invalidateQueries({ queryKey: ["ingestion-job-detail", job.id] });
    },
    onError: (err: Error) => toast.error(err.message || "Could not cancel job"),
  });
  const cancelAllQueued = useMutation({
    mutationFn: () => api.post<{ count: number }>(`/ingestion/jobs/cancel-queued`, {}),
    onSuccess: (result) => {
      toast.success(`Cancelled ${result.count} queued ${result.count === 1 ? "job" : "jobs"}`);
      void qc.invalidateQueries({ queryKey: qk.ingestionJobs });
    },
    onError: (err: Error) => toast.error(err.message || "Could not cancel queued jobs"),
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Collection Runs</h1>
          <p className="text-muted-foreground mt-1">Click a run to open its logs, progress, and item-level outcomes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { void jobs.refetch(); }} disabled={jobs.isFetching}>
            {jobs.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
          {queuedCount > 0 && (
            <Button type="button" variant="outline" onClick={() => cancelAllQueued.mutate()} disabled={cancelAllQueued.isPending}>
              {cancelAllQueued.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Cancel queued ({queuedCount})
            </Button>
          )}
          <Button asChild>
            <Link to="/ingestions/form"><Plus className="h-4 w-4" /> Collect posts</Link>
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Run</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Fetched</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Saved</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Skipped</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Rejected</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Errors</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Started</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.isLoading && <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading collection runs...</span></td></tr>}
              {jobs.isError && <tr><td colSpan={9} className="px-4 py-12 text-center text-destructive">Could not load collection runs.</td></tr>}
              {!jobs.isLoading && !jobs.isError && data.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <button type="button" className="font-mono text-xs text-blue-600 hover:underline" onClick={() => setActiveJobId(j.id)}>{j.id.slice(0, 18)}...</button>
                    <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">{j.jobType ?? "manual"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className={statusClass(j.status)}>{j.status}</Badge>
                      {isJobStalled(j) && <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"><AlertTriangle className="mr-1 h-3 w-3" /> stalled</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{jobCount(j, "fetched")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{jobCount(j, "saved")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{jobCount(j, "skipped")}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{jobCount(j, "rejected")}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{jobCount(j, "errors")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{j.startedAt ? new Date(j.startedAt).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {(j.status === "queued" || j.status === "pending") && (
                        <Button variant="outline" size="sm" onClick={() => cancelJob.mutate(j.id)} disabled={cancelJob.isPending}>
                          <XCircle className="mr-2 h-4 w-4" /> Cancel
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setActiveJobId(j.id)}>
                        <Rows3 className="mr-2 h-4 w-4" /> View logs
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!jobs.isLoading && !jobs.isError && data.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No collection runs yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <JobDetailDrawer jobId={activeJobId} open={Boolean(activeJobId)} onOpenChange={(open) => { if (!open) setActiveJobId(null); }} />
    </div>
  );
}
