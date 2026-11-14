import { Image, signal, Text, View } from "nsh";
import { NavPage } from "nsh/base";
import { artworkUrl } from "../api/artwork";
import { AmpError } from "../api/client";
import { purgeShard, restoreShard } from "../api/manage";
import { getShardState, listShards, type ShardPowerAction, shardPower } from "../api/shards";
import { type DeployedShard, type ShardState, stateLabel, stateTone } from "../api/types";
import { AmpBanner, StatusBadge, toneStatus } from "../components/AmpBanner";
import { Screen } from "../components/backdrop";
import { Dropdown, MoreButton } from "../components/Dropdown";
import { powerItems } from "../components/powerMenu";
import { confirm } from "../components/Confirm";
import { ErrorText, PageHeader, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clearServerSession, clientFor, serverById } from "../state/servers";

/** How often the list refreshes while it is on screen. */
const LIST_REFRESH_MS = 60_000;

/** The instances (shards) on one server, as the panel shows them: artwork, state, CPU and RAM. */
export function ShardsScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const shards = signal<DeployedShard[] | null>(null);
  const deleted = signal<DeployedShard[]>([]);
  const showDeleted = signal(false);
  const working = signal<string | null>(null);
  const states = signal<Record<string, ShardState>>({});
  const error = signal<string | null>(null);
  const refreshing = signal(false);

  const load = async () => {
    try {
      const client = clientFor(props.serverId);
      const everything = await listShards(client, true);
      const all = everything.filter((s) => !s.deleted);
      deleted.set(everything.filter((s) => s.deleted));
      shards.set(all);
      error.set(null);
      // One state read per shard; a shard whose state fails keeps its last one.
      const results = await Promise.allSettled(all.map((s) => getShardState(client, s.id)));
      const next = { ...states() };
      results.forEach((r, i) => {
        if (r.status === "fulfilled") next[all[i].id] = r.value;
      });
      states.set(next);
    } catch (e) {
      if (e instanceof AmpError && e.isUnauthorized) {
        await clearServerSession(props.serverId);
        nav.replace({ name: "signIn", serverId: props.serverId });
        return;
      }
      error.set((e as Error).message);
    }
  };

  // Refresh while this page is the one showing.
  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "shards" && top.serverId === props.serverId;
  };
  poll(load, LIST_REFRESH_MS, onTop);

  const restore = async (shard: DeployedShard) => {
    working.set(shard.id);
    try {
      await restoreShard(clientFor(props.serverId), shard.id);
      await load();
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your account isn't allowed to restore instances." : (e as Error).message);
    } finally {
      working.set(null);
    }
  };

  const purge = async (shard: DeployedShard) => {
    const label = shard.displayName || shard.name || shard.id;
    const action = await confirm({
      title: `Permanently delete ${label}?`,
      message: "This removes its files, snapshots and history from the machine. It can't be undone.",
      icon: "⚠️",
      tone: "danger",
      actions: [{ id: "purge", label: "Delete forever", tone: "danger" }],
    });
    if (action !== "purge") return;
    working.set(shard.id);
    try {
      await purgeShard(clientFor(props.serverId), shard.id);
      deleted.set(deleted().filter((d) => d.id !== shard.id));
      await load();
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your account isn't allowed to delete instances." : (e as Error).message);
    } finally {
      working.set(null);
    }
  };

  /** Runs a control from a card's menu, then looks again soon to catch the state change. */
  const power = async (shard: DeployedShard, action: ShardPowerAction) => {
    working.set(shard.id);
    error.set(null);
    try {
      await shardPower(clientFor(props.serverId), shard.id, action);
      await load();
      for (const delay of [2_000, 6_000, 15_000]) setTimeout(load, delay);
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your account isn't allowed to do that." : (e as Error).message);
    } finally {
      working.set(null);
    }
  };

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const name = server?.name ?? "Server";
  const host = server?.serverUrl.replace(/^https?:\/\//, "") ?? "";
  const running = () => Object.values(states()).filter((s) => stateTone(s) === "running").length;

  return (
    <NavPage title={name} header={<PageHeader title={name} subtitle={host} />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <AmpBanner
          title={name}
          subtitle={shards() ? `${running()} of ${shards()!.length} running · ${host}` : host}
          status={error() ? "danger" : shards() ? "online" : "offline"}
          statusLabel={error() ? "Unreachable" : shards() ? "Online" : "Connecting"}
        />

        <View class="w-full max-w-7xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
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
            <Text class="text-muted-foreground">Loading instances…</Text>
          </If>
          <If when={shards()?.length === 0}>
            <Text class="text-muted-foreground">No instances on this server yet.</Text>
          </If>
          <If when={shards() !== null}>
            <View class={`md:w-72 ${shards()?.length === 1 ? "md:self-center" : "md:self-start"}`}>
              <PrimaryButton title="New instance" icon="＋" onPress={() => nav.push({ name: "createShard", serverId: props.serverId })} />
            </View>
          </If>
          <View class={`gap-4 md:flex-row md:flex-wrap ${shards()?.length === 1 ? "md:justify-center" : ""}`}>
          <Each of={shards()} key={(s: DeployedShard) => s.id}>
            {(shard) => (
              <View class="md:w-[48.5%] xl:w-[32.2%]">
              <ShardCard
                serverId={props.serverId}
                serverUrl={server?.serverUrl ?? ""}
                shard={shard()}
                state={states()[shard().id]}
                busy={working() === shard().id}
                onAction={(action) => power(shard(), action)}
              />
              </View>
            )}
          </Each>
          </View>

          <If when={deleted().length > 0}>
            <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/70">
              <View
                role="button"
                testID="recently-deleted"
                onPress={() => showDeleted.set(!showDeleted())}
                class="flex-row items-center gap-3 px-4 py-3 active:bg-accent"
              >
                <Text class="flex-1 text-sm font-semibold text-muted-foreground">Recently deleted</Text>
                <Text class="text-xs text-muted-foreground">{String(deleted().length)}</Text>
                <Text class="text-muted-foreground">{showDeleted() ? "▾" : "▸"}</Text>
              </View>
              <If when={showDeleted()}>
                <View class="gap-3 border-t border-white/10 p-4">
                  <Each of={deleted()} key={(d: DeployedShard) => d.id}>
                    {(d) => (
                      <View>
                        <DeletedRow
                          shard={d()}
                          busy={working() === d().id}
                          onRestore={() => restore(d())}
                          onPurge={() => purge(d())}
                        />

                      </View>
                    )}
                  </Each>
                </View>
              </If>
            </View>
          </If>
        </View>
      </Screen>
    </NavPage>
  );
}

/** One instance: its game's artwork with the state on it, then its name, CPU and RAM. */
function ShardCard(props: {
  serverId: string;
  serverUrl: string;
  shard: DeployedShard;
  state?: ShardState;
  busy: boolean;
  onAction: (action: ShardPowerAction) => void;
}) {
  const menuOpen = signal(false);
  const title = () => props.shard.displayName || props.shard.name || props.shard.id;
  const art = () => artworkUrl(props.shard.displayImageSource, props.serverUrl, "banner");
  const tone = () => stateTone(props.state);
  const metrics = () => (tone() === "running" ? props.state?.metrics : null);
  const cpu = () => Number(metrics()?.cpuUsagePercent ?? 0);
  const memory = () => Number(metrics()?.memoryUsageMB ?? 0);
  const memoryLimit = () => Number(metrics()?.memoryLimitMB ?? 0);
  const go = (name: "console" | "files" | "shardSettings") => {
    const base = { serverId: props.serverId, id: props.shard.id, title: title() };
    if (name === "files") nav.push({ name, ...base, path: "" });
    else if (name === "console") nav.push({ name, ...base, tenantId: props.shard.tenantId });
    else nav.push({ name, ...base });
  };

  return (
    <View
      role="button"
      testID={`shard-${title()}`}
      onPress={() =>
        nav.push({ name: "shard", serverId: props.serverId, id: props.shard.id, title: title(), image: props.shard.displayImageSource })
      }
      onLongPress={() => menuOpen.set(true)}
      class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg active:opacity-85"
    >
      <View class="aspect-[460/215] w-full bg-secondary">
        <If
          when={art()}
          else={
            <View class="flex-1 items-center justify-center">
              <Text class="text-4xl">🎮</Text>
            </View>
          }
        >
          {(src) => <Image src={src()} accessibilityLabel={props.shard.templateSlug ?? ""} class="absolute inset-0 h-full w-full object-cover" />}
        </If>
        <View class="absolute bottom-3 left-3">
          <If when={props.state} else={<StatusBadge label="Loading" status="offline" />}>
            {(s) => <StatusBadge label={stateLabel(s())} status={toneStatus(tone())} />}
          </If>
        </View>
        <View class="absolute top-3 right-3 flex-row items-center gap-2">
          <If when={props.shard.suspended}>
            <Pill label="Suspended" tone="warning" />
          </If>
          <Dropdown
            open={menuOpen()}
            onOpenChange={(o) => menuOpen.set(o)}
            title={title()}
            items={[
              ...powerItems({ title: title(), state: props.state ?? null, busy: props.busy, run: props.onAction }),
              { id: "console", label: "Console", icon: "⌨️", onSelect: () => go("console") },
              { id: "files", label: "Files", icon: "📁", onSelect: () => go("files") },
              { id: "settings", label: "Settings", icon: "⚙️", onSelect: () => go("shardSettings") },
            ]}
            trigger={<MoreButton testID={`more-${title()}`} />}
          />
        </View>
      </View>

      <View class="gap-2.5 p-4">
        <Text class="text-lg font-semibold text-card-foreground">{title()}</Text>
        <If when={metrics()}>
          <View class="gap-2">
            <MeterRow label="CPU" value={`${cpu().toFixed(cpu() < 10 ? 1 : 0)}%`} fraction={cpu() / 100} barClass="bg-sky-400" />
            <MeterRow
              label="RAM"
              value={`${memory().toLocaleString()} MB`}
              fraction={memoryLimit() > 0 ? memory() / memoryLimit() : 0}
              barClass="bg-violet-400"
            />
          </View>
        </If>
      </View>
    </View>
  );
}

function MeterRow(props: { label: string; value: string; fraction: number; barClass: string }) {
  const percent = (): `${number}%` => `${Math.max(2, Math.min(100, props.fraction * 100))}%`;
  return (
    <View class="flex-row items-center gap-3">
      <Text class="w-9 text-xs font-semibold text-muted-foreground">{props.label}</Text>
      <View class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <View class={`h-full rounded-full ${props.barClass}`} style={{ width: percent() }} />
      </View>
      <Text class="w-20 text-right text-xs text-card-foreground tabular-nums">{props.value}</Text>
    </View>
  );
}

/** A deleted instance: its name and when, with Restore / Delete forever in its dropdown. */
function DeletedRow(props: { shard: DeployedShard; busy: boolean; onRestore: () => void; onPurge: () => void }) {
  const open = signal(false);
  const name = () => props.shard.displayName || props.shard.name || props.shard.id;
  return (
    <View class="flex-row items-center gap-3 py-1.5" onLongPress={() => open.set(true)}>
      <Text class="text-lg">🗑️</Text>
      <View class="flex-1">
        <Text class="text-base font-semibold text-card-foreground">{name()}</Text>
        <Text class="text-xs text-muted-foreground">
          {props.busy ? "Working…" : props.shard.deletedAt ? `Deleted ${new Date(props.shard.deletedAt).toLocaleDateString()}` : "Deleted"}
        </Text>
      </View>
      <Dropdown
        open={open()}
        onOpenChange={(o) => open.set(o && !props.busy)}
        title={name()}
        items={[
          { id: "restore", label: "Restore", icon: "♻️", hint: "Back into your instances", onSelect: props.onRestore },
          { id: "purge", label: "Delete forever", icon: "🔥", tone: "danger", hint: "Removes its files too", onSelect: props.onPurge },
        ]}
        trigger={<MoreButton testID={`more-deleted-${name()}`} class="bg-transparent" />}
      />
    </View>
  );
}
