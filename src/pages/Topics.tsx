import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Topic } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { topicSubjectFromTopic, topicSubjectMeta } from "@/lib/topicSubjects";

function TopicRow({ topic, onEdit, onDelete }: { topic: Topic; onEdit: (topic: Topic) => void; onDelete: (topic: Topic) => void }) {
  const subjectType = topicSubjectFromTopic(topic);
  const subjectMeta = topicSubjectMeta[subjectType];
  const SubjectIcon = subjectMeta.icon;
  return (
    <div className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.35fr)_150px_minmax(0,1fr)_130px_140px] md:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground" title={subjectMeta.label} aria-label={subjectMeta.label}>
            <SubjectIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link to={`/topics/${topic.id}`} className="min-w-0 font-medium hover:underline">
                <span className="block truncate">{topic.title}</span>
              </Link>
              <Badge variant="outline" className="hidden rounded-md text-[10px] sm:inline-flex">{subjectMeta.label}</Badge>
              <Badge variant={topic.status === "active" ? "default" : "secondary"} className="capitalize">{topic.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">{topic.description?.trim() || "No description"}</p>
          </div>
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

export default function Topics() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: topics = [] } = useQuery({ queryKey: qk.topics, queryFn: () => api.get<Topic[]>("/topics") });
  const [deletingTopic, setDeletingTopic] = useState<Topic | null>(null);

  const startEditTopic = (topic: Topic) => navigate(`/topics/form/${topic.id}`);

  const deleteTopic = useMutation({
    mutationFn: () => api.delete<{ deleted: string }>(`/topics/${deletingTopic!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.topics });
      setDeletingTopic(null);
    },
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Topics</h1>
          <p className="text-muted-foreground mt-1">Monitor known conversations and manage tracked topics.</p>
        </div>
        <Button asChild><Link to="/topics/form"><Plus className="h-4 w-4 mr-2" /> New Topic</Link></Button>
      </div>

      <Dialog open={Boolean(deletingTopic)} onOpenChange={(nextOpen) => { if (!nextOpen) setDeletingTopic(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete monitored topic</DialogTitle>
            <DialogDescription>
              This removes “{deletingTopic?.title}” from monitored topics. Existing collected posts may remain in the data store, but this topic will no longer appear in the list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletingTopic(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTopic.mutate()} disabled={deleteTopic.isPending}>{deleteTopic.isPending ? "Deleting…" : "Delete topic"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
