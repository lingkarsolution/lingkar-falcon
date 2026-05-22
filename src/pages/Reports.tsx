import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type Report } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function Reports() {
  const { data = [] } = useQuery({ queryKey: qk.reports, queryFn: () => api.get<Report[]>("/reports") });
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">Generated topic reports. Open a topic to generate a new one.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-5 space-y-2">
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold leading-tight">{r.title}</p>
                <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</p>
              {r.fileUrl && r.status === "completed" && (
                <a href={r.fileUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Open report ↗</a>
              )}
            </CardContent>
          </Card>
        ))}
        {data.length === 0 && <Card><CardContent className="p-12 text-center text-muted-foreground">No reports yet.</CardContent></Card>}
      </div>
    </div>
  );
}
