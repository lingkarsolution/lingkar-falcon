import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type AuditLog } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function Audit() {
  const { data = [] } = useQuery({ queryKey: qk.audit, queryFn: () => api.get<AuditLog[]>("/audit") });
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="text-muted-foreground mt-1">All write-side actions recorded for compliance.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">When</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Action</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">Entity</th>
                <th className="px-4 py-3 font-medium text-xs uppercase tracking-wide">User</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge variant="outline" className="font-mono text-[11px]">{a.action}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{a.entityType ?? "—"}{a.entityId ? ` · ${a.entityId.slice(0, 10)}…` : ""}</td>
                  <td className="px-4 py-2 font-mono text-xs">{a.actorUserId?.slice(0, 12) ?? "—"}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No audit events yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
