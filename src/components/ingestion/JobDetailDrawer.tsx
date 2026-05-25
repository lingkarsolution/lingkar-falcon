import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Rows3, SkipForward, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, type IngestionJob, type IngestionJobDetail, type IngestionProgress, type IngestionRunItem } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const STATUS_CLASS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
  running: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900",
  queued: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
  pending: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
  failed: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800",
};
const statusClass = (status: string) => STATUS_CLASS[status] ?? "bg-muted text-muted-foreground border-border";

const outcomeClass = (status: IngestionRunItem["status"]) => status === "inserted"
  ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
  : "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900";

const compactNumber = (value?: number | null) => typeof value === "number" && Number.isFinite(value)
  ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
  : null;

const positiveMetric = (...values: Array<number | null | undefined>): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
};

const itemMetricLines = (item: IngestionRunItem): Array<{ label: string; value: number }> => {
  const metrics = item.metrics ?? {};
  const lines: Array<{ label: string; value: number | null }> = [
    { label: "Views", value: positiveMetric(metrics.views, metrics.viewCount) },
    { label: "Likes", value: positiveMetric(metrics.likes, metrics.likeCount) },
    { label: "Comments", value: positiveMetric(metrics.comments, metrics.commentCount) },
    { label: "Shares", value: positiveMetric(metrics.shares, metrics.shareCount) },
    { label: "Reposts", value: positiveMetric(metrics.reposts) },
    { label: "Quotes", value: positiveMetric(metrics.quotes) },
    { label: "Saves", value: positiveMetric(metrics.saves) },
  ];
  const output = lines.filter((line): line is { label: string; value: number } => line.value !== null);
  if (output.length === 0) {
    const aggregate = positiveMetric(metrics.engagementTotal);
    if (aggregate !== null) output.push({ label: "Interactions", value: aggregate });
  }
  return output;
};

const progressOf = (job?: IngestionJob | null): IngestionProgress | null => {
  const value = job?.metadata?.ingestionProgress;
  return value && typeof value === "object" ? value as IngestionProgress : null;
};

const progressPercent = (progress: IngestionProgress | null, job?: IngestionJob | null) => {
  if (!progress) return job?.status === "completed" || job?.status === "failed" ? 100 : 8;
  if (progress.stage === "completed" || progress.stage === "failed") return 100;
  const retrievalPart = progress.retrievedLimit > 0 ? Math.min(40, (progress.retrievedCount / progress.retrievedLimit) * 40) : 0;
  const processingTarget = Math.max(progress.maxItemsPerSource, progress.processedCount, 1);
  const processingPart = Math.min(45, (progress.processedCount / processingTarget) * 45);
  const enrichPart = progress.stage === "enriching" ? 10 : progress.storedCount > 0 ? 5 : 0;
  return Math.max(8, Math.min(98, Math.round(retrievalPart + processingPart + enrichPart)));
};

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

function OutcomeTable({ items, emptyText, loading }: { items: IngestionRunItem[]; emptyText: string; loading?: boolean }) {
  if (loading) return <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading run details...</div>;
  if (items.length === 0) return <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">{emptyText}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-border bg-muted/30">
          <tr className="text-left">
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Outcome</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Item</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Reason</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">Review</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const metricLines = itemMetricLines(item);
            const label = item.title ?? item.textPreview ?? item.sourceId ?? item.id;
            return (
              <tr key={item.id} className="border-b border-border last:border-b-0 align-top">
                <td className="px-3 py-2">
                  <Badge variant="outline" className={outcomeClass(item.status)}>{item.status}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{item.reasonCode.replace(/_/g, " ")}</p>
                </td>
                <td className="px-3 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">{item.platform}</Badge>
                    <span className="text-xs text-muted-foreground">{item.sourceType}</span>
                  </div>
                  <p className="max-w-md truncate font-medium">{label}</p>
                  {item.textPreview && item.textPreview !== label && <p className="mt-1 max-w-md truncate text-xs text-muted-foreground">{item.textPreview}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {item.authorName && <span>{item.authorName}</span>}
                    {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleString()}</span>}
                    {item.sourceUrl && <a className="inline-flex items-center gap-1 text-blue-600 hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <p className="max-w-md leading-6">{item.reason}</p>
                  {item.duplicateOfMentionId && <p className="mt-1 text-xs text-muted-foreground">Duplicate of {item.duplicateOfMentionId}</p>}
                </td>
                <td className="px-3 py-2">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {item.reviewSource && <p><span className="font-medium text-foreground">Source:</span> {item.reviewSource}</p>}
                    {typeof item.relevanceScore === "number" && <p><span className="font-medium text-foreground">Score:</span> {item.relevanceScore.toFixed(2)}</p>}
                    {item.sentiment && <p><span className="font-medium text-foreground">Sentiment:</span> {item.sentiment}</p>}
                    {metricLines.length > 0 ? metricLines.map((line) => (
                      <p key={line.label}><span className="font-medium text-foreground">{line.label}:</span> {compactNumber(line.value) ?? line.value}</p>
                    )) : <p><span className="font-medium text-foreground">Metrics:</span> No data</p>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface JobDetailDrawerProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JobDetailDrawer({ jobId, open, onOpenChange }: JobDetailDrawerProps) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["ingestion-job-detail", jobId],
    queryFn: () => api.get<IngestionJobDetail>(`/ingestion/jobs/${jobId}`),
    enabled: Boolean(jobId) && open,
    refetchInterval: (q) => {
      const data = q.state.data as IngestionJobDetail | undefined;
      const status = data?.job?.status;
      return status === "running" || status === "queued" || status === "pending" ? 4000 : false;
    },
  });
  const cancelJob = useMutation({
    mutationFn: (id: string) => api.post<IngestionJob>(`/ingestion/jobs/${id}/cancel`, {}),
    onSuccess: (job) => {
      toast.success(`Cancelled job ${job.id.slice(0, 12)}`);
      void qc.invalidateQueries({ queryKey: qk.ingestionJobs });
      void detail.refetch();
    },
    onError: (err: Error) => toast.error(err.message || "Could not cancel job"),
  });

  const job = detail.data?.job ?? null;
  const progress = progressOf(job);
  const items = detail.data?.items ?? [];
  const errors = detail.data?.errors ?? [];
  const groupedItems = useMemo(() => ({
    inserted: items.filter((item) => item.status === "inserted"),
    skipped: items.filter((item) => item.status === "skipped"),
  }), [items]);
  const errorMessage = typeof job?.metadata?.errorMessage === "string" ? job.metadata.errorMessage as string : null;
  const cancellable = job?.status === "queued" || job?.status === "pending" || job?.status === "running";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-4xl overflow-y-auto pr-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Collection run
            {job && <Badge variant="outline" className={statusClass(job.status)}>{job.status}</Badge>}
          </SheetTitle>
          <SheetDescription>
            <span className="font-mono text-xs">{jobId ?? ""}</span>
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-6 pb-8">
          {detail.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading run details...</div>
          )}
          {!detail.isLoading && !job && (
            <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">Run not found.</div>
          )}
          {job && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Fetched {jobCount(job, "fetched")}</Badge>
                <Badge variant="outline">Saved {jobCount(job, "saved")}</Badge>
                <Badge variant="outline">Skipped {jobCount(job, "skipped")}</Badge>
                {jobCount(job, "rejected") > 0 && <Badge variant="outline">Rejected {jobCount(job, "rejected")}</Badge>}
                {jobCount(job, "errors") > 0 && <Badge variant="outline">Errors {jobCount(job, "errors")}</Badge>}
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { void detail.refetch(); }} disabled={detail.isFetching}>
                    {detail.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Refresh
                  </Button>
                  {cancellable && (
                    <Button type="button" variant="outline" size="sm" onClick={() => cancelJob.mutate(job.id)} disabled={cancelJob.isPending}>
                      {cancelJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="font-medium capitalize">{job.jobType ?? "manual"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Connector</dt><dd className="font-mono text-xs">{job.connectorId}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Started</dt><dd className="text-xs">{job.startedAt ? new Date(job.startedAt).toLocaleString() : "-"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Finished</dt><dd className="text-xs">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "-"}</dd></div>
              </dl>

              {errorMessage && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  <p className="font-medium">Run error</p>
                  <p className="mt-1 break-words">{errorMessage}</p>
                </div>
              )}

              {progress && (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-md uppercase">{progress.platform}</Badge>
                        <Badge variant="secondary" className="rounded-md capitalize">{progress.stage}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Page {progress.currentPage || 1}; retrieval cap {progress.retrievedLimit}; target {progress.maxItemsPerSource}.</p>
                    </div>
                    <p className="text-sm font-medium tabular-nums">{progressPercent(progress, job)}%</p>
                  </div>
                  <div className="mt-3"><Progress value={progressPercent(progress, job)} /></div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-5">
                    <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Retrieved</p><p className="font-semibold tabular-nums">{progress.retrievedCount}</p></div>
                    <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Processed</p><p className="font-semibold tabular-nums">{progress.processedCount}</p></div>
                    <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Accepted</p><p className="font-semibold tabular-nums">{progress.acceptedCount}</p></div>
                    <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Rejected</p><p className="font-semibold tabular-nums">{progress.rejectedCount}</p></div>
                    <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Stored</p><p className="font-semibold tabular-nums">{progress.storedCount}</p></div>
                  </div>
                  {progress.batches.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Batch history</p>
                      {progress.batches.map((batch) => (
                        <div key={batch.page} className="grid gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs sm:grid-cols-6">
                          <span>Page {batch.page}</span>
                          <span>Requested {batch.requested}</span>
                          <span>Retrieved {batch.retrieved}</span>
                          <span>Accepted {batch.accepted}</span>
                          <span>Rejected {batch.rejected}</span>
                          <span>Stored {batch.stored}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {progress.llmStream && progress.llmStream.text && (
                    <div className="mt-4 rounded-md border border-border bg-card p-3 text-xs">
                      <p className="mb-1 font-medium uppercase text-muted-foreground">AI {progress.llmStream.phase.replace(/_/g, " ")} ({progress.llmStream.status})</p>
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{progress.llmStream.text}</pre>
                    </div>
                  )}
                </div>
              )}

              <Tabs defaultValue="all" className="gap-4">
                <TabsList className="h-auto flex-wrap justify-start">
                  <TabsTrigger value="all"><Rows3 className="h-4 w-4" /> All ({items.length})</TabsTrigger>
                  <TabsTrigger value="inserted"><CheckCircle2 className="h-4 w-4" /> Inserted ({groupedItems.inserted.length})</TabsTrigger>
                  <TabsTrigger value="skipped"><SkipForward className="h-4 w-4" /> Skipped ({groupedItems.skipped.length})</TabsTrigger>
                  <TabsTrigger value="errors"><AlertCircle className="h-4 w-4" /> Errors ({errors.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="all"><OutcomeTable items={items} loading={detail.isLoading} emptyText="This run does not have item-level details." /></TabsContent>
                <TabsContent value="inserted"><OutcomeTable items={groupedItems.inserted} loading={detail.isLoading} emptyText="No inserted items for this run." /></TabsContent>
                <TabsContent value="skipped"><OutcomeTable items={groupedItems.skipped} loading={detail.isLoading} emptyText="No skipped items for this run." /></TabsContent>
                <TabsContent value="errors">
                  {errors.length > 0 ? (
                    <div className="rounded-lg border border-border">
                      {errors.map((error) => (
                        <div key={error.id} className="border-b border-border p-4 last:border-b-0">
                          <p className="text-sm font-medium text-destructive">{error.message}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{new Date(error.createdAt).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">No errors recorded for this run.</div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
