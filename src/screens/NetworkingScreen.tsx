import { Clipboard, signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import { listSpires, type SpireDefinition } from "../api/manage";
import {
  bytes,
  type FirewallRule,
  type FirewallStatus,
  type Gateway,
  getFirewall,
  getGateways,
  getHttps,
  getPublications,
  getShardPorts,
  getTunnels,
  type HttpsState,
  type Publication,
  removePublication,
  setPortAccess,
  setPublicationEnabled,
  type ShardPort,
  stateTone,
  type Tunnel,
  words,
} from "../api/networking";
import { connectAddress, getAllShardEndpoints, listShards } from "../api/shards";
import type { DeployedShard } from "../api/types";
import { Section } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Dropdown, MoreButton } from "../components/Dropdown";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Pill, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";
import { openSafe } from "../lib/links";

const REFRESH_MS = 30_000;

/** A part that may be refused (no permission) without spoiling the rest. */
type Part<T> = { value: T } | { denied: true } | { error: string } | null;
const valueOf = <T,>(p: Part<T>): T | null => (p && "value" in p ? p.value : null);

async function part<T>(promise: Promise<T>): Promise<Part<T>> {
  try {
    return { value: await promise };
  } catch (e) {
    if (e instanceof AmpError && e.isUnauthorized) throw e;
    if (e instanceof AmpError && (e.status === 403 || e.status === 404)) return { denied: true };
    return { error: (e as Error).message };
  }
}

/** AMP's own listeners, by `AmpListenerKind`. */
const LISTENER: Record<string, string> = {
  Panel: "web panel",
  Bus: "message bus",
  Sftp: "SFTP server",
  EntryNodeBootstrap: "entry node setup",
  WireGuardTunnel: "WireGuard tunnel",
  TunnelProbe: "tunnel probe",
};

const REACH: Record<string, string> = {
  Direct: "Reachable directly",
  Nat: "Behind NAT: forward ports on your router",
  Cgnat: "Carrier-grade NAT: port forwarding won't work, use a public spire",
};

/** How the server is reached: the panel's address, instances' ports, publications, gateways, tunnels and the firewall. */
export function NetworkingScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const https = signal<Part<HttpsState>>(null);
  const publications = signal<Part<Publication[]>>(null);
  const gateways = signal<Part<Gateway[]>>(null);
  const tunnels = signal<Part<Tunnel[]>>(null);
  const firewall = signal<Part<FirewallStatus>>(null);
  const shards = signal<DeployedShard[] | null>(null);
  const ports = signal<Record<string, ShardPort[] | "denied">>({});
  const addresses = signal<Record<string, string>>({});
  const spires = signal<SpireDefinition[]>([]);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const refreshing = signal(false);
  const copied = signal<string | null>(null);

  let loadSeq = 0;
  const load = async () => {
    const mine = ++loadSeq;
    try {
      const c = clientFor(props.serverId);
      const [h, p, g, t, f] = await Promise.all([
        part(getHttps(c)),
        part(getPublications(c)),
        part(getGateways(c)),
        part(getTunnels(c)),
        part(getFirewall(c)),
      ]);
        if (mine !== loadSeq) return; // a newer load started: its answer wins
      https.set(h);
      publications.set(p);
      gateways.set(g);
      tunnels.set(t);
      firewall.set(f);
      error.set(null);

      listSpires(c).then((s) => spires.set(s)).catch(() => {});
      getAllShardEndpoints(c)
        .then((all) => {
          const found: Record<string, string> = {};
          for (const [id, eps] of Object.entries(all ?? {})) {
            const a = Array.isArray(eps) ? connectAddress(eps) : null;
            if (a) found[id] = a.display;
          }
          addresses.set(found);
        })
        .catch(() => {});

      const list = (await listShards(c)).filter((s) => !s.deleted);
      if (mine !== loadSeq) return; // a newer load started: its answer wins
      shards.set(list);
      const results = await Promise.all(list.map((s) => part(getShardPorts(c, s.id))));
      if (mine !== loadSeq) return; // a newer load started: its answer wins
      const next: Record<string, ShardPort[] | "denied"> = {};
      results.forEach((r, i) => {
        const v = valueOf(r);
        if (v) next[list[i].id] = v;
        else if (r && "denied" in r) next[list[i].id] = "denied";
      });
      ports.set(next);
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
    return top?.name === "networking" && top.serverId === props.serverId;
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

  /** Runs a change, says how it went, and reloads. */
  const act = async (what: () => Promise<unknown>, done: string) => {
    error.set(null);
    notice.set(null);
    try {
      await what();
      notice.set(done);
      await load();
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your AMP account isn't allowed to change networking." : (e as Error).message);
    }
  };

  const shardName = (id: string) => {
    const s = shards()?.find((x) => x.id === id);
    return s ? s.displayName || s.name || id : "Instance";
  };
  const spireName = (id: string) => spires().find((s) => s.id === id)?.displayName || "Spire";
  const spireHost = (id: string) => spires().find((s) => s.id === id)?.publicHost || spireName(id);
  const portName = (shardId: string, ref: string) => {
    const list = ports()[shardId];
    return (list !== "denied" && list?.find((p) => p.ref === ref)?.name) || ref;
  };
  const publicationsFor = (shardId: string, ref: string) => (valueOf(publications()) ?? []).filter((p) => p.shardId === shardId && p.portRef === ref);

  const toggleAccess = async (shard: DeployedShard, port: ShardPort) => {
    const makePublic = !port.isPublic;
    const choice = await confirm({
      title: `Make ${port.name} ${makePublic ? "public" : "private"}?`,
      message: makePublic
        ? `Port ${port.port} on ${shardName(shard.id)} opens in AMP's firewall and can be published.`
        : `Port ${port.port} on ${shardName(shard.id)} closes in AMP's firewall and stops being published. Players using it lose access.`,
      icon: makePublic ? "🌐" : "🔒",
      tone: makePublic ? "default" : "danger",
      actions: [{ id: "go", label: makePublic ? "Make public" : "Make private", tone: makePublic ? "primary" : "danger" }],
    });
    if (choice !== "go") return;
    await act(() => setPortAccess(clientFor(props.serverId), shard.id, port.ref, makePublic), `${port.name} is now ${makePublic ? "public" : "private"}.`);
  };

  const pausePublication = (p: Publication) =>
    act(() => setPublicationEnabled(clientFor(props.serverId), p, !p.enabled), p.enabled ? "Publication paused." : "Publication resumed.");

  const unpublish = async (p: Publication) => {
    const choice = await confirm({
      title: `Stop publishing port ${p.publicPort}?`,
      message: `${shardName(p.shardId)} stops being reachable through ${spireName(p.frontSpireId)} on port ${p.publicPort}.`,
      icon: "🔌",
      tone: "danger",
      actions: [{ id: "remove", label: "Unpublish", tone: "danger" }],
    });
    if (choice !== "remove") return;
    await act(() => removePublication(clientFor(props.serverId), p.id), "Unpublished.");
  };

  return (
    <AppPage title="Networking" subtitle={server?.name ?? ""} right={<MainMenu serverId={props.serverId} current="networking" />}>
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
          <If when={notice()}>
            {(m) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text class="text-sm text-success">{m()}</Text>
              </View>
            )}
          </If>
          <If when={!error() && https() === null}>
            <Text class="text-muted-foreground">Loading networking…</Text>
          </If>

          {/* The panel itself */}
          <If when={valueOf(https())}>
            {(h) => (
              <Section title="Panel access">
                <View class="flex-row flex-wrap items-center gap-2">
                  <Pill
                    label={h().mode === "managed" ? "HTTPS by AMP" : h().mode === "ownProxy" ? "Your own proxy" : "No HTTPS front"}
                    tone={h().mode === "none" ? "warning" : "success"}
                  />
                  <If when={h().mode === "managed"}>
                    <Pill label={h().certificateVerified ? "Certificate OK" : "Certificate not verified"} tone={h().certificateVerified ? "success" : "warning"} />
                  </If>
                  <If when={h().entryNode}>
                    <Pill label="Entry node" tone="muted" />
                  </If>
                </View>
                <If when={h().url}>
                  {(url) => (
                    <View role="button" testID="panel-url" onPress={() => openSafe(url()).catch((e) => error.set((e as Error).message))} class="rounded-lg py-1 active:bg-accent">
                      <Text class="font-mono text-sm text-sky-300">{url()}</Text>
                      <Text class="text-xs text-muted-foreground">Tap to open</Text>
                    </View>
                  )}
                </If>
                <If when={REACH[h().reachability]}>{(r) => <Text class="text-sm text-card-foreground">{r()}</Text>}</If>
                <View class="gap-1">
                  <If when={h().externalAddress}>
                    {(a) => <CopyRow value={a()} label="Public IPv4" copied={copied() === a()} onCopy={() => copy(a())} />}
                  </If>
                  <If when={h().internalAddress}>
                    {(a) => (
                      <CopyRow
                        value={a()}
                        label={h().reachability === "Nat" ? "This machine: point port forwards here" : "This machine"}
                        copied={copied() === a()}
                        onCopy={() => copy(a())}
                      />
                    )}
                  </If>
                  <If when={h().ipv6Address}>
                    {(a) => <CopyRow value={a()} label="IPv6" copied={copied() === a()} onCopy={() => copy(a())} />}
                  </If>
                </View>
                <If when={(h().trustedProxies ?? []).length}>
                  <Text class="text-xs text-muted-foreground">{`Trusted proxies: ${(h().trustedProxies ?? []).join(", ")}`}</Text>
                </If>
              </Section>
            )}
          </If>

          {/* Each instance's ports */}
          <If when={shards()}>
            <Section title="Instance ports" note="⋯ to change access">
              <If when={shards()!.length === 0}>
                <Text class="text-sm text-muted-foreground">No instances.</Text>
              </If>
              <Each of={shards()!} key={(s: DeployedShard) => s.id}>
                {(shard) => {
                  const list = () => ports()[shard().id];
                  const sorted = () => {
                    const l = list();
                    return l && l !== "denied" ? l.slice().sort((a, b) => Number(b.primary) - Number(a.primary) || a.port - b.port) : [];
                  };
                  return (
                    <View class="gap-1.5 border-b border-white/5 pb-3">
                      <View class="flex-row items-baseline gap-2">
                        <Text class="flex-1 text-[15px] font-semibold text-card-foreground">{shardName(shard().id)}</Text>
                        <If when={addresses()[shard().id]}>
                          {(a) => <Text class="font-mono text-xs text-sky-300">{a()}</Text>}
                        </If>
                      </View>
                      <If when={list() === "denied"}>
                        <Text class="text-xs text-muted-foreground">Your account can't see this instance's ports.</Text>
                      </If>
                      <If when={list() === undefined}>
                        <Text class="text-xs text-muted-foreground">Loading…</Text>
                      </If>
                      <Each of={sorted()} key={(p: ShardPort) => p.ref}>
                        {(port) => (
                          <PortRow
                            port={port()}
                            published={publicationsFor(shard().id, port().ref).map((p) => `${spireHost(p.frontSpireId)}:${p.publicPort}`)}
                            onToggle={() => toggleAccess(shard(), port())}
                          />
                        )}
                      </Each>
                    </View>
                  );
                }}
              </Each>
            </Section>
          </If>

          {/* Ports relayed through a public machine */}
          <If when={(valueOf(publications())?.length ?? 0) > 0}>
            <Section title="Published ports" note="relayed by a public spire">
              <Each of={valueOf(publications()) ?? []} key={(p: Publication) => p.id}>
                {(p) => (
                  <PublicationRow
                    publication={p()}
                    title={`${spireHost(p().frontSpireId)}:${p().publicPort}`}
                    target={`${shardName(p().shardId)} · ${portName(p().shardId, p().portRef)}`}
                    onPause={() => pausePublication(p())}
                    onRemove={() => unpublish(p())}
                  />
                )}
              </Each>
            </Section>
          </If>

          <If when={(valueOf(gateways())?.length ?? 0) > 0}>
            <Section title="Gateways" note="whole instance behind a public spire">
              <Each of={valueOf(gateways()) ?? []} key={(g: Gateway) => g.id}>
                {(g) => (
                  <View class="gap-1 border-b border-white/5 pb-2">
                    <View class="flex-row flex-wrap items-center gap-2">
                      <Text class="flex-1 text-sm font-semibold text-card-foreground">{`${g().shardName} → ${g().frontSpireName}`}</Text>
                      <Pill label={g().enabled ? words(g().status?.state) || "Pending" : "Disabled"} tone={g().enabled ? stateTone(g().status?.state) : "muted"} />
                    </View>
                    <If when={g().status?.address}>{(a) => <Text class="font-mono text-xs text-muted-foreground">{`Tunnel address ${a()}`}</Text>}</If>
                    <If when={g().runningWithoutRoute}>
                      <Text class="text-xs text-warning">Running without this route: restart the instance to use it.</Text>
                    </If>
                    <If when={g().status?.error}>{(e) => <Text class="text-xs text-destructive">{e()}</Text>}</If>
                  </View>
                )}
              </Each>
            </Section>
          </If>

          <If when={(valueOf(tunnels())?.length ?? 0) > 0}>
            <Section title="Tunnels" note="between spires">
              <Each of={valueOf(tunnels()) ?? []} key={(t: Tunnel) => t.id}>
                {(t) => {
                  const phase = () => t().status?.phase ?? (t().status?.up ? "Up" : "Connecting");
                  const fault = () => t().status?.error || t().front.agentError || t().back.agentError;
                  return (
                    <View class="gap-1 border-b border-white/5 pb-2">
                      <View class="flex-row flex-wrap items-center gap-2">
                        <Text class="flex-1 text-sm font-semibold text-card-foreground">{`${t().back.spireName} ⇄ ${t().front.spireName}`}</Text>
                        <Pill label={words(phase())} tone={stateTone(phase())} />
                      </View>
                      <Text class="text-xs text-muted-foreground">
                        {[
                          t().frontEndpointHost ? `${t().frontEndpointHost}:${t().listenPort}` : null,
                          t().status?.rttMs != null ? `${Number(t().status!.rttMs).toFixed(0)} ms` : null,
                          t().permanentForEntryNode ? "carries the panel" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      <If when={fault()}>{(e) => <Text class="text-xs text-destructive">{e()}</Text>}</If>
                    </View>
                  );
                }}
              </Each>
            </Section>
          </If>

          {/* The firewall AMP manages on this machine */}
          <If when={firewall()}>
            {(f) => (
              <Section title="Firewall" note="on the panel's machine">
                <If when={"denied" in f()}>
                  <Text class="text-sm text-muted-foreground">Your account can't see the firewall.</Text>
                </If>
                <If when={"error" in f() ? (f() as { error: string }).error : null}>{(e) => <Text class="text-sm text-destructive">{e()}</Text>}</If>
                <If when={valueOf(f())}>{(fw) => <FirewallView firewall={fw()} />}</If>
              </Section>
            )}
          </If>

          <Text class="text-xs text-muted-foreground">
            Publishing new ports, gateways and tunnels is done in the web panel for now.
          </Text>
        </View>
      </Screen>
    </AppPage>
  );
}

function CopyRow(props: { value: string; label: string; copied: boolean; onCopy: () => void }) {
  return (
    <View role="button" onPress={props.onCopy} class="flex-row items-center gap-3 rounded-lg py-1 active:bg-accent">
      <View class="flex-1">
        <Text class="font-mono text-sm text-sky-300">{props.value}</Text>
        <Text class="text-xs text-muted-foreground">{props.label}</Text>
      </View>
      <Text class="text-xs text-muted-foreground">{props.copied ? "Copied" : "⧉"}</Text>
    </View>
  );
}

function PortRow(props: { port: ShardPort; published: string[]; onToggle: () => void }) {
  const open = signal(false);
  return (
    <View class="flex-row items-start gap-3 py-1.5">
      <Text class="w-14 font-mono text-sm font-semibold text-card-foreground tabular-nums">{String(props.port.port)}</Text>
      <Text class="w-10 text-[11px] font-semibold text-muted-foreground">{String(props.port.protocol ?? "").toUpperCase()}</Text>
      <View class="flex-1 gap-1">
        <Text class="line-clamp-1 text-sm text-card-foreground">{props.port.name}</Text>
        <View class="flex-row flex-wrap gap-1.5">
          <Pill label={props.port.isPublic ? "Public" : "Private"} tone={props.port.isPublic ? "success" : "muted"} />
          <If when={props.port.primary}>
            <Pill label="Main" tone="muted" />
          </If>
        </View>
        <If when={props.published.length}>
          <Text class="text-xs text-sky-300">{`Published on ${props.published.join(", ")}`}</Text>
        </If>
      </View>
      <If when={!props.port.primary} else={<View class="w-9" />}>
        <Dropdown
          open={open()}
          onOpenChange={(o) => open.set(o)}
          title={`${props.port.name} · ${props.port.port}`}
          items={[
            props.port.isPublic
              ? { id: "private", label: "Make private", icon: "🔒", hint: "Closes it in AMP's firewall", tone: "danger", onSelect: props.onToggle }
              : { id: "public", label: "Make public", icon: "🌐", hint: "Opens it in AMP's firewall", onSelect: props.onToggle },
          ]}
          trigger={<MoreButton testID={`port-more-${props.port.ref}`} class="bg-transparent" />}
        />
      </If>
    </View>
  );
}

function PublicationRow(props: { publication: Publication; title: string; target: string; onPause: () => void; onRemove: () => void }) {
  const open = signal(false);
  const p = () => props.publication;
  const state = () => (p().enabled ? (p().status?.state ?? "Pending") : "Disabled");
  return (
    <View class="gap-1 border-b border-white/5 pb-2">
      <View class="flex-row items-center gap-2">
        <View class="flex-1">
          <Text class="font-mono text-sm font-semibold text-sky-300">{props.title}</Text>
          <Text class="line-clamp-1 text-xs text-muted-foreground">{`→ ${props.target} · ${String(p().protocol ?? "").toUpperCase()}`}</Text>
        </View>
        <Pill label={words(state()) === "Disabled" ? "Paused" : words(state())} tone={stateTone(state())} />
        <Dropdown
          open={open()}
          onOpenChange={(o) => open.set(o)}
          title={props.title}
          items={[
            p().enabled
              ? { id: "pause", label: "Pause", icon: "⏸️", hint: "Stops relaying, keeps the setup", onSelect: props.onPause }
              : { id: "resume", label: "Resume", icon: "▶️", onSelect: props.onPause },
            { id: "unpublish", label: "Unpublish", icon: "🔌", tone: "danger", onSelect: props.onRemove },
          ]}
          trigger={<MoreButton testID={`pub-more-${p().publicPort}`} class="bg-transparent" />}
        />
      </View>
      <If when={p().status && p().enabled}>
        <Text class="text-xs text-muted-foreground tabular-nums">
          {`${p().status!.activeFlows ?? 0} connection${p().status!.activeFlows === 1 ? "" : "s"} · ↓ ${bytes(p().status!.bytesIn)} · ↑ ${bytes(p().status!.bytesOut)}`}
        </Text>
      </If>
      <If when={p().status?.error}>{(e) => <Text class="text-xs text-destructive">{e()}</Text>}</If>
    </View>
  );
}

function FirewallView(props: { firewall: FirewallStatus }) {
  const showRules = signal(false);
  const st = () => props.firewall.status;
  const applied = () => (st()?.applied ?? []).slice().sort((a, b) => a.port - b.port);
  return (
    <View class="gap-2">
      <If
        when={props.firewall.running}
        else={<Text class="text-sm text-muted-foreground">AMP isn't managing a firewall here. Open your instances' ports yourself.</Text>}
      >
        <View class="flex-row flex-wrap items-center gap-2">
          <Pill label={st()?.healthy ? "Healthy" : "Problem"} tone={st()?.healthy ? "success" : "danger"} />
          <If when={st()?.backend}>{(b) => <Pill label={b()} tone="muted" />}</If>
          <Text class="text-xs text-muted-foreground">{`${applied().length} rule${applied().length === 1 ? "" : "s"} open`}</Text>
        </View>
      </If>
      <If when={st()?.error}>{(e) => <Text class="text-xs text-destructive">{e()}</Text>}</If>
      <Each of={st()?.advisories ?? []}>{(a) => <Text class="text-xs text-warning">{a()}</Text>}</Each>
      <Each of={st()?.rejected ?? []}>
        {(r) => <Text class="text-xs text-destructive">{`Port ${r().rule.port} refused: ${r().reason}`}</Text>}
      </Each>
      <Each of={props.firewall.withheld ?? []}>
        {(w) => (
          <Text class="text-xs text-warning">{`${w().shardName}: port ${w().port} is held by AMP's ${LISTENER[w().kind] ?? words(w().kind).toLowerCase()}, so it's unreachable until moved.`}</Text>
        )}
      </Each>
      <If when={applied().length > 0}>
        <Text role="button" testID="firewall-rules" onPress={() => showRules.set(!showRules())} class="text-sm font-semibold text-sky-400">
          {showRules() ? "Hide rules" : "Show rules"}
        </Text>
        <If when={showRules()}>
          <Each of={applied()} key={(r: FirewallRule) => `${r.port}-${r.protocol}-${r.tag ?? ""}`}>
            {(r) => (
              <View class="flex-row items-center gap-3">
                <Text class="w-14 font-mono text-sm text-card-foreground tabular-nums">{String(r().port)}</Text>
                <Text class="w-10 text-[11px] font-semibold text-muted-foreground">{String(r().protocol).toUpperCase()}</Text>
                <Text class="line-clamp-1 flex-1 text-xs text-muted-foreground">{r().label || r().tag || ""}</Text>
              </View>
            )}
          </Each>
        </If>
      </If>
    </View>
  );
}
