import { type JSX, signal, Text, View } from "nsh";
import { type Invite, listInvites, listRoles, listUsers, rearmInvite, revokeInvite, type Role, type User } from "../api/access";
import { AmpError } from "../api/client";
import { ago } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Dropdown, MoreButton } from "../components/Dropdown";
import { MainMenu } from "../components/MainMenu";
import { AppPage, ErrorText, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";
import { InviteLink } from "./InviteScreen";

const REFRESH_MS = 60_000;
type Tab = "users" | "roles" | "invites";

/** A part that may be refused without spoiling the rest. */
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

/** Who can use the panel: accounts, roles and invites. */
export function AccessScreen(props: { serverId: string; tab?: Tab }) {
  const server = serverById(props.serverId);
  const tab = signal<Tab>(props.tab ?? "users");
  const users = signal<Part<User[]>>(null);
  const roles = signal<Part<Role[]>>(null);
  const invites = signal<Part<Invite[]>>(null);
  const error = signal<string | null>(null);
  const refreshing = signal(false);
  const link = signal<{ userName: string; link: string } | null>(null);

  let loadSeq = 0;
  const load = async () => {
    const mine = ++loadSeq;
    try {
      const c = clientFor(props.serverId);
      const [u, r, i] = await Promise.all([part(listUsers(c)), part(listRoles(c)), part(listInvites(c))]);
      if (mine !== loadSeq) return; // a newer load started: its answer wins
      users.set(u);
      roles.set(r);
      invites.set(i);
      error.set(null);
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
    return top?.name === "access" && top.serverId === props.serverId;
  };
  poll(load, REFRESH_MS, onTop);

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  const roleList = () => {
    const r = roles();
    return r && "value" in r ? r.value : [];
  };
  const roleName = (id: string) => roleList().find((r) => r.id === id)?.name ?? "Role";
  const me = server?.username?.toLowerCase();

  const rearm = async (inv: Invite) => {
    try {
      const created = await rearmInvite(clientFor(props.serverId), inv.id);
      link.set({ userName: inv.userName, link: created.link });
      await load();
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your account can't manage invites." : (e as Error).message);
    }
  };

  const revoke = async (inv: Invite) => {
    const choice = await confirm({
      title: `Revoke the invite for ${inv.userName}?`,
      message: "Its link stops working. You can send a new invite later.",
      tone: "danger",
      actions: [{ id: "revoke", label: "Revoke", tone: "danger" }],
    });
    if (choice !== "revoke") return;
    try {
      await revokeInvite(clientFor(props.serverId), inv.id);
      await load();
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your account can't manage invites." : (e as Error).message);
    }
  };

  const TABS: { id: Tab; label: string; count: () => number | null }[] = [
    { id: "users", label: "Users", count: () => (users() && "value" in users()! ? (users() as { value: User[] }).value.length : null) },
    { id: "roles", label: "Roles", count: () => (roleList().length || null) },
    {
      id: "invites",
      label: "Invites",
      count: () => (invites() && "value" in invites()! ? (invites() as { value: Invite[] }).value.filter((i) => i.status === "pending").length || null : null),
    },
  ];

  return (
    <AppPage title="Access" subtitle={server?.name ?? ""} right={<MainMenu serverId={props.serverId} current="access" />}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-4xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <View class="flex-row gap-1 rounded-xl bg-card p-1">
            <Each of={TABS}>
              {(t) => (
                <View
                  role="tab"
                  testID={`tab-${t().id}`}
                  onPress={() => tab.set(t().id)}
                  class={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${tab() === t().id ? "bg-primary" : ""}`}
                >
                  <Text class={`text-sm font-semibold ${tab() === t().id ? "text-primary-foreground" : "text-muted-foreground"}`}>{t().label}</Text>
                  <If when={t().count()}>
                    {(n) => <Text class={`text-xs ${tab() === t().id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{String(n())}</Text>}
                  </If>
                </View>
              )}
            </Each>
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

          {/* Users */}
          <If when={tab() === "users"}>
            <PartView part={users()} denied="Your AMP account can't see the user list." loading="Loading users…">
              {(list) => (
                <View class="gap-3">
                  <View class="md:w-72">
                    <PrimaryButton title="Add user" onPress={() => nav.push({ name: "user", serverId: props.serverId })} />
                  </View>
                  <View class="overflow-hidden rounded-(--radius) border border-border bg-card">
                    <Each of={list} key={(u: User) => u.id}>
                      {(u) => (
                        <View
                          role="button"
                          testID={`user-${u().userName}`}
                          onPress={() => nav.push({ name: "user", serverId: props.serverId, userId: u().id })}
                          class="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-accent"
                        >
                          <View class={`h-10 w-10 items-center justify-center rounded-full ${u().suspended ? "bg-border" : "bg-primary/25"}`}>
                            <Text class="text-base font-bold text-foreground">{(u().displayName || u().userName || "?")[0].toUpperCase()}</Text>
                          </View>
                          <View class="flex-1 gap-1">
                            <View class="flex-row flex-wrap items-center gap-1.5">
                              <Text class={`text-[15px] font-semibold ${u().suspended ? "text-muted-foreground" : "text-card-foreground"}`}>
                                {u().displayName || u().userName || "Unnamed"}
                              </Text>
                              <If when={u().userName?.toLowerCase() === me}>
                                <Text class="text-xs text-muted-foreground">(you)</Text>
                              </If>
                            </View>
                            <View class="flex-row flex-wrap gap-1.5">
                              <If when={u().isAdmin}>
                                <Pill label="Admin" tone="warning" />
                              </If>
                              <If when={u().suspended}>
                                <Pill label="Suspended" tone="danger" />
                              </If>
                              <Each of={u().roleIds ?? []}>{(id) => <Pill label={roleName(id())} tone="muted" />}</Each>
                            </View>
                            <Text class="text-xs text-muted-foreground">
                              {[u().displayName ? u().userName : null, u().lastLoginAt ? `last signed in ${ago(u().lastLoginAt)}` : "never signed in"]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          </View>
                          <Text class="text-lg text-muted-foreground">›</Text>
                        </View>
                      )}
                    </Each>
                  </View>
                </View>
              )}
            </PartView>
          </If>

          {/* Roles */}
          <If when={tab() === "roles"}>
            <PartView part={roles()} denied="Your AMP account can't see roles." loading="Loading roles…">
              {(list) => (
                <View class="gap-3">
                  <View class="md:w-72">
                    <PrimaryButton title="New role" onPress={() => nav.push({ name: "role", serverId: props.serverId })} />
                  </View>
                  <If when={list.length === 0}>
                    <Text class="text-sm text-muted-foreground">No roles yet.</Text>
                  </If>
                  <Each of={list} key={(r: Role) => r.id}>
                    {(r) => (
                      <RoleCard
                        role={r()}
                        members={members(users(), r().id)}
                        onEdit={() => nav.push({ name: "role", serverId: props.serverId, roleId: r().id })}
                      />
                    )}
                  </Each>
                </View>
              )}
            </PartView>
          </If>

          {/* Invites */}
          <If when={tab() === "invites"}>
            <If when={link()}>{(l) => <InviteLink userName={l().userName} link={l().link} onDone={() => link.set(null)} />}</If>
            <PartView part={invites()} denied="Your AMP account can't manage invites." loading="Loading invites…">
              {(list) => (
                <View class="gap-3">
                  <View class="md:w-72">
                    <PrimaryButton title="New invite" onPress={() => nav.push({ name: "invite", serverId: props.serverId })} />
                  </View>
                  <If when={list.length === 0}>
                    <Text class="text-sm text-muted-foreground">No invites. An invite is a one-time link someone uses to set up their own account.</Text>
                  </If>
                  <If when={list.length > 0}>
                    <View class="overflow-hidden rounded-(--radius) border border-border bg-card">
                      <Each of={list.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))} key={(i: Invite) => i.id}>
                        {(inv) => (
                          <InviteRow invite={inv()} roleName={roleName} onRearm={() => rearm(inv())} onRevoke={() => revoke(inv())} />
                        )}
                      </Each>
                    </View>
                  </If>
                </View>
              )}
            </PartView>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

/** "pending" → "Pending"; anything missing → "Unknown". */
function capitalize(text: string | null | undefined): string {
  return text ? text[0].toUpperCase() + text.slice(1) : "Unknown";
}

function members(users: Part<User[]>, roleId: string): string[] {
  if (!users || !("value" in users)) return [];
  return users.value.filter((u) => (u.roleIds ?? []).includes(roleId)).map((u) => u.displayName || u.userName || "?");
}

/** Shows a part's value, or why it isn't there. */
function PartView<T>(props: { part: Part<T>; denied: string; loading: string; children: (value: T) => JSX.Element }) {
  return (
    <>
      <If when={props.part === null}>
        <Text class="text-muted-foreground">{props.loading}</Text>
      </If>
      <If when={props.part && "denied" in props.part}>
        <Text class="text-sm text-muted-foreground">{props.denied}</Text>
      </If>
      <If when={props.part && "error" in props.part ? (props.part as { error: string }).error : null}>{(e) => <ErrorText message={e()} />}</If>
      <If when={props.part && "value" in props.part ? (props.part as { value: T }) : null}>{(p) => props.children(p().value)}</If>
    </>
  );
}

function RoleCard(props: { role: Role; members: string[]; onEdit: () => void }) {
  const open = signal(false);
  return (
    <View class="overflow-hidden rounded-(--radius) border border-border bg-card">
      <View role="button" testID={`role-${props.role.name}`} onPress={() => open.set(!open())} class="gap-1 px-4 py-3 active:bg-accent">
        <View class="flex-row items-center gap-2">
          <Text class="flex-1 text-[15px] font-semibold text-card-foreground">{props.role.name || "Unnamed role"}</Text>
          <Text class="text-xs text-muted-foreground">{`${props.role.permissions.length} permission${props.role.permissions.length === 1 ? "" : "s"}`}</Text>
          <Text class="text-muted-foreground">{open() ? "▾" : "▸"}</Text>
        </View>
        <If when={props.role.description}>{(d) => <Text class="text-sm text-muted-foreground">{d()}</Text>}</If>
        <Text class="text-xs text-muted-foreground">
          {props.members.length ? `Members: ${props.members.join(", ")}` : "No members"}
        </Text>
      </View>
      <If when={open()}>
        <View class="gap-1 border-t border-border bg-muted px-4 py-3">
          <If when={props.role.permissions.length === 0}>
            <Text class="text-xs text-muted-foreground">No permissions.</Text>
          </If>
          <Each of={props.role.permissions.slice().sort()}>
            {(p) => <Text class={`font-mono text-xs ${p().startsWith("-") ? "text-destructive" : "text-info"}`}>{p()}</Text>}
          </Each>
          <View class="flex-row pt-2">
            <SecondaryButton testID={`edit-role-${props.role.name}`} title="Edit role" onPress={props.onEdit} />
          </View>
        </View>
      </If>
    </View>
  );
}

function InviteRow(props: { invite: Invite; roleName: (id: string) => string; onRearm: () => void; onRevoke: () => void }) {
  const open = signal(false);
  const inv = () => props.invite;
  const tone = () => (inv().status === "accepted" ? "success" : inv().status === "expired" ? "muted" : "warning");
  const when = () =>
    inv().status === "accepted"
      ? `accepted ${ago(inv().acceptedAt)}`
      : inv().status === "expired"
        ? `expired ${ago(inv().expiresAt)}`
        : `expires ${new Date(inv().expiresAt).toLocaleDateString()}`;
  return (
    <View class="flex-row items-center gap-3 border-b border-border px-4 py-3">
      <View class="flex-1 gap-1">
        <View class="flex-row flex-wrap items-center gap-1.5">
          <Text class="text-[15px] font-semibold text-card-foreground">{inv().displayName || inv().userName}</Text>
          <Pill label={capitalize(inv().status)} tone={tone()} />
        </View>
        <Text class="text-xs text-muted-foreground">
          {[inv().displayName ? inv().userName : null, (inv().roleIds ?? []).map(props.roleName).join(", "), when(), inv().createdByName ? `by ${inv().createdByName}` : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <If when={inv().status !== "accepted"}>
        <Dropdown
          open={open()}
          onOpenChange={(o) => open.set(o)}
          title={inv().userName}
          items={[
            { id: "rearm", label: "New link", hint: "Makes a fresh link; the old one stops working", onSelect: props.onRearm },
            { id: "revoke", label: "Revoke", tone: "danger", onSelect: props.onRevoke },
          ]}
          trigger={<MoreButton testID={`invite-more-${inv().userName}`} class="bg-transparent" />}
        />
      </If>
    </View>
  );
}
