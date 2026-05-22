import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { api, type Topic } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function Topics() {
  const qc = useQueryClient();
  const { data: topics = [] } = useQuery({ queryKey: qk.topics, queryFn: () => api.get<Topic[]>("/topics") });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");

  const create = useMutation({
    mutationFn: () => api.post<Topic>("/topics", {
      title, description,
      keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.topics });
      setOpen(false); setTitle(""); setDescription(""); setKeywords("");
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
          <DialogContent>
            <DialogHeader><DialogTitle>Create topic</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="space-y-2"><Label>Keywords (comma-separated)</Label><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="economy, inflation, jobs" /></div>
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
