import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/ui/badges";
import { Plus, RefreshCw } from "lucide-react";
import { api, type Actor } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const PLATFORMS = ["x", "facebook", "instagram", "tiktok", "youtube", "reddit", "rss", "web"];

export default function Actors() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: qk.actors, queryFn: () => api.get<Actor[]>("/actors") });
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState("x");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () => api.post<Actor>("/actors", { platform, username, displayName, monitoringReason: reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.actors }); setOpen(false); setUsername(""); setDisplayName(""); setReason(""); },
  });
  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/actors/${id}/refresh`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.actors }),
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Actors</h1>
          <p className="text-muted-foreground mt-1">Tracked individuals / accounts with risk &amp; opportunity scoring.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Add actor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Track an actor</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Username / handle</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
              <div className="space-y-2"><Label>Display name</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
              <div className="space-y-2"><Label>Monitoring reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!username || create.isPending}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{a.displayName}</CardTitle>
                  <p className="text-xs text-muted-foreground">@{a.username} · {a.platform}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => refresh.mutate(a.id)} title="Refresh scores"><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Risk</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-semibold">{a.riskScore ?? "—"}</span>
                  {a.riskLevel && <SeverityBadge severity={a.riskLevel} />}
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Opportunity</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-semibold">{a.opportunityScore ?? "—"}</span>
                  {a.opportunityLevel && <Badge variant="outline" className="capitalize">{a.opportunityLevel}</Badge>}
                </div>
              </div>
              {a.riskExplanation && <p className="text-xs text-muted-foreground italic line-clamp-2">{a.riskExplanation}</p>}
            </CardContent>
          </Card>
        ))}
        {data.length === 0 && <Card><CardContent className="p-12 text-center text-muted-foreground">No actors tracked yet.</CardContent></Card>}
      </div>
    </div>
  );
}
