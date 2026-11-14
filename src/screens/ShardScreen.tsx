import { Image, signal, Text, View } from "nsh";
import { AlertDialog, NavPage } from "nsh/base";
import { artworkUrl } from "../api/artwork";
import { AmpError } from "../api/client";
import { deleteShard } from "../api/manage";
import { getShardMetrics, getShardState, shardPower, type ShardPowerAction } from "../api/shards";
import { type ShardMetricsSample, type ShardState, stateLabel, stateTone } from "../api/types";
import { AmpBanner, StatusBadge, toneStatus } from "../components/AmpBanner";
import { Screen } from "../components/backdrop";
import { MetricChart, type MetricPoint } from "../components/MetricChart";
import { ErrorText, PageHeader, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clearServerSession, clientFor, serverById } from "../state/servers";

/** How often the page refreshes while it is on screen (the agent samples every ~5 s). */
const DETAIL_REFRESH_MS = 30_000;
/** After a start/stop/restart, look again sooner to catch the state changing. */
const AFTER_ACTION_MS = [2_000, 6_000, 15_000];
const RANGES = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
];

/** One instance: its artwork and state, live graphs, and power controls. */
export function ShardScreen(props: { serverId: string; id: string; title: string; image?: string | null }) {
  const serverUrl = serverById(props.serverId)?.serverUrl ?? "";
  const state = signal<ShardState | null>(null);
  const samples = signal<ShardMetricsSample[]>([]);
  const minutes = signal(30);
  const error = signal<string | null>(null);
  const busy = signal(false);
  const refreshing = signal(false);
  const heroFailed = signal(false);

  const handle = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await clearServerSession(props.serverId);
      nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
    } else {
      error.set((e as Error).message);
    }
  };

  const load = async () => {
    try {
      const client = clientFor(props.serverId);
      const [s, m] = await Promise.all([
        getShardState(client, props.id),
        getShardMetrics(client, props.id, minutes()).catch(() => samples()),
      ]);
      state.set(s);
      samples.set(m);
      error.set(null);
    } catch (e) {
      await handle(e);
    }
  };

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "shard" && top.id === props.id;
  };
  poll(load, DETAIL_REFRESH_MS, onTop);

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const setRange = (m: number) => {
    minutes.set(m);
    load();
  };

  const power = async (action: ShardPowerAction) => {
    busy.set(true);
    error.set(null);
    try {
      await shardPower(clientFor(props.serverId), props.id, action);
      await load();
      for (const delay of AFTER_ACTION_MS) setTimeout(load, delay);
    } catch (e) {
      await handle(e);
    } finally {
      busy.set(false);
    }
  };

  const remove = async () => {
    const { action } = await AlertDialog.show({
      title: `Delete ${props.title}?`,
      description:
        "It disappears from your instances and stops running. You can restore it from the instance list until you delete it permanently.",
      actions: [
        { id: "cancel", label: "Cancel", role: "cancel" },
        { id: "delete", label: "Delete", role: "destructive" },
      ],
    });
    if (action !== "delete") return;
    busy.set(true);
    error.set(null);
    try {
      await deleteShard(clientFor(props.serverId), props.id);
      nav.pop();
    } catch (e) {
      if (e instanceof AmpError && e.status === 403) error.set("Your account isn't allowed to delete this instance.");
      else await handle(e);
    } finally {
      busy.set(false);
    }
  };

  const tone = () => (busy() ? "busy" : stateTone(state()));
  const isRunning = () => tone() === "running";
  const canStart = () => !busy() && state() != null && (tone() === "stopped" || tone() === "error");
  const canStop = () => !busy() && state() != null && (tone() === "running" || tone() === "busy" || tone() === "attention");
  const label = () => (busy() ? "Working" : stateLabel(state()));

  const hero = () => artworkUrl(props.image, serverUrl, heroFailed() ? "banner" : "hero");

  // Graph series. CPU arrives as a number or a string; -1 players means unknown.
  const points = (pick: (s: ShardMetricsSample) => number | null): MetricPoint[] =>
    samples().map((s) => ({ t: Date.parse(s.timestamp), value: pick(s) }));
  const cpu = () => points((s) => (s.cpuPercent == null ? null : Number(s.cpuPercent)));
  const ram = () => points((s) => s.memoryMb ?? null);
  const players = () => points((s) => (s.activeUsers == null || s.activeUsers < 0 ? null : s.activeUsers));
  const last = () => samples().at(-1);
  const memoryLimit = () => last()?.memoryLimitMb ?? 0;
  const maxPlayers = () => last()?.maxUsers ?? 0;

  return (
    <NavPage title={props.title} header={<PageHeader title={props.title} />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <If
          when={hero()}
          else={
            <AmpBanner
              title={props.title}
              subtitle={state()?.runningVersion ? `Version ${state()!.runningVersion}` : undefined}
              status={toneStatus(tone())}
              statusLabel={label()}
            />
          }
        >
          {(src) => (
            <View class="aspect-[16/7] w-full overflow-hidden bg-secondary">
              <Image
                src={src()}
                onError={() => heroFailed.set(true)}
                accessibilityLabel={props.title}
                class="absolute inset-0 h-full w-full object-cover"
              />
              <View class="absolute inset-0 bg-linear-to-b from-transparent via-black/20 to-background" />
              <View class="absolute right-0 bottom-0 left-0 gap-2 px-5 pb-4">
                <Text class="text-3xl font-bold text-white">{props.title}</Text>
                <View class="flex-row flex-wrap items-center gap-2">
                  <StatusBadge label={label()} status={toneStatus(tone())} />
                  <If when={state()?.runningVersion}>{(v) => <Text class="text-sm text-white/80">Version {v()}</Text>}</If>
                </View>
              </View>
            </View>
          )}
        </If>

        <View class="gap-4 p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If when={error()}>{(message) => <ErrorText message={message()} />}</If>
          <If when={tone() === "error" ? state()?.lastErrorMessage : null}>{(m) => <ErrorText message={m()} />}</If>
          <If when={tone() !== "running" && tone() !== "stopped" ? state()?.statusMessage : null}>
            {(m) => <Text class="text-sm text-muted-foreground">{m()}</Text>}
          </If>

          <View class="flex-row gap-3">
            <SecondaryButton title="Start" tone="success" onPress={() => power("start")} disabled={!canStart()} />
            <SecondaryButton title="Restart" tone="warning" onPress={() => power("restart")} disabled={!canStop()} />
            <SecondaryButton title="Stop" tone="danger" onPress={() => power("stop")} disabled={!canStop()} />
          </View>

          <View
            role="button"
            testID="open-files"
            onPress={() => nav.push({ name: "files", serverId: props.serverId, id: props.id, title: props.title, path: "" })}
            class="flex-row items-center gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg active:bg-accent"
          >
            <View class="h-10 w-10 items-center justify-center rounded-lg bg-black/60">
              <Text class="text-lg">📁</Text>
            </View>
            <View class="flex-1">
              <Text class="text-base font-semibold text-card-foreground">Files</Text>
              <Text class="text-xs text-muted-foreground">Browse, edit, upload and download</Text>
            </View>
            <Text class="text-xl text-muted-foreground">›</Text>
          </View>

          <View
            role="button"
            testID="open-settings"
            onPress={() => nav.push({ name: "shardSettings", serverId: props.serverId, id: props.id, title: props.title })}
            class="flex-row items-center gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg active:bg-accent"
          >
            <View class="h-10 w-10 items-center justify-center rounded-lg bg-black/60">
              <Text class="text-lg text-violet-300">⚙</Text>
            </View>
            <View class="flex-1">
              <Text class="text-base font-semibold text-card-foreground">Settings</Text>
              <Text class="text-xs text-muted-foreground">Name, description and game settings</Text>
            </View>
            <Text class="text-xl text-muted-foreground">›</Text>
          </View>

          <View
            role="button"
            testID="open-console"
            onPress={() =>
              nav.push({ name: "console", serverId: props.serverId, id: props.id, title: props.title, tenantId: state()?.tenantId })
            }
            class="flex-row items-center gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg active:bg-accent"
          >
            <View class="h-10 w-10 items-center justify-center rounded-lg bg-black/60">
              <Text class="font-mono text-base font-bold text-emerald-400">{">_"}</Text>
            </View>
            <View class="flex-1">
              <Text class="text-base font-semibold text-card-foreground">Console</Text>
              <Text class="text-xs text-muted-foreground">Live output and commands</Text>
            </View>
            <Text class="text-xl text-muted-foreground">›</Text>
          </View>

          <View class="flex-row items-center justify-between pt-2">
            <Text class="text-xs font-semibold tracking-widest text-muted-foreground">PERFORMANCE</Text>
            <View class="flex-row gap-1 rounded-lg bg-card/85 p-1">
              <Each of={RANGES}>
                {(r) => (
                  <Text
                    role="button"
                    onPress={() => setRange(r().minutes)}
                    class={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      minutes() === r().minutes ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {r().label}
                  </Text>
                )}
              </Each>
            </View>
          </View>

          <If when={!isRunning() && samples().length === 0}>
            <Text class="text-sm text-muted-foreground">Graphs appear while the instance is running.</Text>
          </If>

          <MetricChart
            title="CPU"
            points={cpu()}
            format={(v) => `${v.toFixed(v < 10 ? 1 : 0)}%`}
            titleClass="text-sky-400"
            lineClass="stroke-sky-400 stroke-2"
            areaClass="fill-sky-400/15"
            dotClass="size-2.5 rounded-full border-2 border-background bg-sky-400"
          />
          <MetricChart
            title="RAM"
            points={ram()}
            format={(v) => `${Math.round(v).toLocaleString()} MB`}
            domain={memoryLimit() > 0 ? [0, memoryLimit()] : undefined}
            caption={memoryLimit() > 0 ? `of ${memoryLimit().toLocaleString()} MB` : undefined}
            titleClass="text-violet-400"
            lineClass="stroke-violet-400 stroke-2"
            areaClass="fill-violet-400/15"
            dotClass="size-2.5 rounded-full border-2 border-background bg-violet-400"
          />
          <MetricChart
            title="Players"
            points={players()}
            format={(v) => `${Math.round(v)}`}
            domain={maxPlayers() > 0 ? [0, maxPlayers()] : undefined}
            caption={maxPlayers() > 0 ? `of ${maxPlayers()} slots` : undefined}
            curve="stepAfter"
            titleClass="text-emerald-400"
            lineClass="stroke-emerald-400 stroke-2"
            areaClass="fill-emerald-400/15"
            dotClass="size-2.5 rounded-full border-2 border-background bg-emerald-400"
          />

          <View class="mt-4 gap-2 rounded-(--radius) border border-destructive/30 bg-destructive/5 p-4">
            <Text class="text-xs font-semibold tracking-widest text-destructive">DANGER ZONE</Text>
            <Text class="text-xs text-muted-foreground">Deleting can be undone from the instance list until you delete permanently.</Text>
            <View class="flex-row">
              <SecondaryButton title="Delete instance" tone="danger" onPress={remove} disabled={busy()} />
            </View>
          </View>
        </View>
      </Screen>
    </NavPage>
  );
}
