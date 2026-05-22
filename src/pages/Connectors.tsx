import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ConnectorStatusBadge } from "@/components/ui/badges";
import { Badge } from "@/components/ui/badge";
import { api, type Connector } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface ProviderStatus { name: string; ready: boolean; mode: string }

export default function Connectors() {
  const qc = useQueryClient();
  const { data: connectors = [] } = useQuery({ queryKey: qk.connectors, queryFn: () => api.get<Connector[]>("/connectors") });
  const { data: webStatus } = useQuery({ queryKey: qk.webSearchStatus, queryFn: () => api.get<{ providers: ProviderStatus[] }>("/connectors/web-search-status") });

  const test = useMutation({
    mutationFn: (id: string) => api.post(`/connectors/${id}/test`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connectors }),
  });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Connectors</h1>
        <p className="text-muted-foreground mt-1">Data source integrations — OSINT-first, paid APIs only where needed.</p>
      </div>

      {webStatus && (
        <Card>
          <CardHeader><CardTitle className="text-base">Web search providers</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {webStatus.providers.map((p) => (
                <Badge key={p.name} variant={p.ready ? "default" : "secondary"} className="gap-1">
                  {p.ready ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {p.name} <span className="text-[10px] opacity-70">({p.mode})</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {connectors.map((c) => {
          const budget = c.monthlyBudgetUsd ?? 0;
          const spend = c.currentMonthSpendUsd ?? 0;
          const pct = budget > 0 ? Math.min(100, (spend / budget) * 100) : 0;
          const title = c.name ?? c.displayName ?? c.platform;
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{title}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1 font-mono uppercase">{c.platform}</p>
                  </div>
                  <ConnectorStatusBadge status={c.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="capitalize">{c.mode.replace("_", " ")}</Badge>
                  {c.credentialConfigured ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Credentials set</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">No credentials</Badge>
                  )}
                </div>
                {budget > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Monthly budget</span>
                      <span className="tabular-nums">${spend.toFixed(2)} / ${budget.toFixed(2)}</span>
                    </div>
                    <Progress value={pct} />
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{c.currentMonthRequests ?? 0} requests this month</span>
                </div>
                {c.lastHealthMessage && <p className="text-xs text-muted-foreground italic line-clamp-2">{c.lastHealthMessage}</p>}
                <Button size="sm" variant="outline" className="w-full" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                  Test connection
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
