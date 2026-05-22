import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Tool { name: string; description: string; requiresRole: string | null }

export default function Settings() {
  const { user, tenant } = useAuth();
  const { data: tools = [] } = useQuery({ queryKey: ["commander-tools"], queryFn: () => api.get<Tool[]>("/commander/tools") });
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Account, tenant, and Commander capability surface.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{user?.name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{user?.email}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Role</span><Badge variant="outline" className="capitalize">{user?.role}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Tenant</span><span>{tenant?.name} ({tenant?.slug})</span></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Commander AI capabilities</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {tools.map((t) => (
            <div key={t.name} className="flex items-start justify-between border-b border-border pb-2 last:border-b-0">
              <div className="min-w-0">
                <p className="text-sm font-mono">{t.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
              </div>
              {t.requiresRole && <Badge variant="outline" className="capitalize ml-2">{t.requiresRole}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
