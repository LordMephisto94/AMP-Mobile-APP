import { type JSX, openUrl, signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import { splitCategory } from "../api/manage";
import { panelText } from "../api/panelText";
import {
  applyUpdate,
  changePassword,
  checkForUpdates,
  deviceName,
  getLicence,
  getProfile,
  getSettingsManifest,
  keyLabel,
  type LicenceStatus,
  listSessions,
  type PlatformSettingSpec,
  type Profile,
  revokeOtherSessions,
  revokeSession,
  runSettingsAction,
  saveSettings,
  type Session,
  type SettingsManifest,
  type UpdateStatus,
} from "../api/settings";
import { ago } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Field, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clearServerSession, clientFor, serverById } from "../state/servers";
import { SettingRow } from "./ShardSettingsScreen";

interface Group {
  key: string;
  name: string;
  icon: string | null;
  specs: PlatformSettingSpec[];
  actions: string[];
}

type Part<T> = { value: T } | { denied: true } | { error: string } | null;

async function part<T>(promise: Promise<T>): Promise<Part<T>> {
  try {
    return { value: await promise };
  } catch (e) {
    if (e instanceof AmpError && e.isUnauthorized) throw e;
    if (e instanceof AmpError && e.status === 403) return { denied: true };
    return { error: (e as Error).message };
  }
}
const valueOf = <T,>(p: Part<T>): T | null => (p && "value" in p ? p.value : null);

/** The panel's settings, updates, licence, and your own account. */
export function SettingsScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const text = signal<Record<string, string>>({});
  const manifest = signal<Part<SettingsManifest>>(null);
  const updates = signal<Part<UpdateStatus>>(null);
  const licence = signal<Part<LicenceStatus>>(null);
  const profile = signal<Profile | null>(null);
  const sessions = signal<Session[] | null>(null);
  const edits = signal<Record<string, string>>({});
  const openGroups = signal<string[]>([]);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const saving = signal(false);
  const refreshing = signal(false);

  const client = () => clientFor(props.serverId);

  const fail = async (e: unknown, denied = "Your AMP account isn't allowed to do that.") => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await clearServerSession(props.serverId);
      nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId: props.serverId }]);
      return;
    }
    error.set(e instanceof AmpError && e.status === 403 ? denied : (e as Error).message);
  };

  const loadAccount = async () => {
    getProfile(client()).then((p) => profile.set(p)).catch(() => {});
    listSessions(client()).then((s) => sessions.set(s)).catch(() => sessions.set([]));
  };

  const load = async () => {
    try {
      panelText(client()).then((t) => text.set(t));
      loadAccount();
      const [m, l] = await Promise.all([part(getSettingsManifest(client())), part(getLicence(client()))]);
      manifest.set(m);
      licence.set(l);
      // The update check fetches the release list from the internet; it arrives on its own.
      part(checkForUpdates(client())).then((u) => updates.set(u));
    } catch (e) {
      await fail(e);
    }
  };
  load();

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  /** A wording key from the manifest, in the panel's words. */
  const tr = (key: string | undefined) => {
    if (!key) return "";
    const found = text()[key];
    if (found) return found;
    return /^[\w-]+(\.[\w-]+)+$/.test(key) ? keyLabel(key) : key;
  };

  // ---- Panel settings ----------------------------------------------------------------------
  const m = () => valueOf(manifest());
  const stored = (node: string) => m()?.values?.[node] ?? "";
  const current = (node: string) => edits()[node] ?? stored(node);
  // Checkbox values come as "True"/"true" depending on who wrote them, so compare without case.
  const visible = (s: PlatformSettingSpec) =>
    !s.hidden && (!s.conditionSetting || current(s.conditionSetting).toLowerCase() === (s.conditionValue ?? "").toLowerCase());
  const groups = () => {
    const out: Group[] = [];
    for (const spec of (m()?.specs ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      if (!visible(spec)) continue;
      const key = spec.category || "General";
      let g = out.find((x) => x.key === key);
      if (!g) {
        const { name, icon } = splitCategory(spec.category);
        g = { key, name: tr(name) || "General", icon, specs: [], actions: [] };
        out.push(g);
      }
      g.specs.push(spec);
    }
    for (const a of m()?.actions ?? []) out.find((g) => g.key === a.category)?.actions.push(a.id);
    return out;
  };
  const setValue = (node: string, value: string) => {
    const next = { ...edits() };
    if (value === stored(node)) delete next[node];
    else next[node] = value;
    edits.set(next);
    notice.set(null);
  };
  const changeCount = () => Object.keys(edits()).length;
  const editsIn = (g: { specs: PlatformSettingSpec[] }) => g.specs.filter((s) => s.fieldName in edits()).length;
  const toggleGroup = (key: string) => openGroups.set(openGroups().includes(key) ? openGroups().filter((k) => k !== key) : [...openGroups(), key]);

  const save = async () => {
    saving.set(true);
    error.set(null);
    try {
      const notices = await saveSettings(client(), edits());
      edits.set({});
      manifest.set(await part(getSettingsManifest(client())));
      notice.set(notices.length ? `Saved, but: ${notices.map((n) => (n.code ? tr(n.code) : n.message)).join(" ")}` : "Saved.");
    } catch (e) {
      await fail(e, "Your AMP account can't change some of these settings.");
    } finally {
      saving.set(false);
    }
  };

  const runAction = async (id: string) => {
    error.set(null);
    notice.set(null);
    try {
      const result = await runSettingsAction(client(), id);
      const said = result && typeof result === "object" ? ((result as { message?: string }).message ?? null) : typeof result === "string" ? result : null;
      notice.set(said ? `${actionLabel(id)}: ${said}` : `${actionLabel(id)}: done.`);
    } catch (e) {
      await fail(e);
    }
  };
  const actionLabel = (id: string) => text()[`settings.actions.${id}`] || text()[`settings.action.${id}`] || keyLabel(id.replace(/\./g, " ").replace(/ /g, "_"));

  // ---- Updates -------------------------------------------------------------------------------
  const update = async () => {
    const u = valueOf(updates());
    if (!u) return;
    const choice = await confirm({
      title: `Update AMP to ${u.latestVersion}?`,
      message:
        "AMP downloads it, moves every machine to it and restarts the panel. Game servers keep running, but the panel and this app lose touch for a minute or two.",
      icon: "⬆️",
      tone: "danger",
      actions: [{ id: "go", label: "Update now", tone: "danger" }],
    });
    if (choice !== "go") return;
    try {
      await applyUpdate(client());
      notice.set("Update started. The panel restarts when it's ready; pull down to refresh in a few minutes.");
    } catch (e) {
      await fail(e, "Your AMP account can't apply updates.");
    }
  };

  // ---- Your account -----------------------------------------------------------------------
  const showPassword = signal(false);
  const currentPw = signal("");
  const newPw = signal("");
  const repeatPw = signal("");
  const pwError = signal<string | null>(null);

  const submitPassword = async () => {
    pwError.set(null);
    if (!currentPw() || !newPw()) return pwError.set("Fill in both passwords.");
    if (newPw() !== repeatPw()) return pwError.set("The new passwords don't match.");
    try {
      await changePassword(client(), currentPw(), newPw());
      currentPw.set("");
      newPw.set("");
      repeatPw.set("");
      showPassword.set(false);
      notice.set("Password changed. Your other sessions were signed out.");
      loadAccount();
    } catch (e) {
      if (e instanceof AmpError && e.isUnauthorized) await fail(e);
      else pwError.set((e as Error).message);
    }
  };

  const endSession = async (s: Session) => {
    try {
      await revokeSession(client(), s.id);
      loadAccount();
    } catch (e) {
      await fail(e);
    }
  };
  const endOthers = async () => {
    const choice = await confirm({
      title: "Sign out your other sessions?",
      message: "Every browser and device signed in as you, except this app, is signed out.",
      icon: "🚪",
      actions: [{ id: "go", label: "Sign them out", tone: "primary" }],
    });
    if (choice !== "go") return;
    try {
      await revokeOtherSessions(client());
      notice.set("Your other sessions were signed out.");
      loadAccount();
    } catch (e) {
      await fail(e);
    }
  };

  return (
    <AppPage title="Settings" subtitle={server?.name ?? ""} right={<MainMenu serverId={props.serverId} current="settings" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-3xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+96px)]">
          <If when={error()}>{(msg) => <ErrorText message={msg()} />}</If>
          <If when={notice()}>
            {(msg) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text class="text-sm text-success">{msg()}</Text>
              </View>
            )}
          </If>

          {/* Your account */}
          <Card title="Your account">
            <If when={profile()} else={<Text class="text-sm text-muted-foreground">Loading…</Text>}>
              {(p) => (
                <View class="gap-0.5">
                  <Text class="text-base font-semibold text-card-foreground">{p().displayName || p().userName}</Text>
                  <Text class="text-xs text-muted-foreground">{[p().displayName ? p().userName : null, p().email].filter(Boolean).join(" · ")}</Text>
                </View>
              )}
            </If>
            <If
              when={showPassword()}
              else={
                <View class="flex-row">
                  <SecondaryButton testID="change-password" title="Change password" onPress={() => showPassword.set(true)} />
                </View>
              }
            >
              <View class="gap-3">
                <Field testID="current-password" label="Current password" value={currentPw()} onChange={(v) => currentPw.set(v)} masked />
                <Field testID="new-password" label="New password" value={newPw()} onChange={(v) => newPw.set(v)} masked />
                <Field testID="repeat-password" label="New password again" value={repeatPw()} onChange={(v) => repeatPw.set(v)} masked />
                <If when={pwError()}>{(msg) => <Text class="text-sm text-destructive">{msg()}</Text>}</If>
                <View class="flex-row gap-2">
                  <SecondaryButton title="Cancel" onPress={() => (showPassword.set(false), pwError.set(null))} />
                  <SecondaryButton testID="save-password" title="Change it" tone="success" onPress={submitPassword} />
                </View>
              </View>
            </If>

            <Text class="pt-2 text-xs font-semibold tracking-widest text-muted-foreground">SIGNED IN ON</Text>
            <Each of={sessions() ?? []} key={(s: Session) => s.id}>
              {(s) => (
                <View class="flex-row items-center gap-3 border-b border-white/5 py-2">
                  <View class="flex-1">
                    <View class="flex-row flex-wrap items-center gap-1.5">
                      <Text class="text-sm font-semibold text-card-foreground">{deviceName(s().userAgent)}</Text>
                      <If when={s().isCurrent}>
                        <Pill label="This app" tone="success" />
                      </If>
                    </View>
                    <Text class="text-xs text-muted-foreground">{`${s().remoteIp} · active ${ago(s().lastSeenAt)}`}</Text>
                  </View>
                  <If when={!s().isCurrent}>
                    <Text
                      role="button"
                      testID={`end-session-${s().id}`}
                      onPress={() => endSession(s())}
                      class="rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive"
                    >
                      Sign out
                    </Text>
                  </If>
                </View>
              )}
            </Each>
            <If when={(sessions()?.filter((s) => !s.isCurrent).length ?? 0) > 1}>
              <View class="flex-row">
                <SecondaryButton testID="end-other-sessions" title="Sign out all others" onPress={endOthers} />
              </View>
            </If>
          </Card>

          {/* Updates */}
          <Card title="AMP updates">
            <If when={updates() === null}>
              <Text class="text-sm text-muted-foreground">Checking for updates…</Text>
            </If>
            <If when={updates() && "denied" in updates()!}>
              <Text class="text-sm text-muted-foreground">Your account can't check for updates.</Text>
            </If>
            <If when={updates() && "error" in updates()! ? (updates() as { error: string }).error : null}>
              {(e) => <Text class="text-sm text-destructive">{`Couldn't check: ${e()}`}</Text>}
            </If>
            <If when={valueOf(updates())}>
              {(u) => (
                <View class="gap-2">
                  <View class="flex-row flex-wrap items-center gap-2">
                    <Text class="text-base font-semibold text-card-foreground">{`Version ${u().currentVersion}`}</Text>
                    <Pill label={u().stream} tone="muted" />
                    <Pill
                      label={u().updateAvailable ? (u().mandatory ? `${u().latestVersion} required` : `${u().latestVersion} available`) : "Up to date"}
                      tone={u().updateAvailable ? (u().mandatory ? "danger" : "warning") : "success"}
                    />
                  </View>
                  <If when={u().updateAvailable && u().codename}>
                    <Text class="text-sm text-muted-foreground">{`“${u().codename}”`}</Text>
                  </If>
                  <If when={u().note}>{(n) => <Text class="text-xs text-muted-foreground">{tr(n())}</Text>}</If>
                  <If when={u().rolledBack}>
                    {(r) => <Text class="text-xs text-warning">{`${r().version} was tried and rolled back (${r().kind || "unknown reason"}).`}</Text>}
                  </If>
                  <Each of={u().spiresBehind ?? []}>
                    {(s) => <Text class="text-xs text-warning">{`${s().name} is still on ${s().version ?? "an older version"}${s().online ? "" : " (offline)"}.`}</Text>}
                  </Each>
                  <If when={u().packageManaged}>
                    <Text class="text-xs text-muted-foreground">Updates on this machine come from the system's package manager.</Text>
                  </If>
                  <View class="flex-row gap-2">
                    <If when={u().releaseNotesUrl && u().updateAvailable}>
                      <SecondaryButton title="Release notes" onPress={() => openUrl(u().releaseNotesUrl)} />
                    </If>
                    <If when={u().canApply}>
                      <SecondaryButton testID="apply-update" title="Update now" tone="warning" onPress={update} />
                    </If>
                  </View>
                </View>
              )}
            </If>
          </Card>

          {/* Licence */}
          <If when={licence() && !("denied" in licence()!)}>
            <Card title="Licence">
              <If when={licence() && "error" in licence()! ? (licence() as { error: string }).error : null}>
                {(e) => <Text class="text-sm text-destructive">{e()}</Text>}
              </If>
              <If when={valueOf(licence())}>
                {(l) => (
                  <View class="gap-2">
                    <If when={l().licences.length === 0}>
                      <Text class="text-sm text-muted-foreground">No licence activated.</Text>
                    </If>
                    <Each of={l().licences}>
                      {(x) => (
                        <View class="gap-0.5">
                          <View class="flex-row flex-wrap items-center gap-2">
                            <Text class="text-sm font-semibold text-card-foreground">{`${x().productName} ${x().gradeName} Edition`}</Text>
                            <Pill label={x().standing} tone={x().standing === "Active" ? "success" : x().standing === "Grace" ? "warning" : "danger"} />
                          </View>
                          <Text class="text-xs text-muted-foreground">
                            {[x().spireName, x().expires ? `expires ${new Date(x().expires!).toLocaleDateString()}` : "lifetime"].join(" · ")}
                          </Text>
                        </View>
                      )}
                    </Each>
                    <Text class="text-xs text-muted-foreground">
                      {`${l().shardCount} instance${l().shardCount === 1 ? "" : "s"}${l().shardLimit != null ? ` of ${l().shardLimit} allowed` : ""}${l().otherInstallationShards ? ` (+${l().otherInstallationShards} on other installs sharing the key)` : ""}`}
                    </Text>
                  </View>
                )}
              </If>
            </Card>
          </If>

          {/* Panel settings */}
          <Text class="pt-2 text-xs font-semibold tracking-widest text-muted-foreground">PANEL SETTINGS</Text>
          <If when={manifest() === null}>
            <Text class="text-sm text-muted-foreground">Loading settings…</Text>
          </If>
          <If when={manifest() && "denied" in manifest()!}>
            <Text class="text-sm text-muted-foreground">Your AMP account can't see the panel's settings.</Text>
          </If>
          <If when={manifest() && "error" in manifest()! ? (manifest() as { error: string }).error : null}>{(e) => <ErrorText message={e()} />}</If>
          <Each of={groups()} key={(g: Group) => g.key}>
            {(g) => (
              <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg">
                <View role="button" testID={`group-${g().name}`} onPress={() => toggleGroup(g().key)} class="flex-row items-center gap-3 px-4 py-3.5 active:bg-accent">
                  <If when={g().icon}>{(i) => <Text class="text-lg">{i()}</Text>}</If>
                  <Text class="flex-1 text-[15px] font-semibold text-card-foreground">{g().name}</Text>
                  <If when={editsIn(g())}>{(n) => <Pill label={`${n()} edited`} tone="warning" />}</If>
                  <Text class="text-muted-foreground">{openGroups().includes(g().key) ? "▾" : "▸"}</Text>
                </View>
                <If when={openGroups().includes(g().key)}>
                  <View class="gap-4 border-t border-white/10 p-4">
                    <Each of={g().specs} key={(s: PlatformSettingSpec) => s.fieldName}>
                      {(s) => {
                        const blocked = () => m()?.unavailable?.[s().fieldName];
                        const secretSet = () => !!s().isSecret && !!m()?.secretHasValue?.[s().fieldName];
                        return (
                          <SettingRow
                            spec={{ ...s(), readOnly: s().readOnly || !!blocked(), placeholder: secretSet() ? "•••••• (set: type to replace)" : s().placeholder }}
                            label={tr(s().displayName) || s().fieldName}
                            description={blocked() ? tr(blocked()!) : tr(s().description)}
                            options={s().enumValues ? Object.entries(s().enumValues!).map(([k, v]) => [k, tr(v)] as [string, string]) : []}
                            value={current(s().fieldName)}
                            changed={s().fieldName in edits()}
                            onChange={(v) =>
                              // Keep the panel's own spelling of a stored true/false.
                              setValue(s().fieldName, /^(true|false)$/.test(stored(s().fieldName)) && /^(true|false)$/i.test(v) ? v.toLowerCase() : v)
                            }
                          />
                        );
                      }}
                    </Each>
                    <Each of={g().actions}>
                      {(id: () => string) => (
                        <View class="flex-row">
                          <SecondaryButton testID={`action-${id()}`} title={actionLabel(id())} onPress={() => runAction(id())} />
                        </View>
                      )}
                    </Each>
                  </View>
                </If>
              </View>
            )}
          </Each>
        </View>
      </Screen>

      {/* Save bar while panel settings are edited */}
      <If when={changeCount() > 0}>
        <View class="absolute right-0 bottom-0 left-0 flex-row gap-2 border-t border-white/10 bg-card/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <SecondaryButton title="Discard" onPress={() => edits.set({})} />
          <View class="flex-1">
            <PrimaryButton
              title={saving() ? "Saving…" : `Save ${changeCount()} change${changeCount() === 1 ? "" : "s"}`}
              onPress={save}
              disabled={saving()}
            />
          </View>
        </View>
      </If>
    </AppPage>
  );
}

function Card(props: { title: string; children?: JSX.Element }) {
  return (
    <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
      <Text class="text-xs font-semibold tracking-widest text-muted-foreground">{props.title.toUpperCase()}</Text>
      {props.children}
    </View>
  );
}
