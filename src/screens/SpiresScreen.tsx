import { signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import { getSpireState, listSpires, type SpireDefinition, type SpireState } from "../api/manage";
import { getSpireRoster, type SpireRosterItem } from "../api/spires";
import { Screen } from "../components/backdrop";
import { HostCard } from "../components/HostCard";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Pill, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";

const REFRESH_MS = 30_000;

/** A server's machines (spires): each one's load, its AMP version, and a way into its details. */
export function SpiresScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const roster = signal<SpireRosterItem[] | null>(null);
  const states = signal<Record<string, SpireState>>({});
  const error = signal<string | null>(null);
  const refreshing = signal(false);

  const load = async () => {
    try {
      const client = clientFor(props.serverId);
      // The roster carries online and version; an older panel without it still lists machines.
      const items = await getSpireRoster(client).catch(async (e) => {
        if (e instanceof AmpError && (e.isUnauthorized || e.status === 403)) throw e;
        const plain = await listSpires(client);
        return plain.map((spire) => ({ spire, online: true, lastSeen: null, version: null, behind: false, installationVersion: null }));
      });
      roster.set(items);
      error.set(null);
      const results = await Promise.allSettled(items.map((i) => getSpireState(client, i.spire.id)));
      const next = { ...states() };
      results.forEach((r, i) => r.status === "fulfilled" && (next[items[i].spire.id] = r.value));
      states.set(next);
    } catch (e) {
      if (e instanceof AmpError && e.isUnauthorized) {
        await sessionRejected(props.serverId);
        return;
      }
      error.set(e instanceof AmpError && e.status === 403 ? "Your AMP account can't see this server's machines." : (e as Error).message);
    }
  };

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "spires" && top.serverId === props.serverId;
  };
  poll(load, REFRESH_MS, onTop);

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const open = (spire: SpireDefinition) =>
    nav.push({ name: "spire", serverId: props.serverId, id: spire.id, title: spire.displayName || spire.id });

  return (
    <AppPage title="Spires" subtitle={server?.name ?? ""} right={<MainMenu serverId={props.serverId} current="spires" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-6xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <Text class="text-sm text-muted-foreground">The machines your instances run on. Tap one for its hardware, addresses, storage and ports.</Text>
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
          <If when={!error() && roster() === null}>
            <Text class="text-muted-foreground">Loading machines…</Text>
          </If>
          <View class={`gap-4 md:flex-row md:flex-wrap ${roster()?.length === 1 ? "md:justify-center" : ""}`}>
            <Each of={roster() ?? []} key={(i: SpireRosterItem) => i.spire.id}>
              {(item) => (
                <View class="md:w-[48.5%] xl:w-[32.3%]">
                  <HostCard
                    spire={item().spire}
                    state={states()[item().spire.id]}
                    onPress={() => open(item().spire)}
                    footer={
                      <View class="flex-row flex-wrap items-center gap-1.5 pt-1">
                        <If when={item().spire.isLocal}>
                          <Pill label="Panel host" tone="muted" />
                        </If>
                        <If when={item().spire.isPublicEntryNode}>
                          <Pill label="Entry node" tone="muted" />
                        </If>
                        <If when={item().spire.acceptsNewShards === false && !item().spire.isPublicEntryNode}>
                          <Pill label="Not taking new instances" tone="warning" />
                        </If>
                        <If when={item().version}>
                          {(v) => <Pill label={item().behind ? `v${v()} · update needed` : `v${v()}`} tone={item().behind ? "warning" : "muted"} />}
                        </If>
                      </View>
                    }
                  />
                </View>
              )}
            </Each>
          </View>
        </View>
      </Screen>
    </AppPage>
  );
}
