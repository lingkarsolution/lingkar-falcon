import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarClock, Check, ClipboardList, Database, ExternalLink, Globe2, ImageIcon, Loader2, Play, Plus, RefreshCw, Rows3, Save, Search, ShieldCheck, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, type Connector, type IngestionJob, type IngestionJobDetail, type IngestionProgress, type Topic } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

type StepId = "topic" | "sources" | "focus" | "rules" | "review" | "progress" | "refresh";
type CostMode = "free_only" | "balanced" | "manual_paid";
type MediaMode = "skip" | "metadata" | "store";
type SourceGroupId = "social" | "others";

type Draft = {
  topicId: string;
  runName: string;
  platforms: string[];
  searchFocus: string;
  includeKeywords: string[];
  exactPhrases: string[];
  hashtags: string[];
  handles: string[];
  excludeKeywords: string[];
  languages: string[];
  regions: string[];
  datePreset: "24h" | "7d" | "30d" | "custom";
  dateFrom: string;
  dateTo: string;
  maxItemsPerPlatform: string;
  costMode: CostMode;
  aiReviewEnabled: boolean;
  mediaMode: MediaMode;
};

const steps: Array<{ id: StepId; title: string; icon: LucideIcon }> = [
  { id: "topic", title: "Topic", icon: ClipboardList },
  { id: "sources", title: "Sources", icon: Globe2 },
  { id: "focus", title: "Focus", icon: Search },
  { id: "rules", title: "Rules", icon: SlidersHorizontal },
  { id: "review", title: "Review", icon: ShieldCheck },
  { id: "progress", title: "Progress", icon: Rows3 },
];
const refreshSteps: Array<{ id: StepId; title: string; icon: LucideIcon }> = [
  { id: "refresh", title: "Refresh", icon: RefreshCw },
  { id: "progress", title: "Progress", icon: Rows3 },
];
const progressStepIndex = steps.findIndex((step) => step.id === "progress");

const sourceGroups: Array<{ id: SourceGroupId; label: string; helper: string }> = [
  { id: "social", label: "Social Media", helper: "Conversation platforms, public posts, comments, and creator content." },
  { id: "others", label: "Others", helper: "Open web search, news/event feeds, RSS sources, and configured watchlists." },
];

const sourceOptions: Array<{ value: string; label: string; helper: string; group: SourceGroupId }> = [
  { value: "x", label: "X / Twitter", helper: "Posts, reposts, and public discussion.", group: "social" },
  { value: "threads", label: "Threads", helper: "Public Threads conversations.", group: "social" },
  { value: "tiktok", label: "TikTok", helper: "Short-form video posts and captions.", group: "social" },
  { value: "instagram", label: "Instagram", helper: "Public posts and profile mentions where configured.", group: "social" },
  { value: "youtube", label: "YouTube", helper: "Videos, metadata, descriptions, and comments when available.", group: "social" },
  { value: "facebook", label: "Facebook", helper: "Public pages and posts where configured.", group: "social" },
  { value: "reddit", label: "Reddit", helper: "Subreddit posts and comment discussions.", group: "social" },
  { value: "web", label: "Web search", helper: "General public pages and search results.", group: "others" },
  { value: "gdelt", label: "News", helper: "Open news signals and public event feeds.", group: "others" },
  { value: "rss", label: "RSS", helper: "Configured feeds and site updates.", group: "others" },
];
const allSourceValues = sourceOptions.map((source) => source.value);

const languageOptions = ["Indonesian", "English", "Javanese", "Sundanese", "Malay", "Mixed language"];
const regionOptions = ["Indonesia", "DKI Jakarta", "West Java", "Central Java", "East Java", "Bali", "North Sumatra", "South Sulawesi"];

const costModeOptions: Array<{ value: CostMode; label: string; helper: string }> = [
  { value: "free_only", label: "Open sources only", helper: "Use cached, open, or no-cost sources only." },
  { value: "balanced", label: "Balanced", helper: "Use configured sources only when needed for coverage." },
  { value: "manual_paid", label: "Ask before expanded collection", helper: "Prepare the run, but require approval before any expanded collection." },
];

const mediaModeOptions: Array<{ value: MediaMode; label: string; helper: string }> = [
  { value: "skip", label: "Skip media", helper: "Store text and source metadata only." },
  { value: "metadata", label: "Use metadata", helper: "Use captions, transcripts, thumbnails, and sample frames." },
  { value: "store", label: "Store and analyze", helper: "Store images/video from posts and prepare them for analysis." },
];

const initialDraft: Draft = {
  topicId: "",
  runName: "",
  platforms: ["web", "gdelt", "tiktok", "youtube", "threads"],
  searchFocus: "",
  includeKeywords: [],
  exactPhrases: [],
  hashtags: [],
  handles: [],
  excludeKeywords: [],
  languages: ["Indonesian", "English"],
  regions: ["Indonesia"],
  datePreset: "30d",
  dateFrom: "",
  dateTo: "",
  maxItemsPerPlatform: "50",
  costMode: "balanced",
  aiReviewEnabled: true,
  mediaMode: "metadata",
};

const cleanList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
};

const normalizeTagValue = (rawValue: string, prefix?: string): string => {
  const trimmed = rawValue.trim();
  if (!prefix) return trimmed;
  const withoutPrefix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
  return withoutPrefix ? `${prefix}${withoutPrefix}` : "";
};

const addTags = (current: string[], rawValue: string, prefix?: string): string[] => {
  const next = rawValue.split(",").map((item) => normalizeTagValue(item, prefix)).filter(Boolean);
  return cleanList([...current, ...next]);
};

const topicTitle = (topic?: Topic | null) => topic?.title ?? "No topic selected";

const stringValue = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const stringArrayValue = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
const dateInputValue = (value: unknown): string => {
  const text = stringValue(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
const costModeValue = (value: unknown, fallback: CostMode): CostMode => value === "free_only" || value === "balanced" || value === "manual_paid" ? value : fallback;
const mediaModeValue = (value: unknown, fallback: MediaMode): MediaMode => value === "skip" || value === "metadata" || value === "store" ? value : fallback;

function FieldShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TagEditor({ label, value, onChange, placeholder, prefix, disabled }: { label: string; value: string[]; onChange: (value: string[]) => void; placeholder: string; prefix?: string; disabled?: boolean }) {
  const [entry, setEntry] = useState("");
  const add = () => {
    if (!entry.trim()) return;
    onChange(addTags(value, entry, prefix));
    setEntry("");
  };
  return (
    <FieldShell label={label}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">{prefix}</span>}
          <Input
            className={prefix ? "pl-8" : undefined}
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
          />
        </div>
        <Button type="button" variant="outline" onClick={add} disabled={disabled}><Plus className="h-4 w-4" /> Add</Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 rounded-md px-2 py-1 text-xs">
              {item}
              <button type="button" disabled={disabled} className="rounded-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => onChange(value.filter((current) => current !== item))} aria-label={`Remove ${item}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </FieldShell>
  );
}

function CheckboxGrid({ options, value, onChange, disabled }: { options: string[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const toggle = (option: string, checked: boolean) => onChange(checked ? cleanList([...value, option]) : value.filter((item) => item !== option));
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {options.map((option) => (
        <label key={option} className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted/40">
          <Checkbox checked={value.includes(option)} disabled={disabled} onCheckedChange={(checked) => toggle(option, checked === true)} />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function ChoiceGrid<T extends string>({ value, options, onChange, disabled }: { value: T; options: Array<{ value: T; label: string; helper: string }>; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn("min-h-24 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70", active ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40")}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {active && <Check className="h-4 w-4 text-primary" />}
              {option.label}
            </span>
            <span className="mt-2 block text-xs leading-5 text-muted-foreground">{option.helper}</span>
          </button>
        );
      })}
    </div>
  );
}

function SourceGrid({ value, onChange, connectors, disabled }: { value: string[]; onChange: (value: string[]) => void; connectors: Connector[]; disabled?: boolean }) {
  const connectorByPlatform = new Map(connectors.map((connector) => [connector.platform, connector]));
  const toggle = (platform: string, checked: boolean) => onChange(checked ? cleanList([...value, platform]) : value.filter((item) => item !== platform));
  const selectGroup = (platforms: string[]) => onChange(cleanList([...value, ...platforms]));
  const clearGroup = (platforms: string[]) => onChange(value.filter((item) => !platforms.includes(item)));
  return (
    <div className="space-y-6">
      {sourceGroups.map((group) => {
        const groupSources = sourceOptions.filter((source) => source.group === group.id);
        const selectedCount = groupSources.filter((source) => value.includes(source.value)).length;
        return (
          <section key={group.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{group.label}</p>
                  <Badge variant={selectedCount > 0 ? "default" : "outline"} className="rounded-md">{selectedCount}/{groupSources.length}</Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.helper}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => selectGroup(groupSources.map((source) => source.value))}>Select group</Button>
                {selectedCount > 0 && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => clearGroup(groupSources.map((source) => source.value))}>Clear</Button>}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groupSources.map((source) => {
                const connector = connectorByPlatform.get(source.value);
                const selected = value.includes(source.value);
                const status = connector?.status ?? "not_configured";
                return (
                  <label key={source.value} className={cn("flex min-h-32 cursor-pointer gap-3 rounded-lg border bg-card p-4 transition-colors", selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}>
                    <Checkbox checked={selected} disabled={disabled} onCheckedChange={(checked) => toggle(source.value, checked === true)} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{source.label}</span>
                        <Badge variant={status === "active" ? "default" : status === "limited" ? "secondary" : "outline"} className="rounded-md capitalize">{status.replace(/_/g, " ")}</Badge>
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-muted-foreground">{source.helper}</span>
                      {connector && <span className="mt-3 block text-xs text-muted-foreground">{connector.status === "active" ? "Ready for collection" : "Setup may be required"}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      {items.length > 0 ? <div className="flex flex-wrap gap-1.5">{items.map((item) => <Badge key={item} variant="outline" className="rounded-md">{item}</Badge>)}</div> : <p className="text-sm text-muted-foreground">None selected</p>}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[170px_1fr]">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

const progressOf = (job?: IngestionJob | null): IngestionProgress | null => {
  const value = job?.metadata?.ingestionProgress;
  return value && typeof value === "object" ? value as IngestionProgress : null;
};

const progressPercent = (progress: IngestionProgress | null, job?: IngestionJob | null) => {
  if (!progress) return job?.status === "completed" ? 100 : job?.status === "failed" ? 100 : 8;
  if (progress.stage === "completed") return 100;
  if (progress.stage === "failed") return 100;
  const retrievalPart = progress.retrievedLimit > 0 ? Math.min(40, (progress.retrievedCount / progress.retrievedLimit) * 40) : 0;
  const processingTarget = Math.max(progress.maxItemsPerSource, progress.processedCount, 1);
  const processingPart = Math.min(45, (progress.processedCount / processingTarget) * 45);
  const enrichPart = progress.stage === "enriching" ? 10 : progress.storedCount > 0 ? 5 : 0;
  return Math.max(8, Math.min(98, Math.round(retrievalPart + processingPart + enrichPart)));
};

const formatProgressStage = (stage?: string) => (stage ?? "queued").replace(/_/g, " ");

function LlmStreamPanel({ progress, detail }: { progress: IngestionProgress | null; detail: IngestionJobDetail | null }) {
  const stream = progress?.llmStream;
  const storedError = typeof detail?.job.metadata?.errorMessage === "string" ? detail.job.metadata.errorMessage : null;
  const errorText = [stream?.error, ...(detail?.errors ?? []).map((error) => error.message), storedError]
    .map((message) => message?.trim())
    .filter((message): message is string => Boolean(message));
  const displayStatus = stream?.status ?? (errorText.length > 0 || detail?.job.status === "failed" ? "failed" : "idle");
  const streaming = displayStatus === "streaming";
  const body = [stream?.text?.trim(), ...errorText].filter(Boolean).join("\n\n");
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">AI review stream</p>
          <p className="mt-1 text-xs text-muted-foreground">{stream?.title ?? (displayStatus === "failed" ? "Collection failed before review output" : "Waiting for review output")}</p>
        </div>
        <Badge variant={streaming ? "default" : displayStatus === "failed" ? "destructive" : "outline"} className="rounded-md capitalize">
          {streaming && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {displayStatus}
        </Badge>
      </div>
      {stream && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Batch {stream.batch || 1}/{stream.totalBatches || 1}</span>
          <span>{stream.candidates} candidates</span>
          <span>{new Date(stream.updatedAt).toLocaleTimeString()}</span>
        </div>
      )}
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground">
        {body || "No AI review output yet."}
      </pre>
    </div>
  );
}

export default function IngestionForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const topicIdFromQuery = searchParams.get("_tid")?.trim() ?? "";
  const jobIdFromQuery = searchParams.get("jobId")?.trim() || searchParams.get("_jid")?.trim() || "";
  const lockedToTopic = Boolean(topicIdFromQuery);
  const refreshMode = lockedToTopic;
  const wizardSteps = refreshMode ? refreshSteps : steps;
  const progressStepIndex = wizardSteps.findIndex((step) => step.id === "progress");
  const [activeIndex, setActiveIndex] = useState(() => jobIdFromQuery ? progressStepIndex : 0);
  const [draft, setDraft] = useState<Draft>(() => ({ ...initialDraft, topicId: topicIdFromQuery }));
  const [hydratedTopicId, setHydratedTopicId] = useState<string | null>(null);
  const [hydratedJobId, setHydratedJobId] = useState<string | null>(null);
  const [startedJobIds, setStartedJobIds] = useState<string[]>(() => jobIdFromQuery ? [jobIdFromQuery] : []);
  const [skippedSources, setSkippedSources] = useState<string[]>([]);
  const [selectedStreamJobId, setSelectedStreamJobId] = useState<string | null>(null);
  const isProgressStep = activeIndex === progressStepIndex;

  const topics = useQuery({ queryKey: qk.topics, queryFn: () => api.get<Topic[]>("/topics"), enabled: !lockedToTopic });
  const lockedTopic = useQuery({ queryKey: qk.topic(topicIdFromQuery), queryFn: () => api.get<Topic>(`/topics/${topicIdFromQuery}`), enabled: lockedToTopic });
  const connectors = useQuery({ queryKey: qk.connectors, queryFn: () => api.get<Connector[]>("/connectors") });
  const jobDetails = useQuery({
    queryKey: ["ingestion-wizard-job-details", startedJobIds],
    queryFn: () => Promise.all(startedJobIds.map((jobId) => api.get<IngestionJobDetail>(`/ingestion/jobs/${jobId}`))),
    enabled: startedJobIds.length > 0 && isProgressStep,
  });

  const selectedTopic = lockedToTopic ? lockedTopic.data : (topics.data ?? []).find((topic) => topic.id === draft.topicId);
  const connectorByPlatform = useMemo(() => new Map((connectors.data ?? []).map((connector) => [connector.platform, connector])), [connectors.data]);

  useEffect(() => {
    if (!jobIdFromQuery) return;
    setActiveIndex(progressStepIndex);
    setStartedJobIds((current) => current.length === 1 && current[0] === jobIdFromQuery ? current : [jobIdFromQuery]);
  }, [jobIdFromQuery]);

  useEffect(() => {
    if (isProgressStep) return;
    setSelectedStreamJobId(null);
  }, [isProgressStep]);

  useEffect(() => {
    if (!lockedToTopic || !lockedTopic.data || hydratedTopicId === lockedTopic.data.id) return;
    const topic = lockedTopic.data;
    setDraft((current) => ({
      ...current,
      topicId: topic.id,
      runName: current.runName || `${topic.title} post collection`,
      platforms: topic.platforms?.length ? cleanList(topic.platforms) : current.platforms,
      includeKeywords: current.includeKeywords.length ? current.includeKeywords : topic.keywords ?? [],
      excludeKeywords: current.excludeKeywords.length ? current.excludeKeywords : topic.excludeKeywords ?? [],
      languages: current.languages.length ? current.languages : topic.languages ?? current.languages,
      regions: current.regions.length ? current.regions : topic.regions ?? current.regions,
    }));
    setHydratedTopicId(topic.id);
  }, [hydratedTopicId, lockedToTopic, lockedTopic.data]);

  useEffect(() => {
    if (!jobIdFromQuery || hydratedJobId === jobIdFromQuery || !jobDetails.data?.length) return;
    const jobDetail = jobDetails.data.find((detail) => detail.job.id === jobIdFromQuery) ?? jobDetails.data[0];
    const metadata = jobDetail.job.metadata ?? {};
    const progressMeta = progressOf(jobDetail.job);
    const connector = (connectors.data ?? []).find((item) => item.id === jobDetail.job.connectorId);
    const platforms = progressMeta?.platform ? [progressMeta.platform] : connector?.platform ? [connector.platform] : jobDetail.items[0]?.platform ? [jobDetail.items[0].platform] : [];
    const daysValue = typeof metadata.days === "number" ? metadata.days : Number(metadata.days);
    const datePreset: Draft["datePreset"] = metadata.dateFrom || metadata.dateTo ? "custom" : daysValue <= 1 ? "24h" : daysValue <= 7 ? "7d" : "30d";

    setDraft((current) => ({
      ...current,
      topicId: jobDetail.job.topicId,
      runName: stringValue(metadata.runName) ?? current.runName,
      platforms: platforms.length ? cleanList(platforms) : current.platforms,
      searchFocus: stringValue(metadata.searchFocus) ?? current.searchFocus,
      includeKeywords: stringArrayValue(metadata.includeKeywords).length ? stringArrayValue(metadata.includeKeywords) : current.includeKeywords,
      exactPhrases: stringArrayValue(metadata.exactPhrases).length ? stringArrayValue(metadata.exactPhrases) : current.exactPhrases,
      hashtags: stringArrayValue(metadata.hashtags).length ? stringArrayValue(metadata.hashtags) : current.hashtags,
      handles: stringArrayValue(metadata.handles).length ? stringArrayValue(metadata.handles) : current.handles,
      excludeKeywords: stringArrayValue(metadata.excludeKeywords).length ? stringArrayValue(metadata.excludeKeywords) : current.excludeKeywords,
      languages: stringArrayValue(metadata.languages).length ? stringArrayValue(metadata.languages) : current.languages,
      regions: stringArrayValue(metadata.regions).length ? stringArrayValue(metadata.regions) : current.regions,
      datePreset,
      dateFrom: dateInputValue(metadata.dateFrom) || current.dateFrom,
      dateTo: dateInputValue(metadata.dateTo) || current.dateTo,
      maxItemsPerPlatform: String(progressMeta?.maxItemsPerSource ?? metadata.maxItems ?? current.maxItemsPerPlatform),
      costMode: costModeValue(metadata.costMode, current.costMode),
      mediaMode: mediaModeValue(metadata.mediaMode, current.mediaMode),
    }));
    setHydratedJobId(jobIdFromQuery);
  }, [connectors.data, hydratedJobId, jobDetails.data, jobIdFromQuery]);

  const activeStep = wizardSteps[activeIndex];
  const ActiveIcon = activeStep.icon;
  const progress = ((activeIndex + 1) / wizardSteps.length) * 100;
  const maxItems = Math.max(1, Number(draft.maxItemsPerPlatform) || 50);
  const canFinish = Boolean(draft.topicId) && draft.platforms.length > 0 && maxItems > 0;
  const returnPath = lockedToTopic ? `/topics/${topicIdFromQuery}` : "/ingestion";
  const selectedPlatformLabels = draft.platforms.map((platform) => sourceOptions.find((source) => source.value === platform)?.label ?? platform);
  const allSourcesSelected = allSourceValues.every((source) => draft.platforms.includes(source));

  const updateDraft = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const next = () => setActiveIndex((current) => Math.min(wizardSteps.length - 1, current + 1));
  const previous = () => setActiveIndex((current) => Math.max(0, current - 1));
  const days = draft.datePreset === "24h" ? 1 : draft.datePreset === "7d" ? 7 : 30;

  const startIngestion = useMutation({
    mutationFn: async () => {
      const availableConnectors = draft.platforms.map((platform) => connectorByPlatform.get(platform)).filter((connector): connector is Connector => Boolean(connector));
      const missing = draft.platforms.filter((platform) => !connectorByPlatform.has(platform));
      if (availableConnectors.length === 0) throw new Error("No available sources were found for the selected choices.");
      const jobs: IngestionJob[] = [];
      for (const connector of availableConnectors) {
        const job = await api.post<IngestionJob>("/ingestion/trigger", {
          topicId: draft.topicId,
          connectorId: connector.id,
          maxItems,
          days,
          ...(draft.datePreset === "custom" && draft.dateFrom ? { dateFrom: new Date(draft.dateFrom).toISOString() } : {}),
          ...(draft.datePreset === "custom" && draft.dateTo ? { dateTo: new Date(draft.dateTo).toISOString() } : {}),
          metadata: {
            runName: draft.runName,
            searchFocus: draft.searchFocus,
            includeKeywords: draft.includeKeywords,
            exactPhrases: draft.exactPhrases,
            hashtags: draft.hashtags,
            handles: draft.handles,
            excludeKeywords: draft.excludeKeywords,
            languages: draft.languages,
            regions: draft.regions,
            mediaMode: draft.mediaMode,
            costMode: draft.costMode,
          },
        });
        jobs.push(job);
      }
      return { jobs, missing };
    },
    onSuccess: ({ jobs, missing }) => {
      setStartedJobIds(jobs.map((job) => job.id));
      setSkippedSources(missing);
      setActiveIndex(progressStepIndex);
    },
  });

  const ingestionStarted = startedJobIds.length > 0 || startIngestion.isPending;
  const progressDetails = jobDetails.data ?? [];
  const selectedStreamDetail = progressDetails.find((detail) => detail.job.id === selectedStreamJobId) ?? null;
  const selectedStreamProgress = progressOf(selectedStreamDetail?.job ?? null);
  const progressItems = progressDetails.flatMap((detail) => detail.items.map((item) => ({ ...item, jobId: detail.job.id })));
  const finish = () => startIngestion.mutate();

  if (lockedToTopic && lockedTopic.isLoading) {
    return <div className="p-8 text-muted-foreground">Loading post collection...</div>;
  }

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
      <div className="flex w-full flex-col gap-6">
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="ghost" size="sm" className="px-2">
                  <Link to={returnPath}><ArrowLeft className="h-4 w-4" /> {lockedToTopic ? "Topic" : "Collection jobs"}</Link>
                </Button>
                <Badge variant="outline" className="rounded-md">Post collection</Badge>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{refreshMode ? "Refresh data" : "Collect posts"}</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{refreshMode ? "Pull a fresh batch of posts and signals for this topic using its existing keywords, regions, and languages." : "Prepare a focused post collection run across multiple sources, with query refinements, safety settings, and review rules."}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:min-w-56">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{activeIndex + 1}/{wizardSteps.length}</span>
                </div>
                <Progress value={progress} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
          <Card className="h-fit xl:sticky xl:top-6">
            <CardContent className="p-3">
              <div className="space-y-1">
                {wizardSteps.map((step, index) => {
                  const Icon = step.icon;
                  const active = index === activeIndex;
                  const complete = index < activeIndex;
                  const progressGated = step.id === "progress" && startedJobIds.length === 0 && !startIngestion.isPending;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={progressGated}
                      onClick={() => { if (!progressGated) setActiveIndex(index); }}
                      className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors", active ? "bg-primary text-primary-foreground" : "hover:bg-muted", progressGated && "cursor-not-allowed opacity-50 hover:bg-transparent")}
                    >
                      <span className={cn("flex h-8 w-8 items-center justify-center rounded-md border", active ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background")}>
                        {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">{step.title}</span>
                        <span className={cn("block text-xs", active ? "text-primary-foreground/70" : "text-muted-foreground")}>Step {index + 1}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base"><ActiveIcon className="h-4 w-4" /> {activeStep.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 p-5">
              {activeStep.id === "topic" && (
                <div className="space-y-5">
                  {lockedToTopic ? (
                    <div className="rounded-lg border border-border bg-muted/20 p-4">
                      <p className="text-xs text-muted-foreground">Selected topic</p>
                      <p className="mt-1 text-lg font-semibold">{topicTitle(selectedTopic)}</p>
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{selectedTopic?.description ?? "No description"}</p>
                    </div>
                  ) : (
                    <FieldShell label="Topic">
                      <Select value={draft.topicId} disabled={ingestionStarted} onValueChange={(topicId) => updateDraft({ topicId })}>
                        <SelectTrigger><SelectValue placeholder="Choose a topic" /></SelectTrigger>
                        <SelectContent>
                          {(topics.data ?? []).map((topic) => <SelectItem key={topic.id} value={topic.id}>{topic.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FieldShell>
                  )}
                  <FieldShell label="Collection name">
                    <Input value={draft.runName} disabled={ingestionStarted} onChange={(event) => updateDraft({ runName: event.target.value })} placeholder="Example: Rupiah morning social scan" />
                  </FieldShell>
                </div>
              )}

              {activeStep.id === "sources" && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Sources to collect from</p>
                      <p className="mt-1 text-sm text-muted-foreground">Pick every platform this run should use.</p>
                    </div>
                    <Button type="button" variant="outline" disabled={ingestionStarted} onClick={() => updateDraft({ platforms: allSourcesSelected ? [] : allSourceValues })}>{allSourcesSelected ? "Unselect all" : "Select all"}</Button>
                  </div>
                  <SourceGrid value={draft.platforms} onChange={(platforms) => updateDraft({ platforms })} connectors={connectors.data ?? []} disabled={ingestionStarted} />
                </div>
              )}

              {activeStep.id === "focus" && (
                <div className="space-y-5">
                  <FieldShell label="Specific search focus">
                    <Textarea value={draft.searchFocus} disabled={ingestionStarted} onChange={(event) => updateDraft({ searchFocus: event.target.value })} className="min-h-28" placeholder="Example: Find posts about rupiah weakening after the BI rate decision, especially criticism of policy response." />
                  </FieldShell>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <TagEditor label="Extra keywords" value={draft.includeKeywords} onChange={(includeKeywords) => updateDraft({ includeKeywords })} placeholder="rupiah melemah, BI rate, dollar" disabled={ingestionStarted} />
                    <TagEditor label="Exact phrases" value={draft.exactPhrases} onChange={(exactPhrases) => updateDraft({ exactPhrases })} placeholder="nilai tukar rupiah" disabled={ingestionStarted} />
                    <TagEditor label="Hashtags" value={draft.hashtags} onChange={(hashtags) => updateDraft({ hashtags })} placeholder="Rupiah" prefix="#" disabled={ingestionStarted} />
                    <TagEditor label="Handles" value={draft.handles} onChange={(handles) => updateDraft({ handles })} placeholder="bank_indonesia" prefix="@" disabled={ingestionStarted} />
                    <TagEditor label="Exclude words" value={draft.excludeKeywords} onChange={(excludeKeywords) => updateDraft({ excludeKeywords })} placeholder="game, giveaway, unrelated brand" disabled={ingestionStarted} />
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <FieldShell label="Languages">
                      <CheckboxGrid options={languageOptions} value={draft.languages} onChange={(languages) => updateDraft({ languages })} disabled={ingestionStarted} />
                    </FieldShell>
                    <FieldShell label="Regions">
                      <CheckboxGrid options={regionOptions} value={draft.regions} onChange={(regions) => updateDraft({ regions })} disabled={ingestionStarted} />
                    </FieldShell>
                  </div>
                </div>
              )}

              {activeStep.id === "rules" && (
                <div className="space-y-6">
                  <div className="grid gap-5 lg:grid-cols-3">
                    <FieldShell label="Time range">
                      <Select value={draft.datePreset} disabled={ingestionStarted} onValueChange={(datePreset) => updateDraft({ datePreset: datePreset as Draft["datePreset"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24h">Last 24 hours</SelectItem>
                          <SelectItem value="7d">Last 7 days</SelectItem>
                          <SelectItem value="30d">Last 30 days</SelectItem>
                          <SelectItem value="custom">Custom range</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldShell>
                    <FieldShell label="Max items per source">
                      <Input type="number" min={1} max={250} value={draft.maxItemsPerPlatform} disabled={ingestionStarted} onChange={(event) => updateDraft({ maxItemsPerPlatform: event.target.value })} />
                    </FieldShell>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                      <p className="text-xs text-muted-foreground">Estimated maximum</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{maxItems * draft.platforms.length}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{draft.platforms.length} sources x {maxItems} items</p>
                    </div>
                  </div>
                  {draft.datePreset === "custom" && (
                    <div className="grid gap-5 lg:grid-cols-2">
                      <FieldShell label="From"><Input type="date" value={draft.dateFrom} disabled={ingestionStarted} onChange={(event) => updateDraft({ dateFrom: event.target.value })} /></FieldShell>
                      <FieldShell label="To"><Input type="date" value={draft.dateTo} disabled={ingestionStarted} onChange={(event) => updateDraft({ dateTo: event.target.value })} /></FieldShell>
                    </div>
                  )}
                  <FieldShell label="Cost mode"><ChoiceGrid value={draft.costMode} options={costModeOptions} onChange={(costMode) => updateDraft({ costMode })} disabled={ingestionStarted} /></FieldShell>
                  <details className="rounded-lg border border-border bg-card">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Advanced options</summary>
                    <div className="space-y-5 border-t border-border p-4">
                      <FieldShell label="Media handling"><ChoiceGrid value={draft.mediaMode} options={mediaModeOptions} onChange={(mediaMode) => updateDraft({ mediaMode })} disabled={ingestionStarted} /></FieldShell>
                      <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
                        <span>
                          <span className="block text-sm font-medium">AI pre-save review</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">Review relevance and sentiment before saving posts.</span>
                        </span>
                        <Switch checked={draft.aiReviewEnabled} disabled={ingestionStarted} onCheckedChange={(aiReviewEnabled) => updateDraft({ aiReviewEnabled })} />
                      </label>
                    </div>
                  </details>
                </div>
              )}

              {activeStep.id === "review" && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-border bg-muted/20 p-4">
                    <p className="text-sm font-semibold">Collection preview</p>
                    <div className="mt-3">
                      <ReviewRow label="Topic" value={topicTitle(selectedTopic)} />
                      <ReviewRow label="Collection name" value={draft.runName.trim() || "Untitled collection"} />
                      <ReviewRow label="Sources" value={`${selectedPlatformLabels.length} selected`} />
                      <ReviewRow label="Range" value={draft.datePreset === "custom" ? `${draft.dateFrom || "Any start"} to ${draft.dateTo || "Any end"}` : draft.datePreset} />
                      <ReviewRow label="Max posts" value={`${maxItems * draft.platforms.length} items`} />
                      <ReviewRow label="Cost mode" value={costModeOptions.find((option) => option.value === draft.costMode)?.label ?? draft.costMode} />
                      <ReviewRow label="AI review" value={draft.aiReviewEnabled ? "Enabled" : "Disabled"} />
                      <ReviewRow label="Media" value={mediaModeOptions.find((option) => option.value === draft.mediaMode)?.label ?? draft.mediaMode} />
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <SummaryList title="Sources" items={selectedPlatformLabels} />
                    <SummaryList title="Search refinements" items={[...draft.includeKeywords, ...draft.exactPhrases, ...draft.hashtags, ...draft.handles]} />
                    <SummaryList title="Excluded noise" items={draft.excludeKeywords} />
                    <SummaryList title="Regions" items={draft.regions} />
                  </div>
                </div>
              )}

              {activeStep.id === "refresh" && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-border bg-muted/20 p-4">
                    <p className="text-xs text-muted-foreground">Topic</p>
                    <p className="mt-1 text-lg font-semibold">{topicTitle(selectedTopic)}</p>
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{selectedTopic?.description ?? "No description"}</p>
                    <p className="mt-3 text-xs text-muted-foreground">Refresh uses this topic's existing keywords, regions, and languages. Edit the topic to change them.</p>
                  </div>
                  <FieldShell label="Sources to refresh">
                    <SourceGrid value={draft.platforms} onChange={(platforms) => updateDraft({ platforms })} connectors={connectors.data ?? []} disabled={ingestionStarted} />
                  </FieldShell>
                  <div className="grid gap-5 lg:grid-cols-3">
                    <FieldShell label="Time window">
                      <Select value={draft.datePreset} disabled={ingestionStarted} onValueChange={(datePreset) => updateDraft({ datePreset: datePreset as Draft["datePreset"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24h">Last 24 hours</SelectItem>
                          <SelectItem value="7d">Last 7 days</SelectItem>
                          <SelectItem value="30d">Last 30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldShell>
                    <FieldShell label="Max items per source">
                      <Input type="number" min={1} max={250} value={draft.maxItemsPerPlatform} disabled={ingestionStarted} onChange={(event) => updateDraft({ maxItemsPerPlatform: event.target.value })} />
                    </FieldShell>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                      <p className="text-xs text-muted-foreground">Estimated maximum</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{maxItems * draft.platforms.length}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{draft.platforms.length} sources x {maxItems} items</p>
                    </div>
                  </div>
                  <details className="rounded-lg border border-border bg-card">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Advanced options</summary>
                    <div className="space-y-5 border-t border-border p-4">
                      <FieldShell label="Cost mode"><ChoiceGrid value={draft.costMode} options={costModeOptions} onChange={(costMode) => updateDraft({ costMode })} disabled={ingestionStarted} /></FieldShell>
                      <FieldShell label="Media handling"><ChoiceGrid value={draft.mediaMode} options={mediaModeOptions} onChange={(mediaMode) => updateDraft({ mediaMode })} disabled={ingestionStarted} /></FieldShell>
                      <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
                        <span>
                          <span className="block text-sm font-medium">AI pre-save review</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">Review relevance and sentiment before saving posts.</span>
                        </span>
                        <Switch checked={draft.aiReviewEnabled} disabled={ingestionStarted} onCheckedChange={(aiReviewEnabled) => updateDraft({ aiReviewEnabled })} />
                      </label>
                    </div>
                  </details>
                </div>
              )}

              {activeStep.id === "progress" && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-4">
                    <div>
                      <p className="text-sm font-semibold">Run progress</p>
                      <p className="mt-1 text-xs text-muted-foreground">This view stays still. Use refresh to pull the latest status.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => { void jobDetails.refetch(); }} disabled={startedJobIds.length === 0 || jobDetails.isFetching}>
                      {jobDetails.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Refresh progress
                    </Button>
                  </div>
                  {startIngestion.isPending && (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Starting collection runs...
                    </div>
                  )}
                  {startIngestion.isError && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <span>{startIngestion.error instanceof Error ? startIngestion.error.message : "Could not start collection."}</span>
                    </div>
                  )}
                  {skippedSources.length > 0 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                      No source was available for: {skippedSources.join(", ")}.
                    </div>
                  )}
                  <div className="grid gap-3 lg:grid-cols-2">
                    {progressDetails.map((detail) => {
                      const progressMeta = progressOf(detail.job);
                      const percent = progressPercent(progressMeta, detail.job);
                      return (
                        <div key={detail.job.id} className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="rounded-md uppercase">{progressMeta?.platform ?? detail.items[0]?.platform ?? "source"}</Badge>
                                <Badge variant={detail.job.status === "completed" ? "default" : detail.job.status === "failed" ? "destructive" : "secondary"} className="rounded-md capitalize">{detail.job.status}</Badge>
                              </div>
                              <p className="mt-2 font-mono text-xs text-muted-foreground">{detail.job.id}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium capitalize">{formatProgressStage(progressMeta?.stage)}</p>
                              <Button type="button" size="sm" variant={selectedStreamJobId === detail.job.id ? "secondary" : "outline"} onClick={() => setSelectedStreamJobId(detail.job.id)}>
                                <Rows3 className="h-4 w-4" /> Open stream
                              </Button>
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Progress</span>
                              <span>{percent}%</span>
                            </div>
                            <Progress value={percent} />
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                            <div className="rounded-md border border-border px-3 py-2"><p className="text-xs text-muted-foreground">Retrieved</p><p className="font-semibold tabular-nums">{progressMeta?.retrievedCount ?? detail.job.fetchedCount ?? 0}</p></div>
                            <div className="rounded-md border border-border px-3 py-2"><p className="text-xs text-muted-foreground">Processed</p><p className="font-semibold tabular-nums">{progressMeta?.processedCount ?? detail.items.length}</p></div>
                            <div className="rounded-md border border-border px-3 py-2"><p className="text-xs text-muted-foreground">Accepted</p><p className="font-semibold tabular-nums">{progressMeta?.acceptedCount ?? detail.items.filter((item) => item.reasonCode === "stored").length}</p></div>
                            <div className="rounded-md border border-border px-3 py-2"><p className="text-xs text-muted-foreground">Rejected</p><p className="font-semibold tabular-nums">{progressMeta?.rejectedCount ?? detail.items.filter((item) => item.reasonCode === "irrelevant").length}</p></div>
                          </div>
                          {progressMeta?.batches?.length ? (
                            <div className="mt-4 space-y-2">
                              <p className="text-xs font-medium uppercase text-muted-foreground">Batches</p>
                              <div className="space-y-2">
                                {progressMeta.batches.map((batch) => (
                                  <div key={`${detail.job.id}-${batch.page}`} className="grid gap-2 rounded-md border border-border px-3 py-2 text-xs sm:grid-cols-5">
                                    <span>Page {batch.page}</span>
                                    <span>Retrieved {batch.retrieved}</span>
                                    <span>Accepted {batch.accepted}</span>
                                    <span>Rejected {batch.rejected}</span>
                                    <span>Stored {batch.stored}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {startedJobIds.length > 0 && progressDetails.length === 0 && !startIngestion.isPending && (
                      <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading run progress...</div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                      <div>
                        <p className="text-sm font-semibold">Processed items</p>
                        <p className="mt-1 text-xs text-muted-foreground">Every retrieved post/news item is listed with its review result and reason.</p>
                      </div>
                      <Badge variant="outline" className="rounded-md">{progressItems.length} items</Badge>
                    </div>
                    <div className="max-h-[520px] overflow-auto">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead className="sticky top-0 border-b border-border bg-muted/50 text-left">
                          <tr>
                            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Result</th>
                            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Platform</th>
                            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Post / topic</th>
                            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Review</th>
                            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {progressItems.map((item) => (
                            <tr key={`${item.jobId}-${item.id}`} className="border-b border-border last:border-b-0 align-top">
                              <td className="px-4 py-3"><Badge variant={item.reasonCode === "stored" ? "default" : item.reasonCode === "irrelevant" ? "secondary" : "outline"} className="rounded-md capitalize">{item.reasonCode.replace(/_/g, " ")}</Badge></td>
                              <td className="px-4 py-3"><Badge variant="outline" className="rounded-md uppercase">{item.platform}</Badge></td>
                              <td className="px-4 py-3">
                                <p className="max-w-md truncate font-medium">{item.title ?? item.textPreview ?? item.sourceId ?? item.id}</p>
                                {item.textPreview && <p className="mt-1 max-w-md truncate text-xs text-muted-foreground">{item.textPreview}</p>}
                                {item.sourceUrl && <a className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a>}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {item.reviewSource && <p>Source: {item.reviewSource}</p>}
                                {typeof item.relevanceScore === "number" && <p>Score: {item.relevanceScore.toFixed(2)}</p>}
                                {item.sentiment && <p>Sentiment: {item.sentiment}</p>}
                              </td>
                              <td className="px-4 py-3"><p className="max-w-lg leading-6">{item.reason}</p></td>
                            </tr>
                          ))}
                          {progressItems.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No processed items yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <Button type="button" variant="outline" onClick={previous} disabled={activeIndex === 0}><ArrowLeft className="h-4 w-4" /> Back</Button>
                <div className="flex flex-wrap gap-2">
                  {activeStep.id !== "progress" && <Button type="button" variant="outline" onClick={() => navigate(returnPath)}>Cancel</Button>}
                  {activeStep.id === "review" || activeStep.id === "refresh" ? (
                    ingestionStarted ? (
                      <Button type="button" onClick={() => setActiveIndex(progressStepIndex)}><Rows3 className="h-4 w-4" /> View progress</Button>
                    ) : (
                      <Button type="button" onClick={finish} disabled={!canFinish || startIngestion.isPending}>
                        {startIngestion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {startIngestion.isPending ? "Starting..." : refreshMode ? "Refresh data" : "Collect posts"}
                      </Button>
                    )
                  ) : activeStep.id === "progress" ? (
                    draft.topicId ? (
                      <Button type="button" asChild><Link to={`/topics/${draft.topicId}`}><ExternalLink className="h-4 w-4" /> Open Topic Details</Link></Button>
                    ) : (
                      <Button type="button" disabled><ExternalLink className="h-4 w-4" /> Open Topic Details</Button>
                    )
                  ) : activeIndex < wizardSteps.length - 1 ? (
                    <Button type="button" onClick={next}>Continue <ArrowRight className="h-4 w-4" /></Button>
                  ) : (
                    <Button type="button" onClick={() => setActiveIndex(progressStepIndex)}><Save className="h-4 w-4" /> Progress</Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit xl:sticky xl:top-6">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center justify-between text-base">
                Run summary
                <Badge variant={canFinish ? "default" : "secondary"} className="rounded-md">{canFinish ? "Ready" : "Draft"}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div>
                <p className="text-sm font-semibold">{draft.runName.trim() || "Untitled collection"}</p>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-4">{draft.searchFocus || "No specific search focus yet."}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">Topic</p>
                  <p className="mt-1 truncate font-medium">{topicTitle(selectedTopic)}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">Max items</p>
                  <p className="mt-1 font-medium tabular-nums">{maxItems * draft.platforms.length}</p>
                </div>
              </div>
              <SummaryList title="Sources" items={selectedPlatformLabels} />
              <SummaryList title="Include" items={[...draft.includeKeywords, ...draft.exactPhrases, ...draft.hashtags, ...draft.handles]} />
              <SummaryList title="Exclude" items={draft.excludeKeywords} />
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-2"><CalendarClock className="h-3.5 w-3.5" /> Range: {draft.datePreset}</p>
                <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> AI review: {draft.aiReviewEnabled ? "on" : "off"}</p>
                <p className="flex items-center gap-2"><ImageIcon className="h-3.5 w-3.5" /> Media: {draft.mediaMode}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={Boolean(selectedStreamJobId)} onOpenChange={(open) => { if (!open) setSelectedStreamJobId(null); }}>
          <DialogContent className="left-auto right-0 top-0 h-dvh w-full max-w-full translate-x-0 translate-y-0 overflow-hidden rounded-none border-l p-0 sm:max-w-xl">
            <div className="flex h-full flex-col">
              <DialogHeader className="border-b border-border px-5 py-4 pr-12">
                <DialogTitle className="text-base">AI review stream</DialogTitle>
                <DialogDescription>
                  {selectedStreamDetail ? `Run ${selectedStreamDetail.job.id}` : "Loading selected stream..."}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {selectedStreamDetail ? (
                  <LlmStreamPanel progress={selectedStreamProgress} detail={selectedStreamDetail} />
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading selected stream...
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}