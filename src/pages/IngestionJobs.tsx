import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, Rows3, SkipForward } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type IngestionJob, type IngestionJobDetail, type IngestionProgress, type IngestionRunItem } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const jobCount = (job: IngestionJob, key: "fetched" | "inserted" | "skipped") => {
  if (key === "fetched") return job.fetchedCount ?? job.itemsFetched ?? 0;
  if (key === "inserted") return job.insertedCount ?? job.itemsStored ?? 0;
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

const outcomeClass = (status: IngestionRunItem["status"]) => status === "inserted"
  ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
  : "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900";

const compactNumber = (value?: number | null) => typeof value === "number" && Number.isFinite(value)
  ? Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
  : null;

const itemEngagement = (item: IngestionRunItem): number | null => {
  const metrics = item.metrics ?? {};
  return metrics.engagementTotal
    ?? ((metrics.likes ?? metrics.likeCount ?? 0)
      + (metrics.shares ?? metrics.shareCount ?? metrics.reposts ?? 0)
      + (metrics.comments ?? metrics.commentCount ?? 0)
      + (metrics.quotes ?? 0));
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

function OutcomeTable({ items, emptyText, loading }: { items: IngestionRunItem[]; emptyText: string; loading?: boolean }) {
  if (loading) {
    return <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading run details...</div>;
  }
  if (items.length === 0) {
    return <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="border-b border-border bg-muted/30">
          <tr className="text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Outcome</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Item</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Reason</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Review</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const engagement = itemEngagement(item);
            const label = item.title ?? item.textPreview ?? item.sourceId ?? item.id;
            return (
              <tr key={item.id} className="border-b border-border last:border-b-0 align-top">
                <td className="px-4 py-3">
                  <Badge variant="outline" className={outcomeClass(item.status)}>{item.status}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{item.reasonCode.replace(/_/g, " ")}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">{item.platform}</Badge>
                    <span className="text-xs text-muted-foreground">{item.sourceType}</span>
                  </div>
                  <p className="max-w-xl truncate font-medium">{label}</p>
                  {item.textPreview && item.textPreview !== label && <p className="mt-1 max-w-xl truncate text-xs text-muted-foreground">{item.textPreview}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {item.authorName && <span>{item.authorName}</span>}
                    {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleString()}</span>}
                    {item.sourceId && <span className="font-mono">{item.sourceId}</span>}
                    {item.sourceUrl && <a className="inline-flex items-center gap-1 text-blue-600 hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="max-w-lg leading-6">{item.reason}</p>
                  {item.duplicateOfMentionId && <p className="mt-1 text-xs text-muted-foreground">Duplicate of {item.duplicateOfMentionId}</p>}
                  {item.mentionId && <p className="mt-1 text-xs text-muted-foreground">Mention {item.mentionId}</p>}
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {item.reviewSource && <p><span className="font-medium text-foreground">Source:</span> {item.reviewSource}</p>}
                    {typeof item.relevanceScore === "number" && <p><span className="font-medium text-foreground">Score:</span> {item.relevanceScore.toFixed(2)}</p>}
                    {item.sentiment && <p><span className="font-medium text-foreground">Sentiment:</span> {item.sentiment}</p>}
                    {engagement !== null && <p><span className="font-medium text-foreground">Engagement:</span> {compactNumber(engagement) ?? engagement}</p>}
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

export default function IngestionJobs() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: qk.ingestionJobs,
    queryFn: () => api.get<IngestionJob[]>("/ingestion/jobs"),
  });
  const data = jobs.data ?? [];
  const detail = useQuery({
    queryKey: ["ingestion-job-detail", selectedJobId],
    queryFn: () => api.get<IngestionJobDetail>(`/ingestion/jobs/${selectedJobId}`),
    enabled: Boolean(selectedJobId),
  });

  useEffect(() => {
    if (jobs.isLoading || jobs.isError) return;
    if (data.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (!selectedJobId || !data.some((job) => job.id === selectedJobId)) setSelectedJobId(data[0].id);
  }, [data, jobs.isError, jobs.isLoading, selectedJobId]);

  const selectedJob = detail.data?.job ?? data.find((job) => job.id === selectedJobId) ?? null;
  const selectedProgress = progressOf(selectedJob);
  const selectedProgressPercent = progressPercent(selectedProgress, selectedJob);
  const items = detail.data?.items ?? [];
  const errors = detail.data?.errors ?? [];
  const groupedItems = useMemo(() => ({
    inserted: items.filter((item) => item.status === "inserted"),
    skipped: items.filter((item) => item.status === "skipped"),
  }), [items]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Collection Runs</h1>
          <p className="text-muted-foreground mt-1">Open a run to inspect collected, stored, and skipped posts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { void jobs.refetch(); if (selectedJobId) void detail.refetch(); }} disabled={jobs.isFetching || detail.isFetching}>
            {jobs.isFetching || detail.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
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
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Stored</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Skipped</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Started</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {jobs.isLoading && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading collection runs...</span></td></tr>}
              {jobs.isError && <tr><td colSpan={7} className="px-4 py-12 text-center text-destructive">Could not load collection runs.</td></tr>}
              {!jobs.isLoading && !jobs.isError && data.map((j) => (
                <tr key={j.id} className={selectedJobId === j.id ? "border-b border-border bg-muted/40 last:border-b-0" : "border-b border-border last:border-b-0"}>
                  <td className="px-4 py-3">
                    <button type="button" className="font-mono text-xs text-blue-600 hover:underline" onClick={() => setSelectedJobId(j.id)}>{j.id.slice(0, 12)}...</button>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className={statusClass(j.status)}>{j.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums">{jobCount(j, "fetched")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{jobCount(j, "inserted")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{jobCount(j, "skipped")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{j.startedAt ? new Date(j.startedAt).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant={selectedJobId === j.id ? "secondary" : "outline"} size="sm" onClick={() => setSelectedJobId(j.id)}>
                      <Rows3 className="mr-2 h-4 w-4" /> Details
                    </Button>
                  </td>
                </tr>
              ))}
              {!jobs.isLoading && !jobs.isError && data.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No collection runs yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selectedJob && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Run details</CardTitle>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{selectedJob.id}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { void detail.refetch(); }} disabled={detail.isFetching}>
                  {detail.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh details
                </Button>
                <Badge variant="outline" className={statusClass(selectedJob.status)}>{selectedJob.status}</Badge>
                <Badge variant="outline">Fetched {jobCount(selectedJob, "fetched")}</Badge>
                <Badge variant="outline">Stored {jobCount(selectedJob, "inserted")}</Badge>
                <Badge variant="outline">Skipped {jobCount(selectedJob, "skipped")}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedProgress && (
              <div className="mb-6 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-md uppercase">{selectedProgress.platform}</Badge>
                      <Badge variant="secondary" className="rounded-md capitalize">{selectedProgress.stage}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Page {selectedProgress.currentPage || 1}; retrieval cap {selectedProgress.retrievedLimit}; max related target {selectedProgress.maxItemsPerSource}.</p>
                  </div>
                  <p className="text-sm font-medium tabular-nums">{selectedProgressPercent}%</p>
                </div>
                <div className="mt-4"><Progress value={selectedProgressPercent} /></div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-5">
                  <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Retrieved</p><p className="font-semibold tabular-nums">{selectedProgress.retrievedCount}</p></div>
                  <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Processed</p><p className="font-semibold tabular-nums">{selectedProgress.processedCount}</p></div>
                  <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Accepted</p><p className="font-semibold tabular-nums">{selectedProgress.acceptedCount}</p></div>
                  <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Rejected</p><p className="font-semibold tabular-nums">{selectedProgress.rejectedCount}</p></div>
                  <div className="rounded-md border border-border bg-card px-3 py-2"><p className="text-xs text-muted-foreground">Stored</p><p className="font-semibold tabular-nums">{selectedProgress.storedCount}</p></div>
                </div>
                {selectedProgress.batches.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Batch history</p>
                    {selectedProgress.batches.map((batch) => (
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
              </div>
            )}
            <Tabs defaultValue="all" className="gap-4">
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="all"><Rows3 className="h-4 w-4" /> All ({items.length})</TabsTrigger>
                <TabsTrigger value="inserted"><CheckCircle2 className="h-4 w-4" /> Inserted ({groupedItems.inserted.length})</TabsTrigger>
                <TabsTrigger value="skipped"><SkipForward className="h-4 w-4" /> Skipped ({groupedItems.skipped.length})</TabsTrigger>
                <TabsTrigger value="errors"><AlertCircle className="h-4 w-4" /> Errors ({errors.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="all">
                <OutcomeTable items={items} loading={detail.isLoading} emptyText="This run does not have item-level details. New collection runs will record inserted and skipped reasons." />
              </TabsContent>
              <TabsContent value="inserted">
                <OutcomeTable items={groupedItems.inserted} loading={detail.isLoading} emptyText="No inserted items for this run." />
              </TabsContent>
              <TabsContent value="skipped">
                <OutcomeTable items={groupedItems.skipped} loading={detail.isLoading} emptyText="No skipped items for this run." />
              </TabsContent>
              <TabsContent value="errors">
                {detail.isLoading ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-border p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading errors...</div>
                ) : errors.length > 0 ? (
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

