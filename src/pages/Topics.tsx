import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Newspaper, Plus, Search } from "lucide-react";
import { api, type IndonesianNewsSearchResult, type Topic } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function Topics() {
  const qc = useQueryClient();
  const { data: topics = [] } = useQuery({ queryKey: qk.topics, queryFn: () => api.get<Topic[]>("/topics") });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [historyDays, setHistoryDays] = useState("30");
  const [includeTrendingNews, setIncludeTrendingNews] = useState(true);
  const [trendingQuery, setTrendingQuery] = useState("");
  const [previewQuery, setPreviewQuery] = useState("");

  const keywordList = useMemo(() => keywords.split(",").map((k) => k.trim()).filter(Boolean), [keywords]);
  const discoveryQuery = (trendingQuery.trim() || keywordList.join(" ") || title.trim()).trim();
  const trendingPreview = useQuery({
    queryKey: ["topic-trending-news", previewQuery],
    queryFn: () => api.get<IndonesianNewsSearchResult>(`/topics/trending-news?query=${encodeURIComponent(previewQuery)}&maxResults=6`),
    enabled: open && includeTrendingNews && previewQuery.length > 1,
  });

  const create = useMutation({
    mutationFn: () => api.post<Topic>("/topics", {
      title, description,
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

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Topics</h1>
          <p className="text-muted-foreground mt-1">What conversations should CivicFalcon monitor?</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New Topic</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader><DialogTitle>Create topic</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
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
              <Button onClick={() => create.mutate()} disabled={!title || !keywords || create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {topics.map((t) => (
          <Link key={t.id} to={`/topics/${t.id}`}>
            <Card className="h-full hover:border-primary transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t.title}</CardTitle>
                  <Badge variant={t.status === "active" ? "default" : "secondary"} className="capitalize">{t.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">{t.description ?? "No description"}</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {t.keywords.slice(0, 6).map((k) => (
                    <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {topics.length === 0 && <Card><CardContent className="p-12 text-center text-muted-foreground">No topics yet. Create one to start monitoring.</CardContent></Card>}
      </div>
    </div>
  );
}
