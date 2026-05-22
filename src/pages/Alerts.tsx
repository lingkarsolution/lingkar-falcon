import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/ui/badges";
import { Badge } from "@/components/ui/badge";
import { api, type AlertEvent } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

interface AlertRule { id: string; name: string; type: string; enabled: boolean; severity: string }

export default function Alerts() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: qk.alertRules, queryFn: () => api.get<AlertRule[]>("/alerts/rules") });
  const events = useQuery({ queryKey: qk.alertEvents, queryFn: () => api.get<AlertEvent[]>("/alerts/events"), refetchInterval: 10_000 });
  const evaluate = useMutation({
    mutationFn: () => api.post("/alerts/evaluate"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alertEvents }),
  });
  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/events/${id}/ack`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alertEvents }),
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-muted-foreground mt-1">Rules and recent alert events.</p>
        </div>
        <Button onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>Re-evaluate now</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Active rules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(rules.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No rules configured yet.</p>}
          {(rules.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
              <div>
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.type}</p>
              </div>
              <div className="flex items-center gap-2">
                <SeverityBadge severity={r.severity} />
                <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "enabled" : "disabled"}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Events</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(events.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No alerts triggered.</p>}
          {(events.data ?? []).map((e) => (
            <div key={e.id} className="flex items-start justify-between border-b border-border pb-2 last:border-b-0">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{e.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{e.description}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{new Date(e.triggeredAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <SeverityBadge severity={e.severity} />
                {e.status === "new" && <Button size="sm" variant="outline" onClick={() => ack.mutate(e.id)}>Ack</Button>}
                {e.status !== "new" && <Badge variant="secondary">{e.status}</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
