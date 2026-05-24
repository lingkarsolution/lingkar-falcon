import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, AtSign, CalendarClock, ChevronDown, ChevronRight, Hash, Instagram, MessageCircle, Music2, Newspaper, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Youtube, type LucideIcon } from "lucide-react";
import { api, type IndonesianNewsSearchResult, type Platform, type Topic, type TrendItem, type TrendSnapshot } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const trendPlatforms: Platform[] = ["x", "threads", "tiktok", "instagram", "youtube", "facebook", "reddit", "news"];

const platformMeta: Partial<Record<Platform, { label: string; color: string; bg: string; icon?: LucideIcon; mark?: string }>> = {
  x: { label: "X / Twitter", color: "#111111", bg: "rgba(17, 17, 17, 0.08)", icon: Hash, mark: "X" },
  threads: { label: "Threads", color: "#111111", bg: "rgba(17, 17, 17, 0.08)", icon: AtSign },
  tiktok: { label: "TikTok", color: "#00f2ea", bg: "rgba(0, 242, 234, 0.12)", icon: Music2 },
  instagram: { label: "Instagram", color: "#e4405f", bg: "rgba(228, 64, 95, 0.12)", icon: Instagram },
  youtube: { label: "YouTube", color: "#ff0033", bg: "rgba(255, 0, 51, 0.12)", icon: Youtube },
  facebook: { label: "Facebook", color: "#1877f2", bg: "rgba(24, 119, 242, 0.12)", mark: "f" },
  reddit: { label: "Reddit", color: "#ff4500", bg: "rgba(255, 69, 0, 0.12)", icon: MessageCircle },
  news: { label: "News / Web", color: "#0ea5e9", bg: "rgba(14, 165, 233, 0.12)", icon: Newspaper },
};

const platformLabel = (platform: Platform) => platformMeta[platform]?.label ?? platform;

function PlatformMark({ platform, className = "h-4 w-4" }: { platform: Platform; className?: string }) {
  const meta = platformMeta[platform];
  const Icon = meta?.icon;
  if (meta?.mark) return <span className="text-xs font-bold leading-none" style={{ color: meta.color }}>{meta.mark}</span>;
  if (Icon) return <Icon className={className} style={{ color: meta.color }} />;
  return <Hash className={className} style={{ color: meta?.color ?? "currentColor" }} />;
}

const sourceLabels = {
  cached_mentions: "Cached mentions",
  public_search: "Public search",
  connector: "Connector",
  ensembledata: "EnsembleData",
  mixed: "Mixed sources",
} as const;

const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not available";
type DescriptionTarget = "create" | "edit";

function TopicRow({ topic, onEdit, onDelete }: { topic: Topic; onEdit: (topic: Topic) => void; onDelete: (topic: Topic) => void }) {
  return (
    <div className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.35fr)_150px_minmax(0,1fr)_130px_140px] md:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/topics/${topic.id}`} className="min-w-0 font-medium hover:underline">
              <span className="block truncate">{topic.title}</span>
            </Link>
            <Badge variant={topic.status === "active" ? "default" : "secondary"} className="capitalize">{topic.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{topic.description?.trim() || "No description"}</p>
        </div>
        <div className="text-sm text-muted-foreground">{topic.platforms.slice(0, 3).join(", ") || "Any source"}</div>
        <div className="flex flex-wrap gap-1">
          {topic.keywords.slice(0, 5).map((keyword) => <Badge key={keyword} variant="outline" className="font-mono text-[10px]">{keyword}</Badge>)}
        </div>
        <div className="text-xs text-muted-foreground md:text-right">Updated {new Date(topic.updatedAt).toLocaleDateString()}</div>
        <TooltipProvider>
          <div className="flex flex-wrap justify-start gap-2 md:justify-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label={`Edit ${topic.title}`} onClick={() => onEdit(topic)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit topic</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="destructive" size="icon" aria-label={`Delete ${topic.title}`} onClick={() => onDelete(topic)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete topic</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

function TrendRow({ trend, onOpen, disabled }: { trend: TrendItem; onOpen: (trend: TrendItem) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(trend)}
      disabled={disabled}
      className="block w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_120px_120px_120px] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium truncate">{trend.title}</p>
            {trend.matchedTopicId && <Badge variant="secondary">Monitored</Badge>}
            <Badge variant="outline">{sourceLabels[trend.sourceType]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-1">{trend.description ?? trend.keywords.join(", ")}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {trend.keywords.slice(0, 5).map((keyword) => <Badge key={keyword} variant="outline" className="font-mono text-[10px]">{keyword}</Badge>)}
          </div>
        </div>
        <div className="text-sm"><span className="text-muted-foreground">Mentions </span><span className="font-semibold tabular-nums">{trend.mentionCount}</span></div>
        <div className="text-sm"><span className="text-muted-foreground">Sources </span><span className="font-semibold tabular-nums">{trend.sourceCount}</span></div>
        <div className="text-xs text-muted-foreground md:text-right">Latest {trend.latestSeenAt ? new Date(trend.latestSeenAt).toLocaleDateString() : "unknown"}</div>
      </div>
    </button>
  );
}

export default function Topics() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: topics = [] } = useQuery({ queryKey: qk.topics, queryFn: () => api.get<Topic[]>("/topics") });
  const { data: trendSnapshot } = useQuery({ queryKey: qk.trends, queryFn: () => api.get<TrendSnapshot | null>("/trends") });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [historyDays, setHistoryDays] = useState("30");
  const [includeTrendingNews, setIncludeTrendingNews] = useState(true);
  const [trendingQuery, setTrendingQuery] = useState("");
  const [previewQuery, setPreviewQuery] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(trendPlatforms);
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<Platform[]>([]);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deletingTopic, setDeletingTopic] = useState<Topic | null>(null);
  const [generatingDescriptionFor, setGeneratingDescriptionFor] = useState<DescriptionTarget | null>(null);

  const keywordList = useMemo(() => keywords.split(",").map((k) => k.trim()).filter(Boolean), [keywords]);
  const discoveryQuery = (trendingQuery.trim() || keywordList.join(" ") || title.trim()).trim();
  const canCreateTopic = title.trim().length >= 2 && description.trim().length > 0 && keywordList.length > 0;
  const canUpdateTopic = editTitle.trim().length >= 2 && editDescription.trim().length > 0;
  const trendingPreview = useQuery({
    queryKey: ["topic-trending-news", previewQuery],
    queryFn: () => api.get<IndonesianNewsSearchResult>(`/topics/trending-news?query=${encodeURIComponent(previewQuery)}&maxResults=6`),
    enabled: open && includeTrendingNews && previewQuery.length > 1,
  });

  const refreshTrends = useMutation({
    mutationFn: () => api.post<TrendSnapshot>("/trends/refresh", { limitPerPlatform: 10 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.trends }),
  });

  const monitorTrend = useMutation({
    mutationFn: (trend: TrendItem) => api.post<Topic>(`/trends/${trend.id}/monitor`),
    onSuccess: (topic) => {
      qc.invalidateQueries({ queryKey: qk.topics });
      qc.invalidateQueries({ queryKey: qk.trends });
      navigate(`/topics/${topic.id}`);
    },
  });

  const generateDescription = useMutation({
    mutationFn: (payload: { title: string; target: DescriptionTarget }) => api.post<{ description: string; llmEnabled: boolean; generatedAt: string }>("/ai/topic-description", { title: payload.title.trim() }),
    onMutate: (payload) => {
      setGeneratingDescriptionFor(payload.target);
    },
    onSuccess: (result, payload) => {
      if (payload.target === "create") setDescription(result.description);
      else setEditDescription(result.description);
    },
    onSettled: () => {
      setGeneratingDescriptionFor(null);
    },
  });

  const availableTrendPlatforms = trendSnapshot?.platforms?.length ? trendSnapshot.platforms : trendPlatforms;
  const visibleTrendPlatforms = availableTrendPlatforms.filter((platform) => selectedPlatforms.includes(platform));
  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  };
  const togglePlatformCollapse = (platform: Platform) => {
    setCollapsedPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  };

  const create = useMutation({
    mutationFn: () => api.post<Topic>("/topics", {
      title: title.trim(),
      description: description.trim(),
      keywords: keywordList,
      historyDays: Number(historyDays),
      ingestTrendingNews: includeTrendingNews,
      trendingNewsQuery: discoveryQuery,
      trendingNewsMaxItems: 24,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.topics });
      setOpen(false); setTitle(""); setDescription(""); setKeywords(""); setTrendingQuery(""); setPreviewQuery("");
      setHistoryDays("30"); setIncludeTrendingNews(true);
    },
  });

  const startEditTopic = (topic: Topic) => {
    setEditingTopic(topic);
    setEditTitle(topic.title);
    setEditDescription(topic.description ?? "");
  };

  const updateTopic = useMutation({
    mutationFn: () => api.patch<Topic>(`/topics/${editingTopic!.id}`, {
      title: editTitle.trim(),
      description: editDescription.trim(),
    }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: qk.topics });
      qc.invalidateQueries({ queryKey: qk.topic(updated.id) });
      setEditingTopic(null);
      setEditTitle("");
      setEditDescription("");
    },
  });

  const deleteTopic = useMutation({
    mutationFn: () => api.delete<{ deleted: string }>(`/topics/${deletingTopic!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.topics });
      qc.invalidateQueries({ queryKey: qk.trends });
      setDeletingTopic(null);
    },
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Topics</h1>
          <p className="text-muted-foreground mt-1">Monitor known conversations or discover emerging trends before tracking them.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New Topic</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader><DialogTitle>Create topic</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label htmlFor="topic-title">Title</Label><Input id="topic-title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="topic-description">Description</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => generateDescription.mutate({ title, target: "create" })}
                    disabled={title.trim().length < 2 || generateDescription.isPending}
                  >
                    <Sparkles className="h-4 w-4" />
                    {generatingDescriptionFor === "create" ? "Generating…" : "Generate"}
                  </Button>
                </div>
                <Textarea id="topic-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
                {generateDescription.isError && open && <p className="text-sm text-destructive">{generateDescription.error instanceof Error ? generateDescription.error.message : "Could not generate description."}</p>}
              </div>
              <div className="space-y-2"><Label>Keywords (comma-separated)</Label><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="economy, inflation, jobs" /></div>
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Newspaper className="h-4 w-4 text-primary" />
                    <Label htmlFor="trending-news">Indonesian trending news</Label>
                  </div>
                  <Switch id="trending-news" checked={includeTrendingNews} onCheckedChange={setIncludeTrendingNews} />
                </div>
                {includeTrendingNews && (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_130px_auto]">
                      <Input value={trendingQuery} onChange={(e) => setTrendingQuery(e.target.value)} placeholder="Use topic keywords" />
                      <Select value={historyDays} onValueChange={setHistoryDays}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[7, 14, 30, 60, 90].map((days) => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" onClick={() => setPreviewQuery(discoveryQuery)} disabled={!discoveryQuery || trendingPreview.isFetching}>
                        <Search className="h-4 w-4 mr-2" /> Preview
                      </Button>
                    </div>
                    {trendingPreview.isFetching && <p className="text-sm text-muted-foreground">Searching Indonesian sources…</p>}
                    {(trendingPreview.data?.results ?? []).length > 0 && (
                      <div className="space-y-2">
                        {trendingPreview.data!.results.slice(0, 4).map((item) => (
                          <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="block rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-primary">
                            <span className="font-medium line-clamp-1">{item.title}</span>
                            <span className="text-xs text-muted-foreground">{item.sourceDomain}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {trendingPreview.data && trendingPreview.data.results.length === 0 && <p className="text-sm text-muted-foreground">No results returned for this query.</p>}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!canCreateTopic || create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={Boolean(editingTopic)} onOpenChange={(nextOpen) => { if (!nextOpen) setEditingTopic(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit monitored topic</DialogTitle>
            <DialogDescription>Update the topic title and analyst-facing description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-topic-title">Title</Label>
              <Input id="edit-topic-title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="edit-topic-description">Description</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => generateDescription.mutate({ title: editTitle, target: "edit" })}
                  disabled={editTitle.trim().length < 2 || generateDescription.isPending}
                >
                  <Sparkles className="h-4 w-4" />
                  {generatingDescriptionFor === "edit" ? "Generating…" : "Generate"}
                </Button>
              </div>
              <Textarea id="edit-topic-description" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="min-h-28" required />
              {generateDescription.isError && Boolean(editingTopic) && <p className="text-sm text-destructive">{generateDescription.error instanceof Error ? generateDescription.error.message : "Could not generate description."}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingTopic(null)}>Cancel</Button>
            <Button onClick={() => updateTopic.mutate()} disabled={!canUpdateTopic || updateTopic.isPending}>{updateTopic.isPending ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingTopic)} onOpenChange={(nextOpen) => { if (!nextOpen) setDeletingTopic(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete monitored topic</DialogTitle>
            <DialogDescription>
              This removes “{deletingTopic?.title}” from monitored topics. Existing stored evidence may remain in the data store, but this topic will no longer appear in the list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletingTopic(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTopic.mutate()} disabled={deleteTopic.isPending}>{deleteTopic.isPending ? "Deleting…" : "Delete topic"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="monitored" className="space-y-4">
        <TabsList>
          <TabsTrigger value="monitored">Monitored Topics</TabsTrigger>
          <TabsTrigger value="trending">Trending Topics</TabsTrigger>
        </TabsList>

        <TabsContent value="monitored" className="mt-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Monitored Topics</CardTitle>
              <Badge variant="outline">{topics.length} total</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden border-y border-border bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.35fr)_150px_minmax(0,1fr)_130px_140px]">
                <span>Topic / Description</span><span>Sources</span><span>Keywords</span><span className="text-right">Updated</span><span className="text-right">Actions</span>
              </div>
              {topics.map((topic) => <TopicRow key={topic.id} topic={topic} onEdit={startEditTopic} onDelete={setDeletingTopic} />)}
              {topics.length === 0 && <div className="p-12 text-center text-muted-foreground">No topics yet. Create one to start monitoring.</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trending" className="mt-0 space-y-4">
          <Card>
            <CardHeader className="gap-4 space-y-0 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Trending Topics</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Cached discovery grouped by platform. External APIs only run when Refresh is clicked.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {trendSnapshot?.generatedAt && (
                  <Badge variant="outline" className="gap-1"><CalendarClock className="h-3 w-3" /> {formatDateTime(trendSnapshot.generatedAt)}</Badge>
                )}
                <Button onClick={() => refreshTrends.mutate()} disabled={refreshTrends.isPending}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshTrends.isPending ? "animate-spin" : ""}`} />
                  {refreshTrends.isPending ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={selectedPlatforms.length === trendPlatforms.length ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedPlatforms(trendPlatforms)}
                >
                  All platforms
                </Button>
                {trendPlatforms.map((platform) => {
                  const meta = platformMeta[platform];
                  const selected = selectedPlatforms.includes(platform);
                  return (
                    <Button
                      key={platform}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      onClick={() => togglePlatform(platform)}
                      className="gap-2"
                      style={selected ? { borderColor: meta?.color, backgroundColor: meta?.color, color: "white" } : { borderColor: meta?.color, color: meta?.color }}
                    >
                      <PlatformMark platform={platform} />
                      {platformLabel(platform)}
                    </Button>
                  );
                })}
              </div>
              {trendSnapshot?.errors?.length ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <div className="mb-2 flex items-center gap-2 font-medium text-foreground"><AlertCircle className="h-4 w-4" /> Refresh notes</div>
                  <div className="space-y-1">
                    {trendSnapshot.errors.slice(0, 5).map((error) => <p key={`${error.platform}-${error.message}`}>{platformLabel(error.platform)}: {error.message}</p>)}
                  </div>
                </div>
              ) : null}
              {!trendSnapshot && (
                <div className="rounded-md border border-border p-8 text-center text-muted-foreground">
                  No cached trend snapshot yet. Click Refresh to discover current topics.
                </div>
              )}
            </CardContent>
          </Card>

          {trendSnapshot && visibleTrendPlatforms.length === 0 && (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Select at least one platform to show trends.</CardContent></Card>
          )}

          {visibleTrendPlatforms.map((platform) => {
            const rows = trendSnapshot?.trendsByPlatform?.[platform] ?? [];
            const meta = platformMeta[platform];
            const collapsed = collapsedPlatforms.includes(platform);
            return (
              <Card key={platform} className="overflow-hidden p-0" style={{ borderColor: meta?.color }}>
                <button
                  type="button"
                  onClick={() => togglePlatformCollapse(platform)}
                  className="m-0 flex min-h-16 w-full items-center justify-between gap-4 rounded-t-lg px-6 py-4 text-left transition-colors"
                  style={{ backgroundColor: meta?.bg, borderLeft: `4px solid ${meta?.color ?? "currentColor"}` }}
                  aria-expanded={!collapsed}
                >
                  <CardTitle className="text-base flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-background shadow-sm" style={{ border: `1px solid ${meta?.color ?? "currentColor"}` }}>
                      <PlatformMark platform={platform} />
                    </span>
                    {platformLabel(platform)}
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="bg-background/70">{rows.length}/10</Badge>
                    {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
                {!collapsed && (
                  <CardContent className="p-0">
                    <div className="hidden border-y border-border bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.2fr)_120px_120px_120px]">
                      <span>Trend</span><span>Mentions</span><span>Sources</span><span className="text-right">Latest</span>
                    </div>
                    {rows.map((trend) => <TrendRow key={trend.id} trend={trend} onOpen={(item) => monitorTrend.mutate(item)} disabled={monitorTrend.isPending} />)}
                    {rows.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No cached trends for this platform yet.</div>}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
