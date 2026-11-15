import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  type CountryUsage,
  duration,
  type GameUsage,
  type ServerUsage,
  type TopUser,
  flag,
  getProfiles,
  getSessionSummary,
  num,
  type ProfilesAnswer,
  searchUsers,
  type SessionSummary,
  type UserMatch,
} from "../api/analytics";
import { AmpError } from "../api/client";
import {
  ago,
  clockOf,
  DemoNotice,
  dayOf,
  momentOf,
  PeriodPicker,
  type PeriodId,
  periodOf,
  Section,
  ShareRow,
  StatTile,
} from "../components/analyticsUi";
import { Avatar } from "../components/Avatar";
import { Screen } from "../components/backdrop";
import { MainMenu } from "../components/MainMenu";
import { MetricChart } from "../components/MetricChart";
import { AppPage, ErrorText, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";
import { PrivText, priv } from "../lib/privacy";

/** Who plays on a server (or one instance): headline figures, activity, countries, top players. */
export function AnalyticsScreen(props: { serverId: string; shardId?: string; title?: string }) {
  const server = serverById(props.serverId);
  const period = signal<PeriodId>("7d");
  const summary = signal<SessionSummary | null>(null);
  const profiles = signal<ProfilesAnswer | null>(null);
  const error = signal<string | null>(null);
  const loading = signal(false);
  const refreshing = signal(false);
  const query = signal("");
  const matches = signal<UserMatch[] | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let loadId = 0;

  const client = () => {
    try {
      return clientFor(props.serverId);
    } catch {
      return null;
    }
  };

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
      return;
    }
    error.set(
      e instanceof AmpError && e.status === 403
        ? "Your AMP account can't see analytics. An admin can give your role the analytics permission on this server."
        : (e as Error).message,
    );
  };

  const load = async () => {
    const id = ++loadId;
    loading.set(true);
    try {
      const c = clientFor(props.serverId);
      const result = await getSessionSummary(c, { ...periodOf(period()), shards: props.shardId ? [props.shardId] : undefined });
      if (id !== loadId) return;
      summary.set(result);
      error.set(null);
      // Pictures for the top players; analytics works without them.
      const keys = result.topUsers.map((u) => u.userKey);
      if (keys.length && !result.isDemo) {
        getProfiles(c, keys)
          .then((p) => id === loadId && profiles.set(p))
          .catch(() => {});
      }
    } catch (e) {
      if (id === loadId) await fail(e);
    } finally {
      if (id === loadId) loading.set(false);
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

  const search = (text: string) => {
    query.set(text);
    clearTimeout(searchTimer);
    const q = text.trim();
    if (q.length < 2) {
      matches.set(null);
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const result = await searchUsers(clientFor(props.serverId), q);
        if (query().trim() !== q) return;
        matches.set(props.shardId ? result.users.filter((u) => u.shards.includes(props.shardId!)) : result.users);
      } catch (e) {
        matches.set([]);
        await fail(e);
      }
    }, 350);
  };

  const openPlayer = (userKey: string, name?: string | null) =>
    nav.push({ name: "player", serverId: props.serverId, userKey, playerName: name, shardId: props.shardId });

  const s = () => summary();
  const cur = () => s()!.current;
  const change = (key: string) => s()?.change?.[key];
  const serverName = (id: string) => s()?.serverInfo?.[id]?.name ?? "Instance";
  const showsDays = () => period() !== "24h";
  const activity = () => (s()?.activity ?? []).map((b) => ({ t: Date.parse(b.start), value: b.users }));
  const peak = () => Math.max(0, ...(s()?.activity ?? []).map((b) => b.users));
  const steamHash = (key: string) => profiles()?.steam?.[key]?.avatarHash ?? null;
  const ruleText = () => {
    const r = s()?.rule;
    return r ? `${num(r.visits)}+ visits in ${num(r.days)} days` : undefined;
  };

  const title = props.title ? `${props.title} analytics` : "Analytics";
  const subtitle = props.shardId ? "Players on this instance" : (server?.name ?? "");

  return (
    <AppPage title={title} subtitle={subtitle} right={<MainMenu serverId={props.serverId} current="analytics" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-6xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <View class="flex-row flex-wrap items-center justify-between gap-3">
            <PeriodPicker value={period()} onChange={choosePeriod} />
            <If when={loading() && s()}>
              <Text class="text-xs text-muted-foreground">Updating…</Text>
            </If>
          </View>

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
            <Text class="text-muted-foreground">Loading analytics…</Text>
          </If>

          <If when={s()}>
            <If when={s()!.isDemo}>
              <DemoNotice />
            </If>

            <View class="flex-row flex-wrap justify-between gap-y-3">
              <StatTile label="Players" value={cur().uniqueUsers.toLocaleString()} change={change("uniqueUsers")} accent="text-violet-300" />
              <StatTile label="New players" value={cur().newUsers.toLocaleString()} change={change("newUsers")} accent="text-pink-300" />
              <StatTile label="Sessions" value={cur().sessions.toLocaleString()} change={change("sessions")} accent="text-sky-300" />
              <StatTile label="Play time" value={duration(cur().minutes)} change={change("minutes")} accent="text-emerald-300" />
              <StatTile
                label="Avg session"
                value={duration(cur().averageSessionMinutes)}
                change={change("averageSessionMinutes")}
                accent="text-amber-300"
              />
              <StatTile label="Longest" value={duration(cur().longestSessionMinutes)} change={change("longestSessionMinutes")} accent="text-amber-300" />
              <StatTile
                label="Bounce rate"
                value={`${num(cur().bounceRatePercent).toFixed(0)}%`}
                change={change("bounceRatePercent")}
                goodWhenUp={false}
                accent="text-rose-300"
              />
              <StatTile label="Active players" value={cur().activeUsers.toLocaleString()} change={change("activeUsers")} accent="text-cyan-300" />
            </View>
            <If when={ruleText()}>
              {(r) => (
                <Text class="-mt-1 text-xs text-muted-foreground">
                  {`Compared with the ${period() === "24h" ? "day" : "period"} before. Active means ${r()}. Bounce: left within a minute.`}
                </Text>
              )}
            </If>

            <MetricChart
              title="Players online"
              points={activity()}
              format={(v) => `${Math.round(v)}`}
              caption={`peak ${peak()}`}
              curve="stepAfter"
              formatTime={(t) => (showsDays() ? `${dayOf(new Date(t))} ${clockOf(new Date(t))}` : clockOf(new Date(t)))}
              titleClass="text-emerald-400"
              lineClass="stroke-emerald-400 stroke-2"
              areaClass="fill-emerald-400/15"
              dotClass="size-2.5 rounded-full border-2 border-background bg-emerald-400"
            />
            <If when={s()!.busiest || s()!.quietest}>
              <View class="flex-row gap-3">
                <If when={s()!.busiest}>
                  {(b) => (
                    <View class="flex-1 gap-0.5 rounded-(--radius) border border-white/10 bg-card/85 p-3.5">
                      <Text class="text-[11px] font-semibold tracking-wider text-emerald-300">BUSIEST</Text>
                      <Text class="text-sm font-semibold text-card-foreground">{momentOf(new Date(b().start))}</Text>
                      <Text class="text-xs text-muted-foreground">{`${b().users} online`}</Text>
                    </View>
                  )}
                </If>
                <If when={s()!.quietest}>
                  {(q) => (
                    <View class="flex-1 gap-0.5 rounded-(--radius) border border-white/10 bg-card/85 p-3.5">
                      <Text class="text-[11px] font-semibold tracking-wider text-sky-300">QUIETEST</Text>
                      <Text class="text-sm font-semibold text-card-foreground">{momentOf(new Date(q().start))}</Text>
                      <Text class="text-xs text-muted-foreground">{`${q().users} online`}</Text>
                    </View>
                  )}
                </If>
              </View>
            </If>

            <View class="gap-4 lg:flex-row lg:items-start">
              <View class="gap-4 lg:flex-1">
                <Section title="Top players" note="by play time">
                  <View class="flex-row items-center gap-2 rounded-lg border border-input bg-background px-3 py-2.5">
                    <Text class="text-sm text-muted-foreground">🔍</Text>
                    <Input
                      testID="player-search"
                      value={query()}
                      onChange={({ value }) => search(value)}
                      placeholder="Find a player by name or SteamID"
                      autoCapitalize="none"
                      autoCorrect={false}
                      class="flex-1 p-0 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                  </View>
                  <If
                    when={matches()}
                    else={
                      <>
                        <If when={s()!.topUsers.length === 0}>
                          <Text class="text-sm text-muted-foreground">Nobody played in this period.</Text>
                        </If>
                        <Each of={s()!.topUsers} key={(u: TopUser) => u.userKey}>
                          {(u) => (
                            <View
                              role="button"
                              testID={`player-${u().displayName ?? u().userKey}`}
                              onPress={() => openPlayer(u().userKey, u().displayName)}
                              class="flex-row items-center gap-3 rounded-lg py-1 active:bg-accent"
                            >
                              <Avatar client={client()} hash={steamHash(u().userKey)} name={u().displayName ?? "?"} />
                              <View class="flex-1">
                                <View class="flex-row items-center gap-1.5">
                                  <PrivText class="line-clamp-1 text-sm font-semibold text-card-foreground" text={priv(u().displayName ?? "Unnamed player")} />
                                  <If when={u().online}>
                                    <View class="h-2 w-2 rounded-full bg-success" />
                                  </If>
                                </View>
                                <Text class="text-xs text-muted-foreground">
                                  {`${u().sessions} session${u().sessions === 1 ? "" : "s"}${u().servers > 1 ? ` · ${u().servers} servers` : ""}`}
                                </Text>
                              </View>
                              <View class="items-end">
                                <Text class="text-sm font-semibold text-card-foreground tabular-nums">{duration(u().minutes)}</Text>
                                <Text class="text-xs text-muted-foreground tabular-nums">{`${num(u().percent).toFixed(0)}%`}</Text>
                              </View>
                              <Text class="text-lg text-muted-foreground">›</Text>
                            </View>
                          )}
                        </Each>
                      </>
                    }
                  >
                    {(found) => (
                      <>
                        <If when={found().length === 0}>
                          <Text class="text-sm text-muted-foreground">No players match.</Text>
                        </If>
                        <Each of={found()} key={(u: UserMatch) => u.userKey}>
                          {(u) => (
                            <View
                              role="button"
                              testID={`match-${u().displayName ?? u().userKey}`}
                              onPress={() => openPlayer(u().userKey, u().displayName)}
                              class="flex-row items-center gap-3 rounded-lg py-1 active:bg-accent"
                            >
                              <Avatar client={client()} name={u().displayName ?? "?"} />
                              <View class="flex-1">
                                <PrivText class="line-clamp-1 text-sm font-semibold text-card-foreground" text={priv(u().displayName ?? u().userId ?? "Unnamed player")} />
                                <Text class="text-xs text-muted-foreground">{`Last seen ${ago(u().lastSeen)}`}</Text>
                              </View>
                              <Text class="text-lg text-muted-foreground">›</Text>
                            </View>
                          )}
                        </Each>
                      </>
                    )}
                  </If>
                </Section>
              </View>

              <View class="gap-4 lg:flex-1">
                <Section title="Countries" note="share of play time">
                  <If when={s()!.countries.length === 0}>
                    <Text class="text-sm text-muted-foreground">No sessions in this period.</Text>
                  </If>
                  <Each of={s()!.countries.slice(0, 8)} key={(c: CountryUsage) => c.country}>
                    {(c) => (
                      <ShareRow
                        icon={flag(c().country)}
                        label={c().country ? c().country.toUpperCase() : "Unknown"}
                        detail={`${c().sessions} session${c().sessions === 1 ? "" : "s"}${c().users != null ? ` · ${c().users} players` : ""}`}
                        value={duration(c().minutes)}
                        percent={c().minutesPercent}
                        barClass="bg-sky-400"
                      />
                    )}
                  </Each>
                </Section>

                <If when={!props.shardId && s()!.servers.length > 1}>
                  <Section title="Instances" note="share of play time">
                    <Each of={s()!.servers} key={(v: ServerUsage) => v.shardId}>
                      {(v) => (
                        <ShareRow
                          icon="🎮"
                          label={serverName(v().shardId)}
                          detail={`${v().users} players · ${v().sessions} sessions`}
                          value={duration(v().minutes)}
                          percent={v().minutesPercent}
                          barClass="bg-violet-400"
                          testID={`usage-${serverName(v().shardId)}`}
                          onPress={() =>
                            nav.push({ name: "analytics", serverId: props.serverId, shardId: v().shardId, title: serverName(v().shardId) })
                          }
                        />
                      )}
                    </Each>
                  </Section>
                </If>

                <If when={!props.shardId && s()!.games.length > 1}>
                  <Section title="Games" note="share of play time">
                    <Each of={s()!.games} key={(g: GameUsage) => g.game}>
                      {(g) => (
                        <ShareRow
                          icon="🕹️"
                          label={Object.values(s()!.serverInfo ?? {}).find((i) => i.game === g().game)?.gameName ?? g().game}
                          detail={`${g().users} players on ${g().servers} instance${g().servers === 1 ? "" : "s"}`}
                          value={duration(g().minutes)}
                          percent={g().minutesPercent}
                          barClass="bg-pink-400"
                        />
                      )}
                    </Each>
                  </Section>
                </If>
              </View>
            </View>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}
