import { openUrl, signal, Text, View } from "nsh";
import {
  duration,
  flag,
  getProfiles,
  getUserDetail,
  type MinecraftProfile,
  num,
  type ServerUsage,
  type SessionView,
  type SteamProfile,
  type UserDetail,
} from "../api/analytics";
import { AmpError } from "../api/client";
import { ago, clockOf, DemoNotice, dayOf, PeriodPicker, type PeriodId, periodOf, Section, ShareRow } from "../components/analyticsUi";
import { Avatar } from "../components/Avatar";
import { Screen } from "../components/backdrop";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Pill, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clearServerSession, clientFor } from "../state/servers";

/** One player: who they are on Steam or Minecraft, their totals, where and when they played. */
export function PlayerScreen(props: { serverId: string; userKey: string; name?: string | null; shardId?: string }) {
  const period = signal<PeriodId>("30d");
  const detail = signal<UserDetail | null>(null);
  const steam = signal<SteamProfile | null>(null);
  const minecraft = signal<MinecraftProfile | null>(null);
  const error = signal<string | null>(null);
  const refreshing = signal(false);
  let loadId = 0;

  const client = () => {
    try {
      return clientFor(props.serverId);
    } catch {
      return null;
    }
  };

  const load = async () => {
    const id = ++loadId;
    try {
      const c = clientFor(props.serverId);
      const result = await getUserDetail(c, props.userKey, { ...periodOf(period()), shards: props.shardId ? [props.shardId] : undefined });
      if (id !== loadId) return;
      detail.set(result);
      error.set(null);
      if (!result.isDemo && !steam() && !minecraft()) {
        getProfiles(c, [props.userKey])
          .then((p) => {
            steam.set(p.steam?.[props.userKey] ?? null);
            minecraft.set(p.minecraft?.[props.userKey] ?? null);
          })
          .catch(() => {});
      }
    } catch (e) {
      if (id !== loadId) return;
      if (e instanceof AmpError && e.isUnauthorized) {
        await clearServerSession(props.serverId);
        nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
        return;
      }
      error.set(
        e instanceof AmpError && e.status === 403
          ? "Your AMP account can't see individual players. It needs the analytics users permission."
          : (e as Error).message,
      );
    }
  };
  load();

  const choosePeriod = (p: PeriodId) => {
    period.set(p);
    load();
  };
  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const d = () => detail();
  const name = () => steam()?.personaName ?? minecraft()?.name ?? d()?.displayName ?? props.name ?? "Unnamed player";
  const serverName = (id: string) => d()?.serverInfo?.[id]?.name ?? "Instance";
  const online = () => d()?.sessions.some((s) => s.running) ?? false;
  const bans = () => {
    const b = steam()?.bans;
    if (!b) return [];
    const out: string[] = [];
    if (b.vacBanned) out.push(b.vacBans ? `${b.vacBans} VAC ban${b.vacBans === 1 ? "" : "s"}` : "VAC banned");
    if (b.gameBans) out.push(`${b.gameBans} game ban${b.gameBans === 1 ? "" : "s"}`);
    if (b.communityBanned) out.push("Community banned");
    if (b.tradeBanned) out.push("Trade banned");
    return out;
  };

  return (
    <AppPage title={name()} subtitle="Player" right={<MainMenu serverId={props.serverId} current="analytics" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-4xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
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
          <If when={!error() && !d()}>
            <Text class="text-muted-foreground">Loading player…</Text>
          </If>

          <If when={d()}>
            <If when={d()!.isDemo}>
              <DemoNotice />
            </If>

            <View class="flex-row items-center gap-4 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
              <Avatar client={client()} hash={steam()?.avatarHash} name={name()} size="lg" />
              <View class="flex-1 gap-1.5">
                <Text class="text-xl font-bold text-card-foreground">{name()}</Text>
                <View class="flex-row flex-wrap gap-1.5">
                  <If when={online()}>
                    <Pill label="Online now" tone="success" />
                  </If>
                  <Pill label={d()!.isActive ? "Active player" : "Not active"} tone={d()!.isActive ? "success" : "muted"} />
                  <Each of={bans()}>{(b) => <Pill label={b()} tone="danger" />}</Each>
                  <If when={steam()?.limited}>
                    <Pill label="Limited account" tone="warning" />
                  </If>
                </View>
                <Text class="text-xs text-muted-foreground">
                  {`First seen ${ago(d()!.firstSeen)} · last seen ${online() ? "now" : ago(d()!.lastSeen)}`}
                </Text>
              </View>
            </View>

            <If when={steam()?.profileUrl}>
              {(url) => (
                <View class="flex-row">
                  <SecondaryButton title="Open Steam profile" testID="steam-profile" onPress={() => openUrl(url())} />
                </View>
              )}
            </If>

            <PeriodPicker value={period()} onChange={choosePeriod} />

            <View class="flex-row flex-wrap justify-between gap-y-3">
              <Figure label="Play time" value={duration(d()!.totals.minutes)} accent="text-emerald-300" />
              <Figure label="Sessions" value={d()!.totals.sessions.toLocaleString()} accent="text-sky-300" />
              <Figure label="Avg session" value={duration(d()!.totals.averageSessionMinutes)} accent="text-amber-300" />
              <Figure label="Longest" value={duration(d()!.totals.longestSessionMinutes)} accent="text-pink-300" />
            </View>
            <Text class="-mt-1 text-xs text-muted-foreground">
              {`${d()!.recentVisits} visit${d()!.recentVisits === 1 ? "" : "s"} in the last ${num(d()!.rule?.days)} days; active means ${num(d()!.rule?.visits)} or more.`}
            </Text>

            <If when={d()!.servers.length > 1}>
              <Section title="Where they play" note="share of play time">
                <Each of={d()!.servers} key={(v: ServerUsage) => v.shardId}>
                  {(v) => (
                    <ShareRow
                      icon="🎮"
                      label={serverName(v().shardId)}
                      detail={`${v().sessions} sessions`}
                      value={duration(v().minutes)}
                      percent={v().minutesPercent}
                      barClass="bg-violet-400"
                    />
                  )}
                </Each>
              </Section>
            </If>

            <Section title="Sessions" note="newest first">
              <If when={d()!.sessions.length === 0}>
                <Text class="text-sm text-muted-foreground">No sessions in this period.</Text>
              </If>
              <Each of={d()!.sessions.slice(0, 100)} key={(s: SessionView) => s.sessionRef}>
                {(s) => <SessionRow session={s()} server={serverName(s().shardId)} showServer={d()!.servers.length > 1} />}
              </Each>
              <If when={d()!.sessions.length > 100}>
                <Text class="text-xs text-muted-foreground">{`Showing the newest 100 of ${d()!.sessions.length}.`}</Text>
              </If>
            </Section>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

function Figure(props: { label: string; value: string; accent: string }) {
  return (
    <View class="w-[48%] gap-1 rounded-(--radius) border border-white/10 bg-card/85 p-3.5 shadow-lg md:w-[23.5%]">
      <Text class={`text-[11px] font-semibold tracking-wider ${props.accent}`}>{props.label.toUpperCase()}</Text>
      <Text class="text-2xl font-bold text-card-foreground tabular-nums">{props.value}</Text>
    </View>
  );
}

function SessionRow(props: { session: SessionView; server: string; showServer: boolean }) {
  const start = () => new Date(props.session.startedAt);
  const minutes = () => {
    const end = props.session.running ? Date.now() : Date.parse(props.session.endedAt);
    return Math.max(0, (end - start().getTime()) / 60_000);
  };
  return (
    <View class="flex-row items-center gap-3 border-b border-white/5 py-1.5">
      <Text class="text-lg">{flag(props.session.country)}</Text>
      <View class="flex-1">
        <Text class="text-sm font-semibold text-card-foreground">{`${dayOf(start())}, ${clockOf(start())}`}</Text>
        <If when={props.showServer}>
          <Text class="line-clamp-1 text-xs text-muted-foreground">{props.server}</Text>
        </If>
      </View>
      <If when={props.session.running} else={<Text class="text-sm text-card-foreground tabular-nums">{duration(minutes())}</Text>}>
        <Pill label={`Online · ${duration(minutes())}`} tone="success" />
      </If>
    </View>
  );
}
