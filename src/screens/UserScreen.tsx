import { signal, Text, View } from "nsh";
import {
  createUser,
  deleteUser,
  getUser,
  listRoles,
  resetPassword,
  type Role,
  signOutUser,
  updateUser,
  type User,
  type UserChanges,
} from "../api/access";
import { AmpError } from "../api/client";
import { ago } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Prompt, type PromptRequest } from "../components/Prompt";
import { AppPage, Checkbox, ErrorText, Field, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";

/** Adds a user (no `userId`), or shows and edits one: details, roles, holds, password and sessions. */
export function UserScreen(props: { serverId: string; userId?: string }) {
  const server = serverById(props.serverId);
  const adding = !props.userId;
  const user = signal<User | null>(null);
  const roles = signal<Role[] | null>(null);
  const rolesDenied = signal(false);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const busy = signal(false);
  const prompt = signal<PromptRequest | null>(null);

  // The form.
  const userName = signal("");
  const password = signal("");
  const displayName = signal("");
  const email = signal("");
  const roleIds = signal<string[]>([]);
  const suspended = signal(false);
  const requireChange = signal(adding);
  const passwordExpires = signal(false);

  const fill = (u: User) => {
    user.set(u);
    displayName.set(u.displayName ?? "");
    email.set(u.email ?? "");
    roleIds.set([...(u.roleIds ?? [])]);
    suspended.set(u.suspended);
    requireChange.set(u.requirePasswordChange);
    passwordExpires.set(u.passwordExpires);
  };

  const fail = async (e: unknown, denied = "Your AMP account isn't allowed to do that.") => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
      return;
    }
    error.set(e instanceof AmpError && e.status === 403 ? denied : (e as Error).message);
  };

  const load = async () => {
    const c = clientFor(props.serverId);
    listRoles(c)
      .then((r) => roles.set(r))
      .catch((e) => (e instanceof AmpError && e.status === 403 ? rolesDenied.set(true) : roles.set([])));
    if (props.userId) {
      try {
        fill(await getUser(c, props.userId));
      } catch (e) {
        await fail(e, "Your AMP account can't see this user.");
      }
    }
  };
  load();

  const isMe = () => !!user() && user()!.userName?.toLowerCase() === server?.username?.toLowerCase();
  const name = () => (adding ? "Add user" : user()?.displayName || user()?.userName || "User");

  const changes = (): UserChanges => {
    const u = user();
    if (!u) return {};
    const out: UserChanges = {};
    if (displayName() !== (u.displayName ?? "")) out.displayName = displayName();
    if (email() !== (u.email ?? "")) out.email = email();
    const a = [...roleIds()].sort().join(",");
    if (a !== [...(u.roleIds ?? [])].sort().join(",")) out.roleIds = roleIds();
    if (suspended() !== u.suspended) out.suspended = suspended();
    if (requireChange() !== u.requirePasswordChange) out.requirePasswordChange = requireChange();
    if (passwordExpires() !== u.passwordExpires) out.passwordExpires = passwordExpires();
    return out;
  };
  const changeCount = () => Object.keys(changes()).length;

  const toggleRole = (id: string) => {
    roleIds.set(roleIds().includes(id) ? roleIds().filter((r) => r !== id) : [...roleIds(), id]);
  };

  const save = async () => {
    error.set(null);
    notice.set(null);
    const c = changes();
    if (c.suspended || (c.requirePasswordChange && !user()!.requirePasswordChange)) {
      const choice = await confirm({
        title: c.suspended ? `Suspend ${name()}?` : `Make ${name()} change their password?`,
        message: c.suspended
          ? "They're signed out everywhere and can't sign in until you lift it."
          : "They're signed out everywhere and must set a new password when they next sign in.",
        tone: "danger",
        actions: [{ id: "go", label: "Save", tone: "danger" }],
      });
      if (choice !== "go") return;
    }
    busy.set(true);
    try {
      fill(await updateUser(clientFor(props.serverId), props.userId!, c));
      notice.set("Saved.");
    } catch (e) {
      await fail(e, "Your AMP account can't change this user (they may hold more authority than you).");
    } finally {
      busy.set(false);
    }
  };

  const create = async () => {
    error.set(null);
    if (!userName().trim() || !password()) {
      error.set("Enter a username and a password.");
      return;
    }
    busy.set(true);
    try {
      const created = await createUser(clientFor(props.serverId), {
        userName: userName().trim(),
        password: password(),
        displayName: displayName().trim(),
        email: email().trim(),
        roleIds: roleIds(),
        requirePasswordChange: requireChange(),
      });
      password.set("");
      nav.replace({ name: "user", serverId: props.serverId, userId: created.id });
    } catch (e) {
      await fail(e, "Your AMP account can't create users (or give those roles).");
    } finally {
      busy.set(false);
    }
  };

  const reset = () =>
    prompt.set({
      title: `New password for ${name()}`,
      message: "They're signed out everywhere, SFTP included. Tick “Must change password” below to make this temporary.",
      masked: true,
      confirm: "Set password",
      onSubmit: async (value) => {
        if (!value) return "Enter a password.";
        try {
          await resetPassword(clientFor(props.serverId), props.userId!, value);
          notice.set("Password changed. They've been signed out.");
        } catch (e) {
          if (e instanceof AmpError && e.status === 403) return "Your account isn't allowed to reset this password.";
          return (e as Error).message;
        }
      },
    });

  const signOut = async () => {
    const choice = await confirm({
      title: `Sign ${name()} out everywhere?`,
      message: "Every session ends. They can sign straight back in.",
      actions: [{ id: "go", label: "Sign out", tone: "primary" }],
    });
    if (choice !== "go") return;
    try {
      await signOutUser(clientFor(props.serverId), props.userId!);
      notice.set("Signed out everywhere.");
    } catch (e) {
      await fail(e);
    }
  };

  const remove = async () => {
    const choice = await confirm({
      title: `Delete ${name()}?`,
      message: "Their account, passkeys, preferences and every schedule that runs as them are removed. This can't be undone.",
      tone: "danger",
      actions: [{ id: "delete", label: "Delete user", tone: "danger" }],
    });
    if (choice !== "delete") return;
    try {
      const warnings = await deleteUser(clientFor(props.serverId), props.userId!);
      if (warnings.length) {
        await confirm({ title: "User deleted", message: `Some of their data couldn't be removed: ${warnings.join("; ")}`, cancelLabel: null, actions: [{ id: "ok", label: "OK", tone: "primary" }] });
      }
      nav.pop();
    } catch (e) {
      await fail(e, "Your AMP account can't delete this user.");
    }
  };

  return (
    <AppPage title={name()} subtitle={adding ? server?.name ?? "" : user()?.userName ?? ""}>
      <Screen>
        <View class="w-full max-w-2xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
          <If when={notice()}>
            {(m) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text class="text-sm text-success">{m()}</Text>
              </View>
            )}
          </If>
          <If when={!adding && !user() && !error()}>
            <Text class="text-muted-foreground">Loading…</Text>
          </If>

          <If when={adding || user()}>
            <If when={user()}>
              {(u) => (
                <View class="flex-row flex-wrap items-center gap-2">
                  <If when={u().isAdmin}>
                    <Pill label="Admin" tone="warning" />
                  </If>
                  <If when={isMe()}>
                    <Pill label="You" tone="muted" />
                  </If>
                  <Text class="text-xs text-muted-foreground">
                    {[u().createdAt ? `added ${ago(u().createdAt)}` : null, u().lastLoginAt ? `last signed in ${ago(u().lastLoginAt)}` : "never signed in"]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              )}
            </If>

            <View class="gap-4 rounded-(--radius) border border-border bg-card p-4">
              <If when={adding}>
                <Field testID="new-username" label="Username" value={userName()} onChange={(v) => userName.set(v)} hint="What they sign in with. Can't be changed later." />
                <Field testID="new-password" label="Password" value={password()} onChange={(v) => password.set(v)} masked />
              </If>
              <Field testID="display-name" label="Display name" value={displayName()} onChange={(v) => displayName.set(v)} placeholder="Optional" />
              <Field testID="email" label="Email" value={email()} onChange={(v) => email.set(v)} placeholder="Optional" keyboardType="email-address" />
            </View>

            <View class="gap-2 rounded-(--radius) border border-border bg-card p-4">
              <Text class="text-xs font-semibold tracking-widest text-muted-foreground">ROLES</Text>
              <If when={rolesDenied()}>
                <Text class="text-sm text-muted-foreground">Your account can't see roles.</Text>
              </If>
              <If when={roles()?.length === 0}>
                <Text class="text-sm text-muted-foreground">No roles exist yet. Create them in the web panel.</Text>
              </If>
              <Each of={roles() ?? []} key={(r: Role) => r.id}>
                {(r) => (
                  <View>
                    <Checkbox testID={`role-check-${r().name}`} label={r().name || "Unnamed role"} checked={roleIds().includes(r().id)} onChange={() => toggleRole(r().id)} />
                    <If when={r().description}>{(d) => <Text class="ml-9 text-xs text-muted-foreground">{d()}</Text>}</If>
                  </View>
                )}
              </Each>
              <If when={!adding && isMe()}>
                <Text class="text-xs text-warning">Careful: removing your own roles can lock you out of things.</Text>
              </If>
            </View>

            <View class="gap-1 rounded-(--radius) border border-border bg-card p-4">
              <Text class="pb-1 text-xs font-semibold tracking-widest text-muted-foreground">SIGN-IN</Text>
              <Checkbox label="Must change password at next sign-in" checked={requireChange()} onChange={(v) => requireChange.set(v)} />
              <If when={!adding}>
                <Checkbox label="Password expires with age" checked={passwordExpires()} onChange={(v) => passwordExpires.set(v)} />
                <If when={!isMe()}>
                  <Checkbox label="Suspended (can't sign in)" checked={suspended()} onChange={(v) => suspended.set(v)} />
                </If>
              </If>
            </View>

            <If
              when={adding}
              else={
                <PrimaryButton
                  title={busy() ? "Saving…" : changeCount() ? `Save ${changeCount()} change${changeCount() === 1 ? "" : "s"}` : "No changes"}
                  onPress={save}
                  disabled={busy() || changeCount() === 0}
                />
              }
            >
              <PrimaryButton title={busy() ? "Adding…" : "Add user"} onPress={create} disabled={busy()} />
            </If>

            <If when={!adding && user()}>
              <View class="gap-2 pt-2">
                <View class="flex-row gap-2">
                  <SecondaryButton testID="reset-password" title="Reset password" onPress={reset} />
                  <SecondaryButton testID="sign-out-user" title="Sign out everywhere" onPress={signOut} />
                </View>
                <If when={!isMe()}>
                  <View class="flex-row">
                    <SecondaryButton testID="delete-user" title="Delete user" tone="danger" onPress={remove} />
                  </View>
                </If>
              </View>
            </If>
          </If>
        </View>
      </Screen>
      <Prompt request={prompt()} onClose={() => prompt.set(null)} />
    </AppPage>
  );
}
