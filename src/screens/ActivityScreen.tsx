import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  actionKind,
  actionLabel,
  actorOf,
  type AuditEvent,
  AuditOrigin,
  type AuditQuery,
  type AuditRootItem,
  AuditSeverity,
  type AuditTreeNode,
  getAuditTree,
  listAuditFlows,
  prettyDetails,
} from "../api/audit";
import { AmpError } from "../api/client";
import { panelText } from "../api/panelText";
import { listShards } from "../api/shards";
import { ago, clockOf, dayOf } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Pill, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clientFor, clientLater, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";
import { PrivText, priv, privIps, privJson } from "../lib/privacy";

const PAGE = 30;
const REFRESH_MS = 60_000;

type Filter = "all" | "people" | "system" | "scheduled" | "warnings" | "security";
const FILTERS: { id: Filter; label: string; query: Partial<AuditQuery> }[] = [
  { id: "all", label: "All", query: {} },
  { id: "people", label: "People", query: { origin: "User" } },
  { id: "system", label: "System", query: { origin: "System" } },
  { id: "scheduled", label: "Scheduled", query: { origin: "Scheduled" } },
  { id: "warnings", label: "Warnings", query: { minSeverity: "Warning" } },
  { id: "security", label: "Security", query: { minSeverity: "Security" } },
];

/** Action colours, as the panel's chips: blue, red, amber, green. */
const KIND_TEXT = { info: "text-sky-300", danger: "text-rose-400", warn: "text-amber-300", ok: "text-emerald-300" } as const;

const ORIGIN_ICON: Record<number, string> = {
  [AuditOrigin.System]: "⚙️",
  [AuditOrigin.User]: "👤",
  [AuditOrigin.UserFlow]: "👤",
  [AuditOrigin.Scheduled]: "⏰",
  [AuditOrigin.Impersonation]: "🎭",
};

/** The panel's Activity page: who did what and when, newest first, each flow expandable. */
export function ActivityScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const filter = signal<Filter>("all");
  const search = signal("");
  const flows = signal<AuditRootItem[] | null>(null);
  const total = signal(0);
  const error = signal<string | null>(null);
  const loadingMore = signal(false);
  const refreshing = signal(false);
  const expanded = signal<string | null>(null);
  /** Shard names by id, to say which instance an event was about. */
  const shardNames = signal<Record<string, string>>({});
  /** The panel's wording for actions. */
  const text = signal<Record<string, string>>({});
  clientLater(props.serverId).then(panelText).then((t) => text.set(t)).catch(() => {});
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let loadId = 0;

  const query = (page: number, pageSize = PAGE): AuditQuery => ({
    ...FILTERS.find((f) => f.id === filter())!.query,
    search: search().trim() || undefined,
    page,
    pageSize,
  });

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
      return;
    }
    error.set(
      e instanceof AmpError && e.status === 403
        ? "Your AMP account can't read the activity log. It needs the audit read permission (platform.audit.read)."
        : (e as Error).message,
    );
  };

  /** Loads the first page again, keeping as many rows as are showing (a refresh doesn't shrink the list). */
  const load = async () => {
    const id = ++loadId;
    try {
      const size = Math.min(200, Math.max(PAGE, flows()?.length ?? 0));
      const result = await listAuditFlows(clientFor(props.serverId), query(1, size));
      if (id !== loadId) return;
      flows.set(result.items);
      total.set(result.total);
      error.set(null);
    } catch (e) {
      if (id === loadId) await fail(e);
    }
  };

  const reset = () => {
    flows.set(null);
    expanded.set(null);
    load();
  };

  const loadMore = async () => {
    const current = flows() ?? [];
    if (loadingMore() || current.length >= total()) return;
    loadingMore.set(true);
    const id = loadId;
    try {
      const page = Math.floor(current.length / PAGE) + 1;
      const result = await listAuditFlows(clientFor(props.serverId), query(page));
      if (id !== loadId) return;
      const seen = new Set(current.map((f) => f.correlationId));
      flows.set([...current, ...result.items.filter((f) => !seen.has(f.correlationId))]);
      total.set(result.total);
    } catch (e) {
      await fail(e);
    } finally {
      loadingMore.set(false);
    }
  };

  clientLater(props.serverId)
    .then((c) => listShards(c, true))
    .then((all) => shardNames.set(Object.fromEntries(all.map((s) => [s.id, s.displayName || s.name || s.id]))))
    .catch(() => {});

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "activity" && top.serverId === props.serverId;
  };
  poll(load, REFRESH_MS, onTop);

  const choose = (f: Filter) => {
    if (f === filter()) return;
    filter.set(f);
    reset();
  };

  const onSearch = (text: string) => {
    search.set(text);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reset, 400);
  };

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const target = (e: AuditEvent) => {
    if (!e.targetId && !e.targetType) return null;
    const name = shardNames()[e.targetId];
    if (name) return name;
    if (!e.targetId) return e.targetType;
    // Long ids say nothing to a person; show the type alone.
    if (/^[0-9a-f-]{20,}$/i.test(e.targetId)) return e.targetType;
    // An address, a user or an account is personal; any other id still has its IPs hidden.
    const personal = /address|user|account|player|email|login|ip|session|client/i.test(e.targetType ?? "");
    return `${e.targetType}: ${personal ? priv(e.targetId) : privIps(e.targetId)}`;
  };

  return (
    <AppPage title="Activity" subtitle={server?.name ?? ""} right={<MainMenu serverId={props.serverId} current="activity" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-4xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <View class="flex-row items-center gap-2 rounded-(--radius) border border-input bg-card/85 px-3.5 py-3">
            <Text class="text-sm text-muted-foreground">🔍</Text>
            <Input
              testID="activity-search"
              value={search()}
              onChange={({ value }) => onSearch(value)}
              placeholder="Search actions, people, instances"
              autoCapitalize="none"
              autoCorrect={false}
              class="flex-1 p-0 text-base text-foreground placeholder:text-muted-foreground"
            />
          </View>

          <View class="flex-row flex-wrap gap-2">
            <Each of={FILTERS}>
              {(f) => (
                <Text
                  role="button"
                  testID={`filter-${f().id}`}
                  onPress={() => choose(f().id)}
                  class={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                    filter() === f().id ? "border-primary bg-primary text-primary-foreground" : "border-white/10 bg-card/85 text-muted-foreground"
                  }`}
                >
                  {f().label}
                </Text>
              )}
            </Each>
          </View>

          <If when={error()}>
            {(message) => (
              <View class="gap-3">
                <ErrorText message={message()} />
                <View class="flex-row">
                  <SecondaryButton title="Try again" onPress={reset} />
                </View>
              </View>
            )}
          </If>
          <If when={!error() && flows() === null}>
            <Text class="text-muted-foreground">Loading activity…</Text>
          </If>
          <If when={flows()?.length === 0}>
            <Text class="text-muted-foreground">Nothing matches.</Text>
          </If>

          <If when={flows()?.length}>
            <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg">
              <Each of={flows() ?? []} key={(f: AuditRootItem) => f.correlationId}>
                {(flow) => (
                  <FlowRow
                    serverId={props.serverId}
                    flow={flow()}
                    target={target}
                    label={(a) => actionLabel(a, text())}
                    open={expanded() === flow().correlationId}
                    onToggle={() => expanded.set(expanded() === flow().correlationId ? null : flow().correlationId)}
                  />
                )}
              </Each>
            </View>
            <Text class="text-center text-xs text-muted-foreground">{`${flows()!.length} of ${total().toLocaleString()}`}</Text>
            <If when={flows()!.length < total()}>
              <View class="flex-row">
                <SecondaryButton testID="load-more" title={loadingMore() ? "Loading…" : "Load more"} onPress={loadMore} />
              </View>
            </If>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

function SeverityPill(props: { severity: number }) {
  return (
    <If when={props.severity >= AuditSeverity.Warning}>
      <Pill label={props.severity >= AuditSeverity.Security ? "Security" : "Warning"} tone={props.severity >= AuditSeverity.Security ? "danger" : "warning"} />
    </If>
  );
}

/** One flow: its root's action, who and what, when; tapping opens everything it set off. */
function FlowRow(props: {
  serverId: string;
  flow: AuditRootItem;
  target: (e: AuditEvent) => string | null;
  label: (action: string) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const tree = signal<AuditTreeNode | null>(null);
  const error = signal<string | null>(null);
  const root = () => props.flow.root;
  const when = () => new Date(props.flow.startedAt || root().timestamp);

  const toggle = () => {
    const opening = !props.open;
    props.onToggle();
    if (opening && !tree()) {
      error.set(null);
      getAuditTree(clientFor(props.serverId), props.flow.correlationId)
        .then((t) => tree.set(t.root))
        .catch((e) => error.set((e as Error).message));
    }
  };

  /** The tree as rows, each with its depth. */
  const rows = () => {
    const out: { node: AuditTreeNode; depth: number }[] = [];
    const walk = (n: AuditTreeNode, depth: number) => {
      out.push({ node: n, depth });
      for (const c of n.children ?? []) walk(c, depth + 1);
    };
    if (tree()) walk(tree()!, 0);
    return out;
  };

  return (
    <View class="border-b border-white/5">
      <View
        role="button"
        testID={`flow-${root().action}`}
        onPress={toggle}
        class={`flex-row gap-3 px-4 py-3 ${props.open ? "bg-white/5" : "active:bg-accent"}`}
      >
        <View class="h-9 w-9 items-center justify-center rounded-full bg-black/40">
          <Text class="text-base">{ORIGIN_ICON[root().origin] ?? "•"}</Text>
        </View>
        {/* min-w-0 and shrink: a long title wraps instead of running under the time. */}
        <View class="min-w-0 flex-1 gap-0.5">
          <View class="flex-row flex-wrap items-center gap-2">
            <Text class={`shrink text-[15px] font-semibold ${KIND_TEXT[actionKind(root().action)]}`}>{props.label(root().action)}</Text>
            <SeverityPill severity={props.flow.maxSeverity} />
          </View>
          <PrivText class="line-clamp-1 text-xs text-muted-foreground" text={[actorOf(root(), priv), props.target(root())].filter(Boolean).join(" · ")} />
        </View>
        <View class="shrink-0 items-end gap-0.5">
          <Text class="text-xs text-muted-foreground">{ago(props.flow.startedAt || root().timestamp)}</Text>
          <If when={props.flow.eventCount > 1}>
            <Text class="text-[11px] text-muted-foreground">{`${props.flow.eventCount} events ${props.open ? "▴" : "▾"}`}</Text>
          </If>
        </View>
      </View>

      <If when={props.open}>
        <View class="gap-2 bg-black/20 px-4 py-3">
          <PrivText class="text-xs text-muted-foreground" text={[`${dayOf(when())}, ${clockOf(when())}`, root().originIp ? `from ${priv(root().originIp)}` : null, root().originNode].filter(Boolean).join(" · ")} />
          <If when={error()}>{(m) => <Text class="text-sm text-destructive">{m()}</Text>}</If>
          <If when={!tree() && !error()}>
            <Text class="text-sm text-muted-foreground">Loading…</Text>
          </If>
          <Each of={rows()} key={(r: { node: AuditTreeNode; depth: number }) => r.node.event.id}>
            {(r) => <EventRow event={r().node.event} depth={r().depth} target={props.target} label={props.label} />}
          </Each>
        </View>
      </If>
    </View>
  );
}

function EventRow(props: {
  event: AuditEvent;
  depth: number;
  target: (e: AuditEvent) => string | null;
  label: (action: string) => string;
}) {
  const showDetails = signal(false);
  const details = () => {
    const d = prettyDetails(props.event.details);
    return d ? privJson(d) : d;
  };
  const t = () => new Date(props.event.timestamp);
  return (
    <View class="gap-1" style={{ marginLeft: Math.min(props.depth, 5) * 14 }}>
      <View class="flex-row items-start gap-2">
        <Text class="text-xs text-muted-foreground">{props.depth > 0 ? "└" : "●"}</Text>
        <View class="flex-1">
          <View class="flex-row flex-wrap items-center gap-1.5">
            <Text class={`shrink text-sm font-semibold ${KIND_TEXT[actionKind(props.event.action)]}`}>{props.label(props.event.action)}</Text>
            <SeverityPill severity={props.event.severity} />
          </View>
          <PrivText class="text-[11px] text-muted-foreground" text={[clockOf(t()) + `:${String(t().getSeconds()).padStart(2, "0")}`, actorOf(props.event, priv), props.target(props.event)].filter(Boolean).join(" · ")} />
        </View>
        <If when={details()}>
          <Text
            role="button"
            testID={`details-${props.event.id}`}
            onPress={() => showDetails.set(!showDetails())}
            class="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
          >
            {showDetails() ? "Hide" : "Details"}
          </Text>
        </If>
      </View>
      {/* Line by line, so hidden values blur where they are. */}
      <If when={showDetails() ? details() : null}>
        {(d) => (
          <View class="ml-4 rounded-lg bg-black/50 p-2.5">
            <Each of={d().split("\n")}>{(line) => <PrivText class="font-mono text-[11px] text-sky-200" text={line()} />}</Each>
          </View>
        )}
      </If>
    </View>
  );
}
