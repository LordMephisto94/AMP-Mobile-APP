import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { listRoles, type Role } from "../api/access";
import { AmpError } from "../api/client";
import { listSpires } from "../api/manage";
import { panelText } from "../api/panelText";
import {
  createRole,
  deleteRole,
  getMyPermissions,
  otherGrants,
  type PermissionNode,
  permissionTree,
  rowState,
  toggle,
  updateRole,
} from "../api/permissions";
import { keyLabel } from "../api/settings";
import { listShards } from "../api/shards";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { AppPage, ErrorText, Field, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";

/** Creates a role (no `roleId`) or edits one: its name, description and permissions, as a tree. */
export function RoleScreen(props: { serverId: string; roleId?: string }) {
  const server = serverById(props.serverId);
  const adding = !props.roleId;
  const role = signal<Role | null>(null);
  const tree = signal<PermissionNode[] | null>(null);
  const text = signal<Record<string, string>>({});
  const myRoleIds = signal<string[]>([]);
  const name = signal("");
  const description = signal("");
  const grants = signal<string[]>([]);
  const open = signal<string[]>([]);
  const extra = signal("");
  const error = signal<string | null>(null);
  const busy = signal(false);

  const fail = async (e: unknown, denied: string) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
      return;
    }
    error.set(e instanceof AmpError && e.status === 403 ? denied : (e as Error).message);
  };

  const load = async () => {
    const c = clientFor(props.serverId);
    panelText(c).then((t) => text.set(t));
    try {
      const [roles, shards, spires, mine] = await Promise.all([
        props.roleId ? listRoles(c) : Promise.resolve([] as Role[]),
        listShards(c).catch(() => []),
        listSpires(c).catch(() => []),
        getMyPermissions(c).catch(() => ({ grants: [], catalog: [], roleIds: [] })),
      ]);
      if (props.roleId) {
        const r = roles.find((x) => x.id === props.roleId);
        if (!r) return error.set("This role no longer exists.");
        role.set(r);
        name.set(r.name ?? "");
        description.set(r.description ?? "");
        grants.set([...r.permissions]);
      }
      myRoleIds.set(mine.roleIds ?? []);
      tree.set(
        permissionTree(
          shards.filter((s) => !s.deleted).map((s) => ({ id: s.id, name: s.displayName || s.name || s.id, spireId: s.spireId })),
          spires.map((s) => ({ id: s.id, name: s.displayName || s.id })),
          mine.catalog ?? [],
        ),
      );
    } catch (e) {
      await fail(e, "Your AMP account can't see roles.");
    }
  };
  load();

  const label = (n: PermissionNode) => n.label ?? (n.labelKey ? text()[`access.tree.${n.labelKey}`] || keyLabel(n.labelKey) : "");
  const dirty = () => {
    const r = role();
    if (adding) return !!(name() || description() || grants().length);
    if (!r) return false;
    return name() !== (r.name ?? "") || description() !== (r.description ?? "") || [...grants()].sort().join("|") !== [...r.permissions].sort().join("|");
  };
  const inThisRole = () => !!props.roleId && myRoleIds().includes(props.roleId);
  const others = () => (tree() ? otherGrants(grants(), tree()!) : []);

  const flip = (n: PermissionNode) => grants.set(toggle(grants(), n));
  const expand = (id: string) => open.set(open().includes(id) ? open().filter((x) => x !== id) : [...open(), id]);

  const addExtra = () => {
    const g = extra().trim();
    if (!g) return;
    if (!/^-?[\w*>.-]+$/.test(g)) return error.set("A permission is dotted parts, like spire.*.shard.*.view (a leading - denies it).");
    error.set(null);
    grants.set([...new Set([...grants(), g])]);
    extra.set("");
  };

  const save = async () => {
    error.set(null);
    if (!name().trim()) return error.set("Give the role a name.");
    if (inThisRole()) {
      const choice = await confirm({
        title: "You're in this role",
        message: "Changing it changes what you can do too, and nobody can give themselves back a permission they removed.",
        tone: "danger",
        actions: [{ id: "go", label: "Save anyway", tone: "danger" }],
      });
      if (choice !== "go") return;
    }
    busy.set(true);
    try {
      const body = { name: name().trim(), description: description().trim(), permissions: grants() };
      const saved = adding ? await createRole(clientFor(props.serverId), body) : await updateRole(clientFor(props.serverId), props.roleId!, body);
      role.set(saved);
      grants.set([...saved.permissions]);
      nav.pop();
    } catch (e) {
      await fail(e, "Your AMP account can't make this change: you can only grant permissions you hold yourself.");
    } finally {
      busy.set(false);
    }
  };

  const remove = async () => {
    const choice = await confirm({
      title: `Delete ${role()?.name || "this role"}?`,
      message: "Its members lose everything it gave them. This can't be undone.",
      tone: "danger",
      actions: [{ id: "delete", label: "Delete role", tone: "danger" }],
    });
    if (choice !== "delete") return;
    try {
      await deleteRole(clientFor(props.serverId), props.roleId!);
      nav.pop();
    } catch (e) {
      await fail(e, "Your AMP account can't delete this role: you must hold everything it grants.");
    }
  };

  const leave = async () => {
    if (!dirty()) return nav.pop();
    const choice = await confirm({
      title: "Discard your changes?",
      message: "The role stays as it was.",
      tone: "danger",
      actions: [{ id: "discard", label: "Discard", tone: "danger" }],
    });
    if (choice === "discard") {
      grants.set(role()?.permissions ?? []);
      name.set(role()?.name ?? "");
      description.set(role()?.description ?? "");
      nav.pop();
    }
  };

  return (
    <AppPage title={adding ? "New role" : name() || "Role"} subtitle={server?.name ?? ""} popOnBack={!dirty()} onBack={leave}>
      <Screen>
        <View class="w-full max-w-3xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+96px)]">
          <If when={inThisRole()}>
            <View class="rounded-(--radius) border border-warning/40 bg-warning/10 px-3.5 py-3">
              <Text class="text-sm text-warning">You're a member of this role. Taking permissions away from it takes them from you too.</Text>
            </View>
          </If>
          <View class="gap-4 rounded-(--radius) border border-border bg-card p-4">
            <Field testID="role-name" label="Name" value={name()} onChange={(v) => name.set(v)} />
            <Field testID="role-description" label="Description" value={description()} onChange={(v) => description.set(v)} placeholder="Optional" />
          </View>

          <Text class="text-sm text-muted-foreground">
            Switch on what this role allows. A switch on a group covers everything in it, including instances added later. Turning something off that a wider permission allows blocks it here.
          </Text>

          <If when={!tree()}>
            <Text class="text-muted-foreground">Loading permissions…</Text>
          </If>
          <Each of={tree() ?? []} key={(n: PermissionNode) => n.id}>
            {(section) => (
              <View class="overflow-hidden rounded-(--radius) border border-border bg-card">
                <Text class="px-4 pt-3.5 pb-1 text-xs font-semibold tracking-widest text-muted-foreground">{label(section()).toUpperCase()}</Text>
                <Each of={section().children} key={(n: PermissionNode) => n.id}>
                  {(n) => <PermRow node={n()} depth={0} grants={grants()} open={open()} label={label} onToggle={flip} onExpand={expand} />}
                </Each>
              </View>
            )}
          </Each>

          <If when={tree()}>
            <View class="gap-2 rounded-(--radius) border border-border bg-card p-4">
              <Text class="text-xs font-semibold tracking-widest text-muted-foreground">OTHER PERMISSIONS</Text>
              <If when={others().length === 0}>
                <Text class="text-xs text-muted-foreground">None. Add one by its exact name, for permissions the tree doesn't show.</Text>
              </If>
              <Each of={others()}>
                {(g) => (
                  <View class="flex-row items-center gap-2">
                    <Text class={`flex-1 font-mono text-xs ${g().startsWith("-") ? "text-destructive" : "text-info"}`}>{g()}</Text>
                    <Text
                      role="button"
                      testID={`remove-grant-${g()}`}
                      onPress={() => grants.set(grants().filter((x) => x !== g()))}
                      class="rounded-md bg-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      Remove
                    </Text>
                  </View>
                )}
              </Each>
              <View class="flex-row items-center gap-2">
                <View class="flex-1 rounded-lg border border-input bg-background/60 px-3 py-2">
                  <Input
                    testID="extra-grant"
                    value={extra()}
                    onChange={({ value }) => extra.set(value)}
                    onSubmit={addExtra}
                    placeholder="e.g. spire.*.shard.*.view"
                    autoCapitalize="none"
                    autoCorrect={false}
                    class="p-0 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </View>
                <Text role="button" testID="add-grant" onPress={addExtra} class="rounded-lg bg-primary/20 px-3 py-2 text-sm font-semibold text-primary">
                  Add
                </Text>
              </View>
            </View>
          </If>

          <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
          <If when={!adding && role()}>
            <View class="flex-row">
              <SecondaryButton testID="delete-role" title="Delete role" tone="danger" onPress={remove} />
            </View>
          </If>
        </View>
      </Screen>

      <If when={dirty() || adding}>
        <View class="absolute right-0 bottom-0 left-0 flex-row gap-2 border-t border-border bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <SecondaryButton title="Cancel" onPress={leave} />
          <View class="flex-1">
            <PrimaryButton title={busy() ? "Saving…" : adding ? "Create role" : "Save role"} onPress={save} disabled={busy()} />
          </View>
        </View>
      </If>
    </AppPage>
  );
}

/** A row's test id without `*` and `>`, which UI-test selectors can read as patterns. */
const tid = (id: string) => id.replace(/\*/g, "any").replace(/>/g, "all");

/** One row of the tree: a capability's switch, or a group that opens to its own. */
function PermRow(props: {
  node: PermissionNode;
  depth: number;
  grants: string[];
  open: string[];
  label: (n: PermissionNode) => string;
  onToggle: (n: PermissionNode) => void;
  onExpand: (id: string) => void;
}) {
  const s = () => rowState(props.grants, props.node);
  const isOpen = () => props.open.includes(props.node.id);
  const hasChildren = () => props.node.children.length > 0;
  const on = () => s().state === "on" || s().state === "inherited";
  const note = () => {
    const st = s().state;
    if (st === "inherited") return "allowed by a wider permission";
    if (st === "denied") return "blocked";
    if (st === "mixed") return `${s().on} of ${s().total}`;
    if (hasChildren() && on()) return props.node.node && props.grants.includes(props.node.node) ? "all, including anything added later" : `${s().on} of ${s().total}`;
    return null;
  };
  return (
    <View>
      <View class="flex-row items-center gap-2 border-t border-border py-2.5 pr-4" style={{ paddingLeft: 16 + props.depth * 16 }}>
        <View
          role={hasChildren() ? "button" : undefined}
          testID={`perm-open-${tid(props.node.id)}`}
          onPress={() => hasChildren() && props.onExpand(props.node.id)}
          class="flex-1 flex-row items-center gap-2"
        >
          <Text class="w-3 text-xs text-muted-foreground">{hasChildren() ? (isOpen() ? "▾" : "▸") : ""}</Text>
          <View class="flex-1">
            <Text class={`text-sm ${hasChildren() ? "font-semibold" : ""} ${s().state === "denied" ? "text-destructive" : "text-card-foreground"}`}>
              {props.label(props.node)}
            </Text>
            <If when={note()}>{(t) => <Text class={`text-[11px] ${s().state === "denied" ? "text-destructive" : "text-muted-foreground"}`}>{t()}</Text>}</If>
          </View>
        </View>
        <If when={s().state === "denied"}>
          <Pill label="Blocked" tone="danger" />
        </If>
        <View
          role="switch"
          testID={`perm-${tid(props.node.id)}`}
          accessibilityLabel={`${props.label(props.node)}: ${s().state}`}
          onPress={() => props.onToggle(props.node)}
          class={`h-7 w-12 justify-center rounded-full px-0.5 ${
            s().state === "on" ? "bg-primary" : s().state === "inherited" ? "bg-primary/45" : s().state === "mixed" ? "bg-primary/25" : "bg-muted"
          }`}
        >
          <View class={`h-6 w-6 rounded-full ${s().state === "on" || s().state === "inherited" || s().state === "mixed" ? "bg-white" : "bg-muted-foreground"} shadow ${on() ? "self-end" : s().state === "mixed" ? "self-center" : "self-start"}`} />
        </View>
      </View>
      <If when={hasChildren() && isOpen()}>
        <Each of={props.node.children} key={(n: PermissionNode) => n.id}>
          {(c) => (
            <PermRow
              node={c()}
              depth={props.depth + 1}
              grants={props.grants}
              open={props.open}
              label={props.label}
              onToggle={props.onToggle}
              onExpand={props.onExpand}
            />
          )}
        </Each>
      </If>
    </View>
  );
}
