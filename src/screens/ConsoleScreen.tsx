import { cleanup, effect, lifecycle, List, type ListRef, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { hubToken } from "../api/auth";
import { AmpError } from "../api/client";
import { type ConsoleLine, getConsoleHistory, sendConsoleCommand, seqOf, stripAnsi } from "../api/console";
import { HubConnection, type HubStatus } from "../api/hub";
import { getShardState } from "../api/shards";
import { ApplicationState, type ShardState, stateLabel, stateTone } from "../api/types";
import { StatusBadge, toneStatus } from "../components/AmpBanner";
import { Backdrop } from "../components/backdrop";
import { AppPage, ErrorText } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";
import { privIps } from "../lib/privacy";

/** How many lines the console keeps in memory. */
const MAX_LINES = 3_000;
/** Without the live hub, look for new lines this often. */
const FALLBACK_POLL_MS = 5_000;

/**
 * A shard's console: history from the REST API, new lines live over the shard hub
 * (falling back to polling the history when the hub can't be reached), and a command box.
 */
export function ConsoleScreen(props: { serverId: string; id: string; title: string; tenantId?: string }) {
  const serverUrl = serverById(props.serverId)?.serverUrl ?? "";
  const lines = signal<ConsoleLine[]>([]);
  const hasMore = signal(false);
  const loadingOlder = signal(false);
  const live = signal<HubStatus>("connecting");
  const state = signal<ShardState | null>(null);
  const error = signal<string | null>(null);
  const command = signal("");
  const sending = signal(false);
  let list: ListRef | undefined;

  /** Merges lines in by `seq`, oldest first, keeping the newest `MAX_LINES`. */
  const merge = (incoming: ConsoleLine[]) => {
    if (!incoming.length) return;
    const bySeq = new Map<number, ConsoleLine>();
    for (const line of lines()) bySeq.set(seqOf(line), line);
    for (const line of incoming) bySeq.set(seqOf(line), line);
    const merged = [...bySeq.values()].sort((a, b) => seqOf(a) - seqOf(b));
    lines.set(merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged);
  };

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set("Your account doesn't have permission to use this console.");
    } else {
      error.set((e as Error).message);
    }
  };

  const loadNewest = async () => {
    try {
      const client = clientFor(props.serverId);
      const [page, s] = await Promise.all([getConsoleHistory(client, props.id), getShardState(client, props.id).catch(() => state())]);
      if (lines().length === 0) hasMore.set(page.hasMore);
      merge(page.lines);
      state.set(s);
      error.set(null);
    } catch (e) {
      await fail(e);
    }
  };

  const loadOlder = async () => {
    const first = lines()[0];
    if (!first || !hasMore() || loadingOlder()) return;
    loadingOlder.set(true);
    try {
      const page = await getConsoleHistory(clientFor(props.serverId), props.id, { beforeSeq: seqOf(first) });
      hasMore.set(page.hasMore);
      merge(page.lines);
    } catch (e) {
      await fail(e);
    } finally {
      loadingOlder.set(false);
    }
  };

  // While the page shows and the app is visible: the live hub, and polling until it is up.
  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "console" && top.id === props.id;
  };
  effect(() => {
    if (lifecycle() === "background" || !onTop()) return;
    loadNewest();

    const hub = new HubConnection({
      baseUrl: serverUrl,
      path: "/hubs/shard",
      ticket: async () => (await hubToken(clientFor(props.serverId))).token,
      onStatus: (status) => live.set(status),
      onConnected: async (h) => {
        const tenant = props.tenantId ?? state()?.tenantId;
        if (tenant) await h.invoke("JoinShard", tenant, props.id);
        // Catch up on anything said while the hub was down.
        loadNewest();
      },
    });
    hub.on("ConsoleLine", (line) => {
      // Only well-formed lines for this instance: a line without its shard's id could be anyone's.
      if (!line || typeof line !== "object") return;
      const l = line as ConsoleLine;
      if (typeof l.shardId !== "string" || l.shardId.toLowerCase() !== props.id.toLowerCase()) return;
      if (!Number.isFinite(seqOf(l))) return;
      merge([l]);
    });
    hub.on("ShardStateChanged", (_, shardId, s) => {
      if (String(shardId).toLowerCase() === props.id.toLowerCase()) state.set(s as ShardState);
    });
    hub.start();

    const timer = setInterval(() => {
      if (live() !== "connected") loadNewest();
    }, FALLBACK_POLL_MS);

    cleanup(() => {
      clearInterval(timer);
      hub.stop();
    });
  });

  const send = async () => {
    const text = command().trim();
    if (!text || sending()) return;
    sending.set(true);
    try {
      // An instance waiting on input (a Steam Guard code) gets a prompt reply, never audited in the clear.
      const promptReply = state()?.status === ApplicationState.AwaitingUserAction;
      await sendConsoleCommand(clientFor(props.serverId), props.id, text, promptReply);
      command.set("");
      if (live() !== "connected") setTimeout(() => onTop() && loadNewest(), 1_000);
      list?.scrollToEnd({ animated: true });
    } catch (e) {
      await fail(e);
    } finally {
      sending.set(false);
    }
  };

  const liveBadge = () =>
    live() === "connected"
      ? { label: "Live", status: "online" as const }
      : live() === "closed"
        ? { label: "Offline", status: "offline" as const }
        : { label: "Polling", status: "warning" as const };

  return (
    <AppPage title={`${props.title} console`}>
      <View class="flex-1 bg-background">
        <Backdrop dim="strong" />

        <View class="flex-row flex-wrap items-center gap-2 border-b border-white/10 bg-card/70 px-4 py-2.5">
          <Text class="flex-1 text-base font-semibold text-foreground">{props.title}</Text>
          <If when={state()}>{(s) => <StatusBadge label={stateLabel(s())} status={toneStatus(stateTone(s()))} />}</If>
          <StatusBadge label={liveBadge().label} status={liveBadge().status} />
        </View>

        <If when={error()}>
          {(m) => (
            <View class="px-4 pt-3">
              <ErrorText message={m()} />
            </View>
          )}
        </If>

        <List
          ref={(r: ListRef) => (list = r)}
          each={lines()}
          keyExtractor={(l) => String(l.seq ?? `${l.timestamp}-${l.text}`)}
          estimatedItemSize={18}
          initialScrollAtEnd
          maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 60 }}
          onLoadMoreAtStart={loadOlder}
          header={
            <View class="items-center py-2">
              <Text class="text-xs text-muted-foreground">
                {loadingOlder() ? "Loading older lines…" : hasMore() ? "Scroll up for older lines" : lines().length ? "Start of history" : ""}
              </Text>
            </View>
          }
          empty={
            <View class="items-center p-8">
              <Text class="text-sm text-muted-foreground">No console output yet.</Text>
            </View>
          }
          class="flex-1"
        >
          {(line) => <ConsoleRow line={line()} />}
        </List>

        <View class="flex-row items-center gap-2 border-t border-white/10 bg-card/90 px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] mb-[env(keyboard-inset-height)]">
          <Text class="font-mono text-base text-primary">›</Text>
          <View class="flex-1 rounded-lg border border-input bg-background px-3 py-2">
            <Input
              testID="command"
              value={command()}
              onChange={({ value }) => command.set(value)}
              onSubmit={send}
              submitBehavior="submit"
              returnKeyType="send"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={state()?.status === ApplicationState.AwaitingUserAction ? "Reply to the prompt…" : "Type a command…"}
              class="p-0 font-mono text-sm text-foreground placeholder:text-muted-foreground"
            />
          </View>
          <View
            role="button"
            onPress={send}
            class={`rounded-lg px-4 py-2 ${command().trim() && !sending() ? "bg-linear-to-r from-hero-from to-hero-to active:opacity-85" : "bg-muted"}`}
          >
            <Text class={`text-sm font-semibold ${command().trim() && !sending() ? "text-white" : "text-muted-foreground"}`}>Send</Text>
          </View>
        </View>
      </View>
    </AppPage>
  );
}

function clock(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** One console line, coloured by its kind and log level; lifecycle markers as dividers. */
function ConsoleRow(props: { line: ConsoleLine }) {
  // Players' IPs often show in join lines: hidden with the other personal details.
  const text = () => privIps(stripAnsi(props.line.text));
  const isMarker = () => props.line.kind === "marker";
  const isInput = () => props.line.streamId === "input";
  const colour = () => {
    const level = props.line.level?.toLowerCase() ?? "";
    switch (props.line.kind) {
      case "error":
        return "text-rose-400";
      case "notice":
        return "text-amber-300";
      case "info":
        return "text-sky-300";
    }
    if (isInput()) return "text-primary";
    if (/err|fatal|crit|severe/.test(level)) return "text-rose-400";
    if (/warn/.test(level)) return "text-amber-300";
    if (/debug|trace|verbose/.test(level)) return "text-muted-foreground";
    return "text-foreground/90";
  };

  return (
    <If
      when={!isMarker()}
      else={
        <View class="flex-row items-center gap-2 px-3 py-2">
          <View class="h-px flex-1 bg-primary/40" />
          <Text class="text-xs font-semibold text-primary">
            {props.line.state != null ? stateLabel({ status: props.line.state }) : text()}
          </Text>
          <View class="h-px flex-1 bg-primary/40" />
        </View>
      }
    >
      <View selectable class="flex-row gap-2 px-3 py-px">
        <Text class="font-mono text-[11px] leading-5 text-muted-foreground/70">{clock(props.line.timestamp)}</Text>
        <Text class={`flex-1 font-mono text-xs leading-5 ${colour()}`}>
          {isInput() ? `› ${text()}` : text()}
        </Text>
      </View>
    </If>
  );
}
