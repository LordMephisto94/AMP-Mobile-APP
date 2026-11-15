import { signal, Text, View } from "nsh";
import { actionKind, actionLabel, actorOf, type AuditRootItem, listAuditFlows } from "../api/audit";
import { AmpError } from "../api/client";
import { getSpireState, listSpires, type SpireDefinition, type SpireState } from "../api/manage";
import { panelText } from "../api/panelText";
import { getShardState, listShards } from "../api/shards";
import { type DeployedShard, type ShardState, stateTone } from "../api/types";
import { ago } from "../components/analyticsUi";
import { HostCard, num, size } from "../components/HostCard";
import { Screen } from "../components/backdrop";
import { goTo, MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clientFor, clientLater, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";

const REFRESH_MS = 30_000;
const KIND_TEXT = { info: "text-sky-300", danger: "text-rose-400", warn: "text-amber-300", ok: "text-emerald-300" } as const;

/** A server at a glance, as the panel's Overview: totals, its machines, and what happened lately. */
export function OverviewScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const shards = signal<DeployedShard[] | null>(null);
  const states = signal<Record<string, ShardState>>({});
  const spires = signal<SpireDefinition[]>([]);
  const spireStates = signal<Record<string, SpireState>>({});
  const activity = signal<AuditRootItem[] | null>(null);
  const activityError = signal<string | null>(null);
  const text = signal<Record<string, string>>({});
  const shardNames = () => Object.fromEntries((shards() ?? []).map((s) => [s.id, s.displayName || s.name || s.id]));
  const error = signal<string | null>(null);
  const refreshing = signal(false);

  clientLater(props.serverId).then(panelText).then((t) => text.set(t)).catch(() => {});

  const load = async () => {
    try {
      const client = clientFor(props.serverId);
      const [listed, machines] = await Promise.all([listShards(client), listSpires(client).catch(() => spires())]);
      const all = listed.filter((s) => !s.deleted);
      shards.set(all);
      spires.set(machines);
      error.set(null);

      const [shardResults, spireResults] = await Promise.all([
        Promise.allSettled(all.map((s) => getShardState(client, s.id))),
        Promise.allSettled(machines.map((m) => getSpireState(client, m.id))),
      ]);
      const nextShards = { ...states() };
      shardResults.forEach((r, i) => r.status === "fulfilled" && (nextShards[all[i].id] = r.value));
      states.set(nextShards);
      const nextSpires = { ...spireStates() };
      spireResults.forEach((r, i) => r.status === "fulfilled" && (nextSpires[machines[i].id] = r.value));
      spireStates.set(nextSpires);

      listAuditFlows(client, { pageSize: 6 })
        .then((r) => (activity.set(r.items), activityError.set(null)))
        .catch((e) =>
          activityError.set(e instanceof AmpError && e.status === 403 ? "Your account can't read the activity log." : (e as Error).message),
        );
    } catch (e) {
      if (e instanceof AmpError && e.isUnauthorized) {
        await sessionRejected(props.serverId);
        return;
      }
      error.set((e as Error).message);
    }
  };

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "overview" && top.serverId === props.serverId;
  };
  poll(load, REFRESH_MS, onTop);

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const tones = () => (shards() ?? []).map((s) => stateTone(states()[s.id]));
  const running = () => tones().filter((t) => t === "running" || t === "busy" || t === "attention").length;
  const stopped = () => tones().filter((t) => t === "stopped" || t === "error").length;
  const liveMetrics = () =>
    (shards() ?? []).map((s) => states()[s.id]).filter((st) => st && stateTone(st) === "running").map((st) => st!.metrics);
  const ramMb = () => liveMetrics().reduce((sum, m) => sum + num(m?.memoryUsageMB), 0);
  const players = () => liveMetrics().reduce((sum, m) => sum + Math.max(0, num(m?.activeConnections)), 0);

  const showActivity = () => goTo(props.serverId, { name: "activity", serverId: props.serverId });

  return (
    <AppPage title="Overview" subtitle={server?.name ?? ""} right={<MainMenu serverId={props.serverId} current="overview" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-6xl gap-5 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If when={error()}>
            {(message) => (
              <View class="gap-3">
                <ErrorText message={message()} />
                <View class="flex-row">
                  <SecondaryButton title="Try again" onPress={load} />
                </View>
              </View>
            )}
          </If>
          <If when={!error() && shards() === null}>
            <Text class="text-muted-foreground">Loading…</Text>
          </If>

          <If when={shards()}>
            <View class="gap-2">
              <Text class="text-xs font-semibold tracking-widest text-muted-foreground">SERVERS</Text>
              <View class="flex-row flex-wrap justify-between gap-y-3">
                <Total icon="▶" label="Running" value={String(running())} valueClass="text-success" iconClass="text-success" />
                <Total icon="■" label="Stopped" value={String(stopped())} valueClass="text-card-foreground" iconClass="text-muted-foreground" />
                <Total icon="▤" label="Total Shard Usage" value={size(ramMb())} valueClass="text-card-foreground" iconClass="text-violet-300" />
                <Total icon="👥" label="Players" value={String(players())} valueClass="text-card-foreground" iconClass="text-sky-300" />
              </View>
            </View>

            <If when={spires().length > 0}>
              <View class="gap-2">
                <Text class="text-xs font-semibold tracking-widest text-muted-foreground">HOSTS</Text>
                <View class="gap-3 md:flex-row md:flex-wrap">
                  <Each of={spires()} key={(s: SpireDefinition) => s.id}>
                    {(spire) => (
                      <View class="md:w-[48.5%] xl:w-[32.3%]">
                        <HostCard
                          spire={spire()}
                          state={spireStates()[spire().id]}
                          onPress={() => nav.push({ name: "spire", serverId: props.serverId, id: spire().id, title: spire().displayName || spire().id })}
                        />
                      </View>
                    )}
                  </Each>
                </View>
              </View>
            </If>

            <View class="gap-2">
              <View class="flex-row items-center justify-between">
                <Text class="text-xs font-semibold tracking-widest text-muted-foreground">RECENT ACTIVITY</Text>
                <Text role="button" testID="view-all-activity" onPress={showActivity} class="text-sm font-semibold text-sky-400">
                  View all
                </Text>
              </View>
              <If when={activityError()}>{(m) => <Text class="text-sm text-muted-foreground">{m()}</Text>}</If>
              <If when={!activityError() && activity() === null}>
                <Text class="text-sm text-muted-foreground">Loading…</Text>
              </If>
              <If when={activity()?.length === 0}>
                <Text class="text-sm text-muted-foreground">Nothing yet.</Text>
              </If>
              <If when={activity()?.length}>
                <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg">
                  <Each of={activity() ?? []} key={(f: AuditRootItem) => f.correlationId}>
                    {(flow) => {
                      const e = () => flow().root;
                      const target = () => shardNames()[e().targetId] ?? (e().targetType || null);
                      return (
                        <View role="button" onPress={showActivity} class="gap-0.5 border-b border-white/5 px-4 py-3 active:bg-accent">
                          <View class="flex-row items-start gap-3">
                            <Text class={`flex-1 text-sm font-semibold ${KIND_TEXT[actionKind(e().action)]}`}>
                              {actionLabel(e().action, text())}
                            </Text>
                            <Text class="text-xs text-muted-foreground">{ago(flow().startedAt || e().timestamp)}</Text>
                          </View>
                          <Text class="line-clamp-1 text-xs text-muted-foreground">{[actorOf(e()), target()].filter(Boolean).join(" · ")}</Text>
                        </View>
                      );
                    }}
                  </Each>
                </View>
              </If>
            </View>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

function Total(props: { icon: string; label: string; value: string; valueClass: string; iconClass: string }) {
  return (
    <View class="w-[48.5%] flex-row items-center gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-3.5 shadow-lg md:w-[24%]">
      <View class="h-9 w-9 items-center justify-center rounded-full bg-black/40">
        <Text class={`text-sm ${props.iconClass}`}>{props.icon}</Text>
      </View>
      <View class="flex-1">
        <Text class="text-xs text-muted-foreground">{props.label}</Text>
        <Text class={`text-xl font-bold tabular-nums ${props.valueClass}`}>{props.value}</Text>
      </View>
    </View>
  );
}
