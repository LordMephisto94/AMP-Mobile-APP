import { Clipboard, signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import { getSpireState, listSpires, type SpireDefinition, type SpireState } from "../api/manage";
import {
  type DatastoreUsageReport,
  getSpireDatastores,
  getSpirePorts,
  getSpireStartup,
  getSpireUsage,
  reachabilityLabel,
  type ShardDiskUsage,
  type SpireDatastore,
  type SpirePortEntry,
  type SpireStartupEntry,
} from "../api/spires";
import { ago, Section } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { Bar, num, rate, size } from "../components/HostCard";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Pill, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clearServerSession, clientFor } from "../state/servers";

const REFRESH_MS = 30_000;
/** Enum values the API may send as names; numbers say nothing to a person. */
const named = (v: string | number | undefined | null) => (typeof v === "string" && v && v !== "None" && v !== "Unknown" ? v : null);

/** One machine: what it is, how loaded it is, where to reach it, its storage, instances and ports. */
export function SpireScreen(props: { serverId: string; id: string; title: string }) {
  const spire = signal<SpireDefinition | null>(null);
  const state = signal<SpireState | null>(null);
  const startup = signal<SpireStartupEntry[] | null>(null);
  const ports = signal<SpirePortEntry[] | null>(null);
  const datastores = signal<SpireDatastore[]>([]);
  const usage = signal<DatastoreUsageReport | null>(null);
  const error = signal<string | null>(null);
  const refreshing = signal(false);
  const copied = signal<string | null>(null);

  const load = async () => {
    const client = clientFor(props.serverId);
    try {
      state.set(await getSpireState(client, props.id));
      error.set(null);
    } catch (e) {
      if (e instanceof AmpError && e.isUnauthorized) {
        await clearServerSession(props.serverId);
        nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
        return;
      }
      error.set(e instanceof AmpError && e.status === 403 ? "Your AMP account can't see this machine." : (e as Error).message);
      return;
    }
    // The rest is extra: each part shows when it arrives and is left out when it can't be had.
    listSpires(client).then((all) => spire.set(all.find((s) => s.id === props.id) ?? null)).catch(() => {});
    getSpireStartup(client, props.id).then((v) => startup.set(v)).catch(() => startup.set(startup() ?? []));
    getSpirePorts(client, props.id).then((v) => ports.set(v)).catch(() => ports.set(ports() ?? []));
    getSpireDatastores(client, props.id).then((v) => datastores.set(v)).catch(() => {});
    getSpireUsage(client, props.id).then((v) => usage.set(v)).catch(() => {});
  };

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "spire" && top.id === props.id;
  };
  poll(load, REFRESH_MS, onTop);

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const copy = async (text: string) => {
    try {
      await Clipboard.writeText(text);
      copied.set(text);
      setTimeout(() => copied() === text && copied.set(null), 1500);
    } catch {
      // no clipboard here
    }
  };

  const s = () => state();
  const p = () => s()?.platform ?? null;
  const online = () => s()?.online ?? false;
  const cpuName = () => {
    const c = p()?.cpu;
    if (!c?.modelName) return null;
    const counts = c.totalCores ? ` · ${c.totalCores} cores / ${c.totalThreads ?? c.totalCores} threads` : "";
    return `${c.modelName}${counts}`;
  };
  const usageFor = (id: string) => usage()?.datastores.find((d) => d.datastoreId === id);
  const openShard = (shardId: string, title: string) => nav.push({ name: "shard", serverId: props.serverId, id: shardId, title });
  const ips = () => (p()?.reportedIps ?? []).slice().sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(a.isV6) - Number(b.isV6));
  const sortedPorts = () => (ports() ?? []).slice().sort((a, b) => a.port - b.port);

  return (
    <AppPage title={props.title} subtitle="Spire" right={<MainMenu serverId={props.serverId} current="spires" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-5xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
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
          <If when={!error() && !s()}>
            <Text class="text-muted-foreground">Loading…</Text>
          </If>

          <If when={s()}>
            {/* What it is */}
            <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
              <View class="flex-row flex-wrap items-center gap-2">
                <Pill label={online() ? "Online" : "Offline"} tone={online() ? "success" : "danger"} />
                <If when={spire()?.isLocal}>
                  <Pill label="Panel host" tone="muted" />
                </If>
                <If when={spire()?.isPublicEntryNode}>
                  <Pill label="Entry node" tone="muted" />
                </If>
                <If when={spire() && spire()!.acceptsNewShards === false && !spire()!.isPublicEntryNode}>
                  <Pill label="Not taking new instances" tone="warning" />
                </If>
                <Each of={spire()?.tags ?? []}>{(t) => <Pill label={t()} tone="muted" />}</Each>
              </View>
              <If when={spire()?.description}>{(d) => <Text class="text-sm text-muted-foreground">{d()}</Text>}</If>
              <View class="gap-1.5">
                <Fact label="System" value={[p()?.osName, named(p()?.architecture)].filter(Boolean).join(" · ") || null} />
                <Fact label="Hostname" value={p()?.hostname || null} />
                <Fact label="Hardware" value={p()?.hardwareName || null} />
                <Fact label="CPU" value={cpuName()} />
                <Fact label="Memory" value={p()?.installedRamMb ? size(p()!.installedRamMb!) : null} />
                <Fact label="Runs in" value={named(p()?.virtualization)} />
                <Fact label="Instances" value={`${s()!.shardCount}${spire()?.maxShards ? ` of ${spire()!.maxShards}` : ""}`} />
                <Fact label="Last report" value={s()!.lastHeartbeat ? ago(s()!.lastHeartbeat) : null} />
              </View>
            </View>

            {/* How busy */}
            <Section title="Load">
              <Bar label="CPU" percent={num(s()!.cpuUsagePercent)} value={`${num(s()!.cpuUsagePercent).toFixed(0)}%`} barClass="bg-sky-400" />
              <Bar
                label="RAM"
                percent={num(s()!.memoryTotalMb) > 0 ? (num(s()!.memoryUsedMb) / num(s()!.memoryTotalMb)) * 100 : 0}
                value={num(s()!.memoryTotalMb) > 0 ? `${size(num(s()!.memoryUsedMb))} / ${size(num(s()!.memoryTotalMb))}` : "–"}
                barClass="bg-violet-400"
              />
              <If when={num(p()?.totalDiskMb) > 0}>
                <Bar
                  label="Disk"
                  percent={100 - (num(p()?.freeDiskMb) / num(p()?.totalDiskMb)) * 100}
                  value={`${size(num(p()?.freeDiskMb))} free of ${size(num(p()?.totalDiskMb))}`}
                  barClass="bg-amber-400"
                />
              </If>
              <View class="flex-row flex-wrap gap-x-5 gap-y-1 pt-1">
                <Text class="text-sm text-card-foreground tabular-nums">{`↓ ${rate(s()!.networkInKBps)}`}</Text>
                <Text class="text-sm text-card-foreground tabular-nums">{`↑ ${rate(s()!.networkOutKBps)}`}</Text>
                <If when={p()?.loadAvgPercent != null && p()!.loadAvgPercent! >= 0}>
                  <Text class="text-sm text-card-foreground tabular-nums">{`Load ${(p()!.loadAvgPercent! / 100).toFixed(2)}`}</Text>
                </If>
                <If when={s()!.diskActivePercent != null}>
                  <Text class="text-sm text-card-foreground tabular-nums">{`Disk busy ${num(s()!.diskActivePercent).toFixed(0)}%`}</Text>
                </If>
                <If when={s()!.busLatencyMs != null}>
                  <Text class="text-sm text-card-foreground tabular-nums">{`Bus ${num(s()!.busLatencyMs).toFixed(0)} ms`}</Text>
                </If>
              </View>
            </Section>

            {/* Where to reach it */}
            <Section title="Addresses" note="tap to copy">
              <If when={spire()?.publicHost || p()?.externalIp}>
                <View class="gap-1">
                  <If when={spire()?.publicHost}>
                    {(h) => <AddressRow address={h()} label="Public host" copied={copied() === h()} onCopy={() => copy(h())} />}
                  </If>
                  <If when={p()?.externalIp}>
                    {(ip) => (
                      <AddressRow
                        address={ip()}
                        label={["Internet sees", reachabilityLabel(p()?.reachability)].filter(Boolean).join(" · ")}
                        copied={copied() === ip()}
                        onCopy={() => copy(ip())}
                      />
                    )}
                  </If>
                </View>
              </If>
              <Each of={ips()} key={(i: NonNullable<NonNullable<SpireState["platform"]>["reportedIps"]>[number]) => i.address}>
                {(ip) => (
                  <AddressRow
                    address={ip().address}
                    label={[ip().interfaceName, ip().isPrimary ? "primary" : null, ip().isTunnel ? "tunnel" : ip().isInternal ? "private" : "public"]
                      .filter(Boolean)
                      .join(" · ")}
                    copied={copied() === ip().address}
                    onCopy={() => copy(ip().address)}
                  />
                )}
              </Each>
              <If when={spire()?.sftpEnabled && spire()?.sftpPort}>
                <Text class="text-xs text-muted-foreground">{`SFTP on port ${spire()!.sftpPort}`}</Text>
              </If>
            </Section>

            {/* Storage */}
            <If when={datastores().length > 0}>
              <Section title="Storage" note={usage()?.scannedAt ? `scanned ${ago(usage()!.scannedAt)}` : "not scanned yet"}>
                <Each of={datastores()} key={(d: SpireDatastore) => d.id}>
                  {(d) => {
                    const u = () => usageFor(d().id);
                    const top = () =>
                      (u()?.shards ?? [])
                        .slice()
                        .sort((a, b) => num(b.sizeMb) - num(a.sizeMb))
                        .slice(0, 5);
                    return (
                      <View class="gap-2 border-b border-white/5 pb-3">
                        <View class="flex-row flex-wrap items-center gap-2">
                          <Text class="text-sm font-semibold text-card-foreground">{d().name || "Datastore"}</Text>
                          <If when={d().isDefault && d().name?.toLowerCase() !== "default"}>
                            <Pill label="Default" tone="muted" />
                          </If>
                          <If when={!d().enabled}>
                            <Pill label="Disabled" tone="warning" />
                          </If>
                          <Each of={d().tags ?? []}>{(t) => <Pill label={t()} tone="muted" />}</Each>
                        </View>
                        <Text class="font-mono text-xs text-muted-foreground">{d().path}</Text>
                        <If when={u()}>
                          {(x) => (
                            <>
                              <Bar
                                label="Drive"
                                percent={num(x().driveTotalMb) > 0 ? 100 - (num(x().driveFreeMb) / num(x().driveTotalMb)) * 100 : 0}
                                value={`${size(num(x().driveFreeMb))} free`}
                                barClass="bg-amber-400"
                              />
                              <Text class="text-xs text-muted-foreground">{`Instances here use ${size(num(x().totalUsedMb))}`}</Text>
                              <Each of={top()} key={(r: ShardDiskUsage) => r.name}>
                                {(r) => (
                                  <View class="flex-row items-center gap-2">
                                    <Text class="line-clamp-1 flex-1 text-xs text-card-foreground">
                                      {r().displayName || r().name}
                                      {r().deleted ? " (deleted)" : r().displayName ? "" : " (not an instance)"}
                                    </Text>
                                    <Text class="text-xs text-muted-foreground tabular-nums">{size(num(r().sizeMb))}</Text>
                                  </View>
                                )}
                              </Each>
                            </>
                          )}
                        </If>
                      </View>
                    );
                  }}
                </Each>
              </Section>
            </If>

            {/* Instances, in boot order */}
            <Section title="Instances" note="in start-up order">
              <If when={startup() === null}>
                <Text class="text-sm text-muted-foreground">Loading…</Text>
              </If>
              <If when={startup()?.length === 0}>
                <Text class="text-sm text-muted-foreground">No instances on this machine.</Text>
              </If>
              <Each of={(startup() ?? []).slice().sort((a, b) => a.order - b.order)} key={(e: SpireStartupEntry) => e.shardId}>
                {(e) => (
                  <View
                    role="button"
                    testID={`spire-shard-${e().shardName}`}
                    onPress={() => openShard(e().shardId, e().shardName)}
                    class="flex-row items-center gap-3 rounded-lg py-1.5 active:bg-accent"
                  >
                    <View class="h-7 w-7 items-center justify-center rounded-full bg-black/40">
                      <Text class="text-xs font-semibold text-muted-foreground tabular-nums">{String(e().order)}</Text>
                    </View>
                    <Text class="line-clamp-1 flex-1 text-sm font-semibold text-card-foreground">{e().shardName}</Text>
                    <Pill label={e().startOnBoot ? "Starts on boot" : "Manual start"} tone={e().startOnBoot ? "success" : "muted"} />
                    <Text class="text-lg text-muted-foreground">›</Text>
                  </View>
                )}
              </Each>
            </Section>

            {/* Ports */}
            <Section title="Ports" note={ports()?.some((x) => x.conflict) ? "clashes marked" : undefined}>
              <If when={ports() === null}>
                <Text class="text-sm text-muted-foreground">Loading…</Text>
              </If>
              <If when={ports()?.length === 0}>
                <Text class="text-sm text-muted-foreground">No ports in use.</Text>
              </If>
              <Each of={sortedPorts()} key={(x: SpirePortEntry) => `${x.shardId}-${x.ref}-${x.port}-${x.protocol}`}>
                {(x) => (
                  <View class={`flex-row items-center gap-3 rounded-lg px-1 py-1.5 ${x().conflict ? "bg-destructive/10" : ""}`}>
                    <View class={`h-2 w-2 rounded-full ${x().listening ? "bg-success" : x().running ? "bg-warning" : "bg-white/20"}`} />
                    <Text class="w-14 font-mono text-sm font-semibold text-card-foreground tabular-nums">{String(x().port)}</Text>
                    <Text class="w-10 text-[11px] font-semibold text-muted-foreground">{x().protocol.toUpperCase()}</Text>
                    <View class="flex-1">
                      <Text class="line-clamp-1 text-sm text-card-foreground">{x().name}</Text>
                      <Text class="line-clamp-1 text-xs text-muted-foreground">
                        {[x().shardName, x().ipBinding && x().ipBinding !== "0.0.0.0" ? x().ipBinding : null].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <If when={x().conflict}>
                      <Pill label="Clash" tone="danger" />
                    </If>
                  </View>
                )}
              </Each>
              <If when={(ports() ?? []).length > 0}>
                <View class="flex-row flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                  <Legend dot="bg-success" label="Listening" />
                  <Legend dot="bg-warning" label="Running, not listening" />
                  <Legend dot="bg-white/20" label="Stopped" />
                </View>
              </If>
            </Section>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

function Fact(props: { label: string; value: string | null }) {
  return (
    <If when={props.value}>
      {(v) => (
        <View class="flex-row gap-3">
          <Text class="w-24 text-xs text-muted-foreground">{props.label}</Text>
          <Text class="flex-1 text-sm text-card-foreground">{v()}</Text>
        </View>
      )}
    </If>
  );
}

function AddressRow(props: { address: string; label: string; copied: boolean; onCopy: () => void }) {
  return (
    <View role="button" onPress={props.onCopy} class="flex-row items-center gap-3 rounded-lg py-1 active:bg-accent">
      <View class="flex-1">
        <Text class="font-mono text-sm text-sky-300">{props.address}</Text>
        <Text class="text-xs text-muted-foreground">{props.label}</Text>
      </View>
      <Text class="text-xs text-muted-foreground">{props.copied ? "Copied" : "⧉"}</Text>
    </View>
  );
}

function Legend(props: { dot: string; label: string }) {
  return (
    <View class="flex-row items-center gap-1.5">
      <View class={`h-2 w-2 rounded-full ${props.dot}`} />
      <Text class="text-[11px] text-muted-foreground">{props.label}</Text>
    </View>
  );
}
