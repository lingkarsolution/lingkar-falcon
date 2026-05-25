import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CircleAlert,
  ClipboardList,
  Database,
  Filter,
  Globe2,
  Hash,
  MapPin,
  Plus,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type Topic, type TopicMonitoringBrief } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

type StepId = "identity" | "perspective" | "objectives" | "query" | "sources" | "audience" | "collection" | "review";
type SubjectType = "public_figure" | "organization" | "issue" | "group" | "brand" | "event" | "normal_user" | "general";
type MonitoringObjective = "reputation" | "early_warning" | "sentiment" | "misinformation" | "campaign" | "competitor" | "complaints";
type PerspectiveRole = "topic_owner" | "government" | "opposition" | "public" | "competitor" | "media" | "neutral_observer" | "custom";
type GeoMode = "mentioned" | "author" | "both";
type RelevanceMode = "broad" | "balanced" | "strict";
type CostMode = "free_only" | "balanced" | "manual_paid";
type FormMode = "choose" | "simple" | "advanced";

type Draft = {
  title: string;
  subjectType: SubjectType;
  perspectiveRole: PerspectiveRole;
  perspectiveName: string;
  perspectiveDescription: string;
  favorableSignals: string[];
  unfavorableSignals: string[];
  objectives: MonitoringObjective[];
  description: string;
  includeKeywords: string[];
  exactPhrases: string[];
  hashtags: string[];
  handles: string[];
  relatedEntities: string[];
  excludeKeywords: string[];
  excludeHashtags: string[];
  excludeHandles: string[];
  excludeDomains: string[];
  platforms: string[];
  languages: string[];
  countries: string[];
  provinces: string[];
  cities: string[];
  geoMode: GeoMode;
  audienceTypes: string[];
  minimumFollowers: string;
  verifiedOnly: boolean;
  includeLowFollowerAccounts: boolean;
  relevanceMode: RelevanceMode;
  aiReviewEnabled: boolean;
  lookbackDays: string;
  refreshMinutes: string;
  maxItemsPerConnector: string;
  costMode: CostMode;
  alertTriggers: string[];
};

const steps: Array<{ id: StepId; title: string; icon: LucideIcon }> = [
  { id: "identity", title: "Define", icon: ClipboardList },
  { id: "perspective", title: "Perspective", icon: Target },
  { id: "objectives", title: "Objectives", icon: Sparkles },
  { id: "query", title: "Query", icon: Search },
  { id: "sources", title: "Sources", icon: Globe2 },
  { id: "audience", title: "Audience", icon: Users },
  { id: "collection", title: "Rules", icon: SlidersHorizontal },
  { id: "review", title: "Review", icon: ShieldCheck },
];

const subjectOptions: Array<{ value: SubjectType; label: string; helper: string }> = [
  { value: "public_figure", label: "Public figure", helper: "People with public visibility" },
  { value: "organization", label: "Organization", helper: "Companies, parties, agencies" },
  { value: "issue", label: "Issue", helper: "Policy, crisis, public concern" },
  { value: "group", label: "Group", helper: "Communities or movements" },
  { value: "brand", label: "Brand / product", helper: "Products, services, competitors" },
  { value: "event", label: "Event", helper: "Campaigns, launches, incidents" },
  { value: "normal_user", label: "Normal user", helper: "Individual account monitoring" },
  { value: "general", label: "General topic", helper: "Broad keyword discovery" },
];

const objectiveOptions: Array<{ value: MonitoringObjective; label: string; helper: string }> = [
  { value: "reputation", label: "Reputation monitoring", helper: "Protect trust, brand health, and public credibility." },
  { value: "early_warning", label: "Early warning", helper: "Catch weak signals before they become visible incidents." },
  { value: "sentiment", label: "Sentiment tracking", helper: "Measure opinions, emotions, and stance over time." },
  { value: "misinformation", label: "Misinformation watch", helper: "Surface repeat claims, rumors, misleading frames, and narratives." },
  { value: "campaign", label: "Campaign tracking", helper: "Follow slogans, hashtags, mobilization, and message spread." },
  { value: "competitor", label: "Competitor tracking", helper: "Compare products, offers, positioning, and switching intent." },
  { value: "complaints", label: "Complaint discovery", helper: "Prioritize user problems, support failures, and urgent issues." },
];

type PerspectiveOption = {
  value: PerspectiveRole;
  label: string;
  helper: string;
  namePlaceholder: string;
  contextPlaceholder: string;
  favorablePlaceholder: string;
  unfavorablePlaceholder: string;
};

const perspectiveOptions: PerspectiveOption[] = [
  {
    value: "topic_owner",
    label: "Topic owner / creator",
    helper: "Judge impact by whether it helps or harms the monitored subject.",
    namePlaceholder: "Movie owner, brand team, campaign owner",
    contextPlaceholder: "Example: Evaluate sentiment from the creator's perspective. Defending the work is favorable; calls to boycott, accusations, or loss of trust are unfavorable.",
    favorablePlaceholder: "defends the movie, encourages watching, praises the creator",
    unfavorablePlaceholder: "calls for boycott, says the movie is harmful, attacks the creator",
  },
  {
    value: "government",
    label: "Government / regulator",
    helper: "Treat public support for authority, policy, or enforcement as favorable.",
    namePlaceholder: "Ministry, regulator, local government, OJK",
    contextPlaceholder: "Example: Evaluate sentiment from the regulator's perspective. Support for enforcement, public order, or institutional credibility is favorable; accusations of censorship or abuse are unfavorable.",
    favorablePlaceholder: "supports government action, asks for enforcement, rejects discrediting state institutions",
    unfavorablePlaceholder: "accuses censorship, criticizes the regulator, defends anti-government framing",
  },
  {
    value: "opposition",
    label: "Opposition / critic",
    helper: "Treat criticism of the subject or institution as potentially favorable.",
    namePlaceholder: "Opposition party, civil society group, critic coalition",
    contextPlaceholder: "Example: Evaluate sentiment from a critic's perspective. Criticism of the subject, demands for accountability, or public pressure can be favorable; defense of the subject can be unfavorable.",
    favorablePlaceholder: "criticizes the subject, demands accountability, supports investigation",
    unfavorablePlaceholder: "defends the subject, dismisses criticism, attacks critics",
  },
  {
    value: "public",
    label: "Public / community",
    helper: "Judge impact by citizen benefit, harm, safety, and fairness.",
    namePlaceholder: "Affected residents, movie audience, customers, voters",
    contextPlaceholder: "Example: Evaluate sentiment from the public interest perspective. Posts that protect safety, fairness, rights, or consumer benefit are favorable; posts that normalize harm are unfavorable.",
    favorablePlaceholder: "protects public interest, raises valid concerns, asks for transparency",
    unfavorablePlaceholder: "dismisses citizen harm, spreads intimidation, normalizes abuse",
  },
  {
    value: "competitor",
    label: "Competitor",
    helper: "Treat weakness, switching intent, or loss of trust in the subject as favorable.",
    namePlaceholder: "Competing brand, rival campaign, alternative product",
    contextPlaceholder: "Example: Evaluate sentiment from a competitor's perspective. Complaints, switching intent, and weakness in the monitored subject are favorable; praise or loyalty toward the subject is unfavorable.",
    favorablePlaceholder: "users want alternatives, criticizes competitor, praises switching",
    unfavorablePlaceholder: "praises monitored brand, rejects alternatives, shows strong loyalty",
  },
  {
    value: "media",
    label: "Media observer",
    helper: "Keep the stance more descriptive and evidence-led.",
    namePlaceholder: "Newsroom, editorial desk, fact-checking team",
    contextPlaceholder: "Example: Evaluate from an editorial perspective. Newsworthy evidence, credible claims, and public-interest angles are favorable; unsupported claims or low-signal noise are unfavorable.",
    favorablePlaceholder: "credible evidence, public-interest angle, newsworthy development",
    unfavorablePlaceholder: "unsupported rumor, duplicate noise, unclear source",
  },
  {
    value: "neutral_observer",
    label: "Neutral analyst",
    helper: "Separate tone toward the subject from strategic impact.",
    namePlaceholder: "Independent analyst, research team, monitoring desk",
    contextPlaceholder: "Example: Evaluate with a neutral lens. Separate whether the post is positive or negative toward the subject from whether it increases risk, support, or attention.",
    favorablePlaceholder: "clear evidence, useful signal, balanced public reaction",
    unfavorablePlaceholder: "ambiguous stance, low relevance, unsupported claim",
  },
  {
    value: "custom",
    label: "Custom POV",
    helper: "Use your own stakeholder framing.",
    namePlaceholder: "Name the stakeholder whose interests matter",
    contextPlaceholder: "Describe exactly what should count as favorable or unfavorable from this stakeholder's perspective.",
    favorablePlaceholder: "signals that help this stakeholder",
    unfavorablePlaceholder: "signals that harm this stakeholder",
  },
];

const platformOptions = [
  "X / Twitter",
  "Threads",
  "TikTok",
  "Instagram",
  "YouTube",
  "Facebook",
  "Reddit",
  "News / Web",
  "RSS",
  "GDELT",
];

const languageOptions = ["Indonesian", "English", "Javanese", "Sundanese", "Malay", "Mixed language"];
const audienceOptions = ["Normal users", "Media accounts", "Influencers / KOL", "Public officials", "Organizations", "Anonymous accounts", "Community groups"];
const alertOptions = ["Negative sentiment spike", "Viral post from high-reach account", "New recurring hashtag", "City sentiment turns negative", "Verified account mention", "Unusual posting volume"];

const initialDraft: Draft = {
  title: "",
  subjectType: "issue",
  perspectiveRole: "topic_owner",
  perspectiveName: "",
  perspectiveDescription: "",
  favorableSignals: [],
  unfavorableSignals: [],
  objectives: ["early_warning"],
  description: "",
  includeKeywords: [],
  exactPhrases: [],
  hashtags: [],
  handles: [],
  relatedEntities: [],
  excludeKeywords: [],
  excludeHashtags: [],
  excludeHandles: [],
  excludeDomains: [],
  platforms: ["X / Twitter", "Threads", "TikTok", "Instagram", "YouTube", "News / Web"],
  languages: ["Indonesian", "English"],
  countries: ["Indonesia"],
  provinces: [],
  cities: [],
  geoMode: "mentioned",
  audienceTypes: ["Normal users", "Media accounts", "Influencers / KOL", "Organizations"],
  minimumFollowers: "0",
  verifiedOnly: false,
  includeLowFollowerAccounts: true,
  relevanceMode: "balanced",
  aiReviewEnabled: true,
  lookbackDays: "30",
  refreshMinutes: "60",
  maxItemsPerConnector: "50",
  costMode: "balanced",
  alertTriggers: ["Negative sentiment spike", "Viral post from high-reach account"],
};

type SaveMode = Exclude<FormMode, "choose">;

const platformLabelToApi: Record<string, string> = {
  "X / Twitter": "x",
  Threads: "threads",
  TikTok: "tiktok",
  Instagram: "instagram",
  YouTube: "youtube",
  Facebook: "facebook",
  Reddit: "reddit",
  "News / Web": "web",
  RSS: "rss",
  GDELT: "gdelt",
};

const apiPlatformToLabel: Record<string, string> = Object.fromEntries(
  Object.entries(platformLabelToApi).map(([label, value]) => [value, label]),
);

const languageLabelToApi: Record<string, string> = {
  Indonesian: "id",
  English: "en",
  Javanese: "jv",
  Sundanese: "su",
  Malay: "ms",
  "Mixed language": "mixed",
};

const apiLanguageToLabel: Record<string, string> = Object.fromEntries(
  Object.entries(languageLabelToApi).map(([label, value]) => [value, label]),
);

const cleanList = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

const positiveNumber = (value: string, fallback: number, max?: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(0, Math.floor(parsed));
  return max ? Math.min(max, normalized) : normalized;
};

const apiPlatforms = (platforms: string[]) => cleanList(platforms.map((platform) => platformLabelToApi[platform] ?? platform.toLowerCase()));
const uiPlatforms = (platforms: string[]) => cleanList(platforms.map((platform) => apiPlatformToLabel[platform] ?? platform));
const apiLanguages = (languages: string[]) => cleanList(languages.map((language) => languageLabelToApi[language] ?? language.toLowerCase()));
const uiLanguages = (languages: string[]) => cleanList(languages.map((language) => apiLanguageToLabel[language] ?? language));

const topicKeywordsFromDraft = (draft: Draft) => cleanList([
  ...draft.includeKeywords,
  ...draft.exactPhrases,
  ...draft.hashtags,
  ...draft.handles,
  ...draft.relatedEntities,
  draft.title,
]);

const topicExcludesFromDraft = (draft: Draft) => cleanList([
  ...draft.excludeKeywords,
  ...draft.excludeHashtags,
  ...draft.excludeHandles,
  ...draft.excludeDomains,
]);

const monitoringBriefFromDraft = (draft: Draft, setupMode: SaveMode): TopicMonitoringBrief => ({
  setupMode,
  subjectType: draft.subjectType,
  objectives: draft.objectives,
  perspective: {
    role: draft.perspectiveRole,
    name: draft.perspectiveName.trim() || null,
    description: draft.perspectiveDescription.trim() || null,
    favorableSignals: cleanList(draft.favorableSignals),
    unfavorableSignals: cleanList(draft.unfavorableSignals),
  },
  query: {
    includeKeywords: cleanList(draft.includeKeywords),
    exactPhrases: cleanList(draft.exactPhrases),
    hashtags: cleanList(draft.hashtags),
    handles: cleanList(draft.handles),
    relatedEntities: cleanList(draft.relatedEntities),
    excludeKeywords: cleanList(draft.excludeKeywords),
    excludeHashtags: cleanList(draft.excludeHashtags),
    excludeHandles: cleanList(draft.excludeHandles),
    excludeDomains: cleanList(draft.excludeDomains),
  },
  sources: {
    platforms: apiPlatforms(draft.platforms),
    languages: apiLanguages(draft.languages),
    countries: cleanList(draft.countries),
    provinces: cleanList(draft.provinces),
    cities: cleanList(draft.cities),
    geoMode: draft.geoMode,
  },
  audience: {
    types: cleanList(draft.audienceTypes),
    minimumFollowers: positiveNumber(draft.minimumFollowers, 0),
    verifiedOnly: draft.verifiedOnly,
    includeLowFollowerAccounts: draft.includeLowFollowerAccounts,
  },
  relevance: {
    mode: draft.relevanceMode,
    aiReviewEnabled: draft.aiReviewEnabled,
  },
  collection: {
    lookbackDays: positiveNumber(draft.lookbackDays, 30, 90) || 30,
    refreshMinutes: Math.max(5, positiveNumber(draft.refreshMinutes, 60, 1440)),
    maxItemsPerConnector: Math.max(1, positiveNumber(draft.maxItemsPerConnector, 50, 250)),
    costMode: draft.costMode,
  },
  alerts: { triggers: cleanList(draft.alertTriggers) },
});

const payloadFromDraft = (draft: Draft, setupMode: SaveMode) => {
  const monitoringBrief = monitoringBriefFromDraft(draft, setupMode);
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    category: draft.subjectType,
    keywords: topicKeywordsFromDraft(draft),
    excludeKeywords: topicExcludesFromDraft(draft),
    platforms: monitoringBrief.sources.platforms,
    languages: monitoringBrief.sources.languages,
    regions: cleanList([...draft.countries, ...draft.provinces, ...draft.cities]),
    status: "active",
    collectionFrequencyMinutes: monitoringBrief.collection.refreshMinutes,
    historyDays: monitoringBrief.collection.lookbackDays,
    ingestTrendingNews: false,
    trendingNewsMaxItems: monitoringBrief.collection.maxItemsPerConnector,
    monitoringBrief,
  };
};

const draftFromTopic = (topic: Topic): Draft => {
  const brief = topic.monitoringBrief;
  const query = brief?.query;
  const sources = brief?.sources;
  const audience = brief?.audience;
  const collection = brief?.collection;
  return {
    ...initialDraft,
    title: topic.title,
    subjectType: (brief?.subjectType ?? topic.category ?? initialDraft.subjectType) as SubjectType,
    perspectiveRole: (brief?.perspective.role ?? "neutral_observer") as PerspectiveRole,
    perspectiveName: brief?.perspective.name ?? "",
    perspectiveDescription: brief?.perspective.description ?? "",
    favorableSignals: brief?.perspective.favorableSignals ?? [],
    unfavorableSignals: brief?.perspective.unfavorableSignals ?? [],
    objectives: (brief?.objectives?.length ? brief.objectives : initialDraft.objectives) as MonitoringObjective[],
    description: topic.description ?? "",
    includeKeywords: query?.includeKeywords?.length ? query.includeKeywords : topic.keywords ?? [],
    exactPhrases: query?.exactPhrases ?? [],
    hashtags: query?.hashtags ?? [],
    handles: query?.handles ?? [],
    relatedEntities: query?.relatedEntities ?? [],
    excludeKeywords: query?.excludeKeywords?.length ? query.excludeKeywords : topic.excludeKeywords ?? [],
    excludeHashtags: query?.excludeHashtags ?? [],
    excludeHandles: query?.excludeHandles ?? [],
    excludeDomains: query?.excludeDomains ?? [],
    platforms: uiPlatforms(sources?.platforms?.length ? sources.platforms : topic.platforms ?? initialDraft.platforms),
    languages: uiLanguages(sources?.languages?.length ? sources.languages : topic.languages ?? initialDraft.languages),
    countries: sources?.countries?.length ? sources.countries : topic.regions ?? [],
    provinces: sources?.provinces ?? [],
    cities: sources?.cities ?? [],
    geoMode: (sources?.geoMode ?? initialDraft.geoMode) as GeoMode,
    audienceTypes: audience?.types ?? initialDraft.audienceTypes,
    minimumFollowers: String(audience?.minimumFollowers ?? 0),
    verifiedOnly: audience?.verifiedOnly ?? false,
    includeLowFollowerAccounts: audience?.includeLowFollowerAccounts ?? true,
    relevanceMode: (brief?.relevance.mode ?? initialDraft.relevanceMode) as RelevanceMode,
    aiReviewEnabled: brief?.relevance.aiReviewEnabled ?? true,
    lookbackDays: String(collection?.lookbackDays ?? topic.intelligenceSettings?.lookbackDays ?? initialDraft.lookbackDays),
    refreshMinutes: String(collection?.refreshMinutes ?? topic.collectionFrequencyMinutes ?? initialDraft.refreshMinutes),
    maxItemsPerConnector: String(collection?.maxItemsPerConnector ?? topic.intelligenceSettings?.maxItemsPerConnector ?? initialDraft.maxItemsPerConnector),
    costMode: (collection?.costMode ?? initialDraft.costMode) as CostMode,
    alertTriggers: brief?.alerts.triggers ?? initialDraft.alertTriggers,
  };
};

const labelFor = <T extends string>(options: Array<{ value: T; label: string }>, value: T) =>
  options.find((option) => option.value === value)?.label ?? value;

const normalizeTagValue = (rawValue: string, prefix?: string): string => {
  const trimmed = rawValue.trim();
  if (!prefix) return trimmed;
  const withoutPrefix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
  return withoutPrefix ? `${prefix}${withoutPrefix}` : "";
};

const addTags = (current: string[], rawValue: string, prefix?: string): string[] => {
  const next = rawValue
    .split(",")
    .map((item) => normalizeTagValue(item, prefix))
    .filter(Boolean);
  return [...current, ...next.filter((item) => !current.some((existing) => existing.toLowerCase() === item.toLowerCase()))];
};

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TagEditor({ label, value, onChange, placeholder, prefix }: { label: string; value: string[]; onChange: (value: string[]) => void; placeholder: string; prefix?: string }) {
  const [entry, setEntry] = useState("");
  const add = () => {
    if (!entry.trim()) return;
    onChange(addTags(value, entry, prefix));
    setEntry("");
  };
  const remove = (item: string) => onChange(value.filter((current) => current !== item));

  return (
    <FieldShell label={label}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">{prefix}</span>}
          <Input
            className={prefix ? "pl-8" : undefined}
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
          />
        </div>
        <Button type="button" variant="outline" onClick={add}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1 rounded-md px-2 py-1 text-xs">
              {item}
              <button type="button" className="rounded-sm text-muted-foreground hover:text-foreground" onClick={() => remove(item)} aria-label={`Remove ${item}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </FieldShell>
  );
}

function ChoiceGrid<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; helper?: string }>; onChange: (value: T) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-20 rounded-lg border px-3 py-3 text-left transition-colors",
              active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card hover:bg-muted/40"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {active && <Check className="h-4 w-4 text-primary" />}
              {option.label}
            </span>
            {option.helper && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.helper}</span>}
          </button>
        );
      })}
    </div>
  );
}

function CheckboxGrid({ options, value, onChange }: { options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  const toggle = (option: string, checked: boolean) => {
    onChange(checked ? [...value, option] : value.filter((item) => item !== option));
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {options.map((option) => (
        <label key={option} className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted/40">
          <Checkbox checked={value.includes(option)} onCheckedChange={(checked) => toggle(option, checked === true)} />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function ObjectiveGrid({ value, onChange }: { value: MonitoringObjective[]; onChange: (value: MonitoringObjective[]) => void }) {
  const toggle = (objective: MonitoringObjective) => {
    onChange(value.includes(objective) ? value.filter((item) => item !== objective) : [...value, objective]);
  };
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {objectiveOptions.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            className={cn(
              "min-h-28 rounded-lg border px-4 py-3 text-left transition-colors",
              active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card hover:bg-muted/40",
            )}
          >
            <span className="flex items-center gap-3 text-sm font-medium">
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-[4px] border", active ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                {active && <Check className="h-3.5 w-3.5" />}
              </span>
              {option.label}
            </span>
            <span className="mt-2 block text-xs leading-5 text-muted-foreground">{option.helper}</span>
          </button>
        );
      })}
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => <Badge key={item} variant="outline" className="rounded-md">{item}</Badge>)}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">None selected</p>
      )}
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

export default function TopicForm() {
  const navigate = useNavigate();
  const { id: topicId } = useParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const isEditing = Boolean(topicId);
  const [mode, setMode] = useState<FormMode>(isEditing ? "advanced" : "choose");
  const [setupChoice, setSetupChoice] = useState<Exclude<FormMode, "choose">>("simple");
  const [activeIndex, setActiveIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [hydratedTopicId, setHydratedTopicId] = useState<string | null>(null);

  const topicQuery = useQuery({
    queryKey: qk.topic(topicId ?? ""),
    queryFn: () => api.get<Topic>(`/topics/${topicId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (isEditing && mode !== "advanced") setMode("advanced");
  }, [isEditing, mode]);

  useEffect(() => {
    if (!topicQuery.data || hydratedTopicId === topicQuery.data.id) return;
    setDraft(draftFromTopic(topicQuery.data));
    setSetupChoice(topicQuery.data.monitoringBrief?.setupMode ?? "advanced");
    setHydratedTopicId(topicQuery.data.id);
  }, [hydratedTopicId, topicQuery.data]);

  const saveTopic = useMutation({
    mutationFn: (setupMode: SaveMode) => {
      const payload = payloadFromDraft(draft, setupMode);
      return isEditing ? api.patch<Topic>(`/topics/${topicId}`, payload) : api.post<Topic>("/topics", payload);
    },
    onSuccess: (topic) => {
      queryClient.invalidateQueries({ queryKey: qk.topics });
      queryClient.invalidateQueries({ queryKey: qk.topic(topic.id) });
      navigate(`/topics/${topic.id}`);
    },
  });

  const activeStep = steps[activeIndex];
  const progress = ((activeIndex + 1) / steps.length) * 100;
  const subjectLabel = labelFor(subjectOptions, draft.subjectType);
  const selectedPerspective = perspectiveOptions.find((option) => option.value === draft.perspectiveRole) ?? perspectiveOptions[0];
  const perspectiveLabel = labelFor(perspectiveOptions, draft.perspectiveRole);
  const perspectiveName = draft.perspectiveName.trim() || perspectiveLabel;
  const objectiveLabels = draft.objectives.map((objective) => labelFor(objectiveOptions, objective));
  const objectiveSummary = objectiveLabels.join(", ") || "None selected";
  const relevanceScore = draft.relevanceMode === "strict" ? "0.75" : draft.relevanceMode === "balanced" ? "0.55" : "0.35";
  const canSave = draft.title.trim().length >= 2
    && draft.description.trim().length > 0
    && draft.objectives.length > 0
    && draft.platforms.length > 0
    && draft.languages.length > 0
    && (draft.perspectiveRole !== "custom" || draft.perspectiveName.trim().length >= 2);
  const saveError = saveTopic.error instanceof Error ? saveTopic.error.message : "Could not save topic.";

  const completeness = useMemo(() => {
    const checks = [
      draft.title.trim().length >= 2,
      draft.perspectiveRole !== "custom" || draft.perspectiveName.trim().length >= 2,
      draft.objectives.length > 0,
      draft.description.trim().length >= 10,
      draft.includeKeywords.length + draft.exactPhrases.length + draft.hashtags.length + draft.handles.length > 0,
      draft.platforms.length > 0,
      draft.languages.length > 0,
      draft.alertTriggers.length > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [draft]);

  const updateDraft = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const next = () => setActiveIndex((current) => Math.min(steps.length - 1, current + 1));
  const previous = () => setActiveIndex((current) => Math.max(0, current - 1));
  const resetDraft = () => setDraft(topicQuery.data ? draftFromTopic(topicQuery.data) : initialDraft);

  if (isEditing && topicQuery.isLoading) {
    return (
      <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
        <Card>
          <CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">Loading topic form...</CardContent>
        </Card>
      </div>
    );
  }

  if (isEditing && topicQuery.isError) {
    return (
      <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-destructive">{topicQuery.error instanceof Error ? topicQuery.error.message : "Could not load topic."}</p>
            <Button type="button" variant="outline" onClick={() => navigate("/topics")}><ArrowLeft className="h-4 w-4" /> Back to topics</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "choose") {
    return (
      <TooltipProvider>
        <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
          <div className="flex w-full flex-col gap-6">
            <div className="rounded-lg border border-border bg-card shadow-xs">
              <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="ghost" size="sm" className="px-2">
                      <Link to="/topics"><ArrowLeft className="h-4 w-4" /> Topics</Link>
                    </Button>
                    <Badge variant="outline" className="rounded-md">New topic</Badge>
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Choose topic setup</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Start quickly with the essential monitoring brief, or use the full analyst workflow.</p>
                  </div>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="text-base">Setup type</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                <div className="grid gap-3 lg:grid-cols-2">
                  <label className={cn("flex cursor-pointer gap-4 rounded-lg border bg-card p-4 transition-colors", setupChoice === "simple" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}>
                    <input
                      type="radio"
                      name="topic-setup-type"
                      value="simple"
                      checked={setupChoice === "simple"}
                      onChange={() => setSetupChoice("simple")}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary"><ClipboardList className="h-4 w-4" /></span>
                        <span className="text-base font-semibold">Simple setup</span>
                        <Badge className="rounded-md">Recommended</Badge>
                      </span>
                      <span className="mt-3 block text-sm leading-6 text-muted-foreground">Best when you want to get monitoring ready fast. It asks for the topic, POV, objective, search terms, and platforms.</span>
                      <span className="mt-4 flex flex-wrap gap-2">
                        {['Topic', 'POV', 'Focus', 'Keywords', 'Platforms'].map((item) => <Badge key={item} variant="outline" className="rounded-md">{item}</Badge>)}
                      </span>
                    </span>
                  </label>

                  <label className={cn("flex cursor-pointer gap-4 rounded-lg border bg-card p-4 transition-colors", setupChoice === "advanced" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}>
                    <input
                      type="radio"
                      name="topic-setup-type"
                      value="advanced"
                      checked={setupChoice === "advanced"}
                      onChange={() => setSetupChoice("advanced")}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary"><SlidersHorizontal className="h-4 w-4" /></span>
                        <span className="text-base font-semibold">Advanced setup</span>
                        <Badge variant="secondary" className="rounded-md">Full control</Badge>
                      </span>
                      <span className="mt-3 block text-sm leading-6 text-muted-foreground">Use the full wizard for include/exclude logic, geo targeting, audience filters, collection rules, and alert triggers.</span>
                      <span className="mt-4 flex flex-wrap gap-2">
                        {['8 steps', 'Geo', 'Audience', 'Rules', 'Review'].map((item) => <Badge key={item} variant="outline" className="rounded-md">{item}</Badge>)}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-5">
                  <Button type="button" variant="outline" onClick={() => navigate("/topics")}><ArrowLeft className="h-4 w-4" /> Cancel</Button>
                  <Button type="button" onClick={() => setMode(setupChoice)}>Continue <ArrowRight className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  if (mode === "simple") {
    return (
      <TooltipProvider>
        <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
          <div className="flex w-full flex-col gap-6">
            <div className="rounded-lg border border-border bg-card shadow-xs">
              <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="ghost" size="sm" className="px-2">
                      <Link to="/topics"><ArrowLeft className="h-4 w-4" /> Topics</Link>
                    </Button>
                    <Badge variant="outline" className="rounded-md">{isEditing ? "Edit topic" : "Simple setup"}</Badge>
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Quick topic brief</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Capture the minimum useful context for monitoring: topic, POV, intent, search terms, and source coverage.</p>
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={() => setMode("advanced")}><SlidersHorizontal className="h-4 w-4" /> Use advanced</Button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <Card>
                <CardHeader className="border-b border-border">
                  <CardTitle className="text-base">Simple topic details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 p-5">
                  <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                    <FieldShell label="Topic name">
                      <Input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Example: Pesta Babi movie controversy" />
                    </FieldShell>
                    <FieldShell label="Subject type">
                      <Select value={draft.subjectType} onValueChange={(subjectType) => updateDraft({ subjectType: subjectType as SubjectType })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{subjectOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </FieldShell>
                  </div>
                  <FieldShell label="Description">
                    <Textarea value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="min-h-28" placeholder="What is this topic about, and what should analysts pay attention to?" />
                  </FieldShell>

                  <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                    <div>
                      <p className="text-sm font-medium">Point of view</p>
                      <p className="mt-1 text-sm text-muted-foreground">Choose whose interest the future sentiment decision should represent.</p>
                    </div>
                    <ChoiceGrid value={draft.perspectiveRole} options={perspectiveOptions} onChange={(perspectiveRole) => updateDraft({ perspectiveRole })} />
                    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                      <FieldShell label="Stakeholder name">
                        <Input value={draft.perspectiveName} onChange={(event) => updateDraft({ perspectiveName: event.target.value })} placeholder={selectedPerspective.namePlaceholder} />
                      </FieldShell>
                      <FieldShell label="How should sentiment be judged?">
                        <Textarea value={draft.perspectiveDescription} onChange={(event) => updateDraft({ perspectiveDescription: event.target.value })} className="min-h-24" placeholder={selectedPerspective.contextPlaceholder} />
                      </FieldShell>
                    </div>
                  </div>

                  <FieldShell label="Monitoring focus">
                    <ObjectiveGrid value={draft.objectives} onChange={(objectives) => updateDraft({ objectives })} />
                  </FieldShell>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <TagEditor label="Main keywords" value={draft.includeKeywords} onChange={(includeKeywords) => updateDraft({ includeKeywords })} placeholder="movie title, issue, campaign name" />
                    <TagEditor label="Hashtags" value={draft.hashtags} onChange={(hashtags) => updateDraft({ hashtags })} placeholder="PestaBabi" prefix="#" />
                    <TagEditor label="Handles / accounts" value={draft.handles} onChange={(handles) => updateDraft({ handles })} placeholder="official_account" prefix="@" />
                    <TagEditor label="Exclude obvious noise" value={draft.excludeKeywords} onChange={(excludeKeywords) => updateDraft({ excludeKeywords })} placeholder="parody, giveaway, unrelated meaning" />
                  </div>

                  <FieldShell label="Platforms">
                    <CheckboxGrid options={platformOptions} value={draft.platforms} onChange={(platforms) => updateDraft({ platforms })} />
                  </FieldShell>

                  <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-5">
                    <Button type="button" variant="ghost" onClick={() => setMode("choose")}><ArrowLeft className="h-4 w-4" /> Change setup</Button>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => navigate("/topics")}>Cancel</Button>
                      <Button type="button" onClick={() => saveTopic.mutate("simple")} disabled={!canSave || saveTopic.isPending}>
                        <Save className="h-4 w-4" /> {saveTopic.isPending ? "Saving..." : isEditing ? "Save changes" : "Save topic"}
                      </Button>
                    </div>
                  </div>
                  {saveTopic.isError && <p className="text-sm text-destructive">{saveError}</p>}
                </CardContent>
              </Card>

              <Card className="h-fit xl:sticky xl:top-6">
                <CardHeader className="border-b border-border">
                  <CardTitle className="flex items-center justify-between text-base">
                    Quick summary
                    <Badge variant={completeness >= 80 ? "default" : "secondary"} className="rounded-md">{completeness}%</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                  <div>
                    <p className="text-sm font-semibold">{draft.title || "Untitled topic"}</p>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-4">{draft.description || "No description yet."}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-border px-3 py-2">
                      <p className="text-xs text-muted-foreground">Subject</p>
                      <p className="mt-1 font-medium">{subjectLabel}</p>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-2">
                      <p className="text-xs text-muted-foreground">POV</p>
                      <p className="mt-1 font-medium">{perspectiveName}</p>
                    </div>
                  </div>
                  <SummaryList title="Objectives" items={objectiveLabels} />
                  <SummaryList title="Include" items={[...draft.includeKeywords, ...draft.hashtags, ...draft.handles]} />
                  <SummaryList title="Exclude" items={draft.excludeKeywords} />
                  <SummaryList title="Platforms" items={draft.platforms} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
        <div className="flex w-full flex-col gap-6">
          <div className="rounded-lg border border-border bg-card shadow-xs">
            <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild variant="ghost" size="sm" className="px-2">
                    <Link to="/topics"><ArrowLeft className="h-4 w-4" /> Topics</Link>
                  </Button>
                  <Badge variant="outline" className="rounded-md">{isEditing ? "Edit topic" : "Advanced setup"}</Badge>
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{isEditing ? "Edit topic brief" : "Topic monitoring brief"}</h1>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Build a structured topic definition for collection, filtering, geo focus, audience rules, and review settings.</p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:min-w-56">
                {!isEditing && <Button type="button" variant="outline" size="sm" onClick={() => setMode("choose")}>Change setup</Button>}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{activeIndex + 1}/{steps.length}</span>
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
                  {steps.map((step, index) => {
                    const Icon = step.icon;
                    const active = index === activeIndex;
                    const complete = index < activeIndex;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                          active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                      >
                        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md border", active ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background")}>
                          {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </span>
                        <span className="font-medium">{step.title}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-[620px]">
              <CardHeader className="border-b border-border">
                <CardTitle className="flex items-center gap-2 text-base">
                  {activeStep && <activeStep.icon className="h-4 w-4 text-primary" />}
                  {activeStep?.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 p-5">
                {activeStep?.id === "identity" && (
                  <div className="space-y-6">
                    <FieldShell label="Topic name">
                      <Input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Example: Fuel subsidy policy reaction" />
                    </FieldShell>
                    <FieldShell label="Subject type">
                      <ChoiceGrid value={draft.subjectType} options={subjectOptions} onChange={(subjectType) => updateDraft({ subjectType })} />
                    </FieldShell>
                    <FieldShell label="Analyst description">
                      <Textarea value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="min-h-32" placeholder="Summarize the issue, why it matters, and what the analyst should pay attention to." />
                    </FieldShell>
                  </div>
                )}

                {activeStep?.id === "perspective" && (
                  <div className="space-y-6">
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex items-start gap-3">
                        <Target className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium">Sentiment is judged from this stakeholder POV</p>
                          <p className="mt-1 text-sm text-muted-foreground">A post can sound negative toward the subject but still be strategically favorable for another stakeholder.</p>
                        </div>
                      </div>
                    </div>
                    <FieldShell label="Point of view">
                      <ChoiceGrid value={draft.perspectiveRole} options={perspectiveOptions} onChange={(perspectiveRole) => updateDraft({ perspectiveRole })} />
                    </FieldShell>
                    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
                      <FieldShell label="POV name">
                        <Input value={draft.perspectiveName} onChange={(event) => updateDraft({ perspectiveName: event.target.value })} placeholder={selectedPerspective.namePlaceholder} />
                      </FieldShell>
                      <FieldShell label="POV context">
                        <Textarea value={draft.perspectiveDescription} onChange={(event) => updateDraft({ perspectiveDescription: event.target.value })} className="min-h-24" placeholder={selectedPerspective.contextPlaceholder} />
                      </FieldShell>
                    </div>
                    <div className="grid gap-5 lg:grid-cols-2">
                      <TagEditor label="Favorable from this POV" value={draft.favorableSignals} onChange={(favorableSignals) => updateDraft({ favorableSignals })} placeholder={selectedPerspective.favorablePlaceholder} />
                      <TagEditor label="Unfavorable from this POV" value={draft.unfavorableSignals} onChange={(unfavorableSignals) => updateDraft({ unfavorableSignals })} placeholder={selectedPerspective.unfavorablePlaceholder} />
                    </div>
                  </div>
                )}

                {activeStep?.id === "objectives" && (
                  <div className="space-y-6">
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <div className="flex items-start gap-3">
                        <Target className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium">Choose one or more monitoring objectives</p>
                          <p className="mt-1 text-sm text-muted-foreground">Later, these objectives can become decision rules for query expansion, relevance scoring, AI review, alerts, and summaries.</p>
                        </div>
                      </div>
                    </div>
                    <ObjectiveGrid value={draft.objectives} onChange={(objectives) => updateDraft({ objectives })} />
                  </div>
                )}

                {activeStep?.id === "query" && (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-5">
                      <div className="flex items-center gap-2 text-sm font-medium"><Target className="h-4 w-4 text-primary" /> Include</div>
                      <TagEditor label="Main keywords" value={draft.includeKeywords} onChange={(includeKeywords) => updateDraft({ includeKeywords })} placeholder="prabowo, fuel subsidy" />
                      <TagEditor label="Exact phrases" value={draft.exactPhrases} onChange={(exactPhrases) => updateDraft({ exactPhrases })} placeholder="makan bergizi gratis" />
                      <TagEditor label="Hashtags" value={draft.hashtags} onChange={(hashtags) => updateDraft({ hashtags })} placeholder="KabinetMerahPutih" prefix="#" />
                      <TagEditor label="Handles / accounts" value={draft.handles} onChange={(handles) => updateDraft({ handles })} placeholder="username" prefix="@" />
                      <TagEditor label="Related entities" value={draft.relatedEntities} onChange={(relatedEntities) => updateDraft({ relatedEntities })} placeholder="agency, alias, nickname" />
                    </div>
                    <div className="space-y-5">
                      <div className="flex items-center gap-2 text-sm font-medium"><Filter className="h-4 w-4 text-primary" /> Exclude</div>
                      <TagEditor label="Excluded keywords" value={draft.excludeKeywords} onChange={(excludeKeywords) => updateDraft({ excludeKeywords })} placeholder="parody, giveaway" />
                      <TagEditor label="Excluded hashtags" value={draft.excludeHashtags} onChange={(excludeHashtags) => updateDraft({ excludeHashtags })} placeholder="giveaway" prefix="#" />
                      <TagEditor label="Excluded handles" value={draft.excludeHandles} onChange={(excludeHandles) => updateDraft({ excludeHandles })} placeholder="spam_account" prefix="@" />
                      <TagEditor label="Excluded domains" value={draft.excludeDomains} onChange={(excludeDomains) => updateDraft({ excludeDomains })} placeholder="example.com" />
                    </div>
                  </div>
                )}

                {activeStep?.id === "sources" && (
                  <div className="space-y-6">
                    <FieldShell label="Platforms">
                      <CheckboxGrid options={platformOptions} value={draft.platforms} onChange={(platforms) => updateDraft({ platforms })} />
                    </FieldShell>
                    <FieldShell label="Languages">
                      <CheckboxGrid options={languageOptions} value={draft.languages} onChange={(languages) => updateDraft({ languages })} />
                    </FieldShell>
                    <div className="grid gap-5 lg:grid-cols-3">
                      <TagEditor label="Countries" value={draft.countries} onChange={(countries) => updateDraft({ countries })} placeholder="Indonesia" />
                      <TagEditor label="Provinces" value={draft.provinces} onChange={(provinces) => updateDraft({ provinces })} placeholder="Jawa Barat" />
                      <TagEditor label="Cities" value={draft.cities} onChange={(cities) => updateDraft({ cities })} placeholder="Jakarta, Bandung" />
                    </div>
                    <FieldShell label="Location signal">
                      <div className="grid gap-2 md:grid-cols-3">
                        {[
                          { value: "mentioned", label: "Mentioned location" },
                          { value: "author", label: "Author location" },
                          { value: "both", label: "Both signals" },
                        ].map((option) => (
                          <button key={option.value} type="button" onClick={() => updateDraft({ geoMode: option.value as GeoMode })} className={cn("rounded-lg border px-3 py-3 text-left text-sm", draft.geoMode === option.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}>
                            <MapPin className="mb-2 h-4 w-4 text-primary" />
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </FieldShell>
                  </div>
                )}

                {activeStep?.id === "audience" && (
                  <div className="space-y-6">
                    <FieldShell label="Audience types">
                      <CheckboxGrid options={audienceOptions} value={draft.audienceTypes} onChange={(audienceTypes) => updateDraft({ audienceTypes })} />
                    </FieldShell>
                    <div className="grid gap-5 md:grid-cols-3">
                      <FieldShell label="Minimum followers">
                        <Input type="number" min="0" value={draft.minimumFollowers} onChange={(event) => updateDraft({ minimumFollowers: event.target.value })} />
                      </FieldShell>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">Verified only</p>
                          <p className="text-xs text-muted-foreground">Prioritize official or verified identities</p>
                        </div>
                        <Switch checked={draft.verifiedOnly} onCheckedChange={(verifiedOnly) => updateDraft({ verifiedOnly })} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">Low-follower accounts</p>
                          <p className="text-xs text-muted-foreground">Keep grassroots posts in scope</p>
                        </div>
                        <Switch checked={draft.includeLowFollowerAccounts} onCheckedChange={(includeLowFollowerAccounts) => updateDraft({ includeLowFollowerAccounts })} />
                      </div>
                    </div>
                  </div>
                )}

                {activeStep?.id === "collection" && (
                  <div className="space-y-6">
                    <FieldShell label="Relevance strictness">
                      <div className="grid gap-2 md:grid-cols-3">
                        {[
                          { value: "broad", label: "Broad", helper: "Discovery-heavy" },
                          { value: "balanced", label: "Balanced", helper: "Default analyst workflow" },
                          { value: "strict", label: "Strict", helper: "Higher precision" },
                        ].map((option) => (
                          <button key={option.value} type="button" onClick={() => updateDraft({ relevanceMode: option.value as RelevanceMode })} className={cn("rounded-lg border px-3 py-3 text-left", draft.relevanceMode === option.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}>
                            <span className="text-sm font-medium">{option.label}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{option.helper}</span>
                          </button>
                        ))}
                      </div>
                    </FieldShell>
                    <div className="grid gap-5 md:grid-cols-3">
                      <FieldShell label="Lookback days">
                        <Select value={draft.lookbackDays} onValueChange={(lookbackDays) => updateDraft({ lookbackDays })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{[7, 14, 30, 60, 90].map((days) => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}</SelectContent>
                        </Select>
                      </FieldShell>
                      <FieldShell label="Refresh interval">
                        <Select value={draft.refreshMinutes} onValueChange={(refreshMinutes) => updateDraft({ refreshMinutes })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{[[15, "15 minutes"], [30, "30 minutes"], [60, "Hourly"], [360, "Every 6 hours"], [1440, "Daily"]].map(([value, label]) => <SelectItem key={value} value={String(value)}>{label}</SelectItem>)}</SelectContent>
                        </Select>
                      </FieldShell>
                      <FieldShell label="Max items per source">
                        <Input type="number" min="1" max="250" value={draft.maxItemsPerConnector} onChange={(event) => updateDraft({ maxItemsPerConnector: event.target.value })} />
                      </FieldShell>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">AI relevance review</p>
                          <p className="text-xs text-muted-foreground">Review candidate posts before storage</p>
                        </div>
                        <Switch checked={draft.aiReviewEnabled} onCheckedChange={(aiReviewEnabled) => updateDraft({ aiReviewEnabled })} />
                      </div>
                      <FieldShell label="API cost mode">
                        <Select value={draft.costMode} onValueChange={(costMode) => updateDraft({ costMode: costMode as CostMode })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free_only">Free / open-source only</SelectItem>
                            <SelectItem value="balanced">Balanced</SelectItem>
                            <SelectItem value="manual_paid">Paid APIs only on manual run</SelectItem>
                          </SelectContent>
                        </Select>
                      </FieldShell>
                    </div>
                    <FieldShell label="Alert triggers">
                      <CheckboxGrid options={alertOptions} value={draft.alertTriggers} onChange={(alertTriggers) => updateDraft({ alertTriggers })} />
                    </FieldShell>
                  </div>
                )}

                {activeStep?.id === "review" && (
                  <div className="space-y-6">
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium">Ready to persist</p>
                          <p className="mt-1 text-sm text-muted-foreground">Saving stores the full monitoring brief without starting ingestion. Collection still happens from explicit ingestion or refresh actions.</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border px-4">
                      <ReviewRow label="Topic" value={draft.title || "Untitled topic"} />
                      <ReviewRow label="Subject" value={subjectLabel} />
                      <ReviewRow label="POV" value={perspectiveName} />
                      <ReviewRow label="Favorable signals" value={draft.favorableSignals.join(", ") || "Not specified"} />
                      <ReviewRow label="Unfavorable signals" value={draft.unfavorableSignals.join(", ") || "Not specified"} />
                      <ReviewRow label="Objectives" value={objectiveSummary} />
                      <ReviewRow label="Platforms" value={draft.platforms.join(", ") || "None selected"} />
                      <ReviewRow label="Languages" value={draft.languages.join(", ") || "None selected"} />
                      <ReviewRow label="Geo focus" value={[...draft.countries, ...draft.provinces, ...draft.cities].join(", ") || "No location focus"} />
                      <ReviewRow label="Audience" value={`${draft.audienceTypes.join(", ") || "No audience filters"}; min followers ${draft.minimumFollowers || "0"}`} />
                      <ReviewRow label="Collection" value={`${draft.lookbackDays} days lookback, ${draft.refreshMinutes} minute refresh, ${draft.maxItemsPerConnector} items/source`} />
                      <ReviewRow label="Review mode" value={`${draft.relevanceMode} relevance, minimum score ${relevanceScore}, AI review ${draft.aiReviewEnabled ? "on" : "off"}`} />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={resetDraft}>
                        <Trash2 className="h-4 w-4" /> Reset draft
                      </Button>
                      <Button type="button" onClick={() => saveTopic.mutate("advanced")} disabled={!canSave || saveTopic.isPending}>
                        <Save className="h-4 w-4" /> {saveTopic.isPending ? "Saving..." : isEditing ? "Save changes" : "Save topic"}
                      </Button>
                    </div>
                    {saveTopic.isError && <p className="text-sm text-destructive">{saveError}</p>}
                  </div>
                )}
              </CardContent>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
                <Button type="button" variant="outline" onClick={previous} disabled={activeIndex === 0}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="ghost" onClick={() => navigate("/topics")}>Cancel</Button>
                  {activeIndex < steps.length - 1 ? (
                    <Button type="button" onClick={next}>Next <ArrowRight className="h-4 w-4" /></Button>
                  ) : (
                    <Button type="button" onClick={() => saveTopic.mutate("advanced")} disabled={!canSave || saveTopic.isPending}>
                      <Save className="h-4 w-4" /> {saveTopic.isPending ? "Saving..." : isEditing ? "Save changes" : "Save topic"}
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            <Card className="h-fit xl:sticky xl:top-6">
              <CardHeader className="border-b border-border">
                <CardTitle className="flex items-center justify-between text-base">
                  Draft summary
                  <Badge variant={completeness >= 80 ? "default" : "secondary"} className="rounded-md">{completeness}%</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                <div>
                  <p className="text-sm font-semibold">{draft.title || "Untitled topic"}</p>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-4">{draft.description || "No analyst description yet."}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">Subject</p>
                    <p className="mt-1 font-medium">{subjectLabel}</p>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">POV</p>
                    <p className="mt-1 font-medium">{perspectiveName}</p>
                  </div>
                </div>
                <SummaryList title="Objectives" items={objectiveLabels} />
                <SummaryList title="Favorable POV signals" items={draft.favorableSignals} />
                <SummaryList title="Unfavorable POV signals" items={draft.unfavorableSignals} />
                <SummaryList title="Include" items={[...draft.includeKeywords, ...draft.exactPhrases, ...draft.hashtags, ...draft.handles]} />
                <SummaryList title="Exclude" items={[...draft.excludeKeywords, ...draft.excludeHashtags, ...draft.excludeHandles, ...draft.excludeDomains]} />
                <SummaryList title="Platforms" items={draft.platforms} />
                <SummaryList title="Locations" items={[...draft.countries, ...draft.provinces, ...draft.cities]} />
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium"><Bell className="h-4 w-4 text-primary" /> Alert scope</div>
                  <p className="mt-2 text-muted-foreground">{draft.alertTriggers.length} triggers, {draft.relevanceMode} relevance, minimum score {relevanceScore}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium"><Database className="h-4 w-4 text-primary" /> Collection</div>
                  <p className="mt-2 text-muted-foreground">{draft.lookbackDays} days, {draft.refreshMinutes} minute refresh, {draft.costMode.replace("_", " ")}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}