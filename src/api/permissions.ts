import type { AmpClient } from "./client";
import type { Role } from "./access";

/**
 * AMP's permission model, as the web panel's role editor draws it. A grant is a dotted
 * node (`spire.<id>.shard.<id>.power.start`); `*` stands for any one part and `>` for
 * everything below; a leading `-` makes it a deny, which wins over allows. Some
 * capabilities count only when named exactly (`byNameOnly`): wildcards don't cover them.
 */

export interface PermissionNode {
  id: string;
  /** A name to show as is (an instance's or machine's). */
  label?: string;
  /** Otherwise a key under `access.tree.` in the panel's wording. */
  labelKey?: string;
  /** The grant this row stands for; null for a heading. */
  node: string | null;
  children: PermissionNode[];
  /** Wildcards don't cover it. */
  byNameOnly?: boolean;
}

export interface Capability {
  node: string;
  /** Platform, Spire or Shard. */
  scope: string;
  dangerous: boolean;
  byNameOnly: boolean;
}

export interface MyPermissions {
  grants: string[];
  catalog: Capability[];
  roleIds: string[];
}

export const getMyPermissions = (c: AmpClient) => c.request<MyPermissions>("/api/me/permissions");

export function createRole(c: AmpClient, role: { name: string; description: string; permissions: string[] }): Promise<Role> {
  return c.request<Role>("/api/roles", { method: "POST", body: { name: role.name, description: role.description || null, permissions: role.permissions } });
}

export function updateRole(c: AmpClient, id: string, role: { name: string; description: string; permissions: string[] }): Promise<Role> {
  return c.request<Role>(`/api/roles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { name: role.name, description: role.description || null, permissions: role.permissions },
  });
}

export async function deleteRole(c: AmpClient, id: string): Promise<void> {
  await c.request(`/api/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- The tree ----------------------------------------------------------------------------

const leaf = (labelKey: string, node: string): PermissionNode => ({ id: "", labelKey, node, children: [] });
const group = (labelKey: string, node: string | null, children: PermissionNode[]): PermissionNode => ({ id: "", labelKey, node, children });
const named = (label: string, node: string | null, children: PermissionNode[]): PermissionNode => ({ id: "", label, node, children });

/** What can be granted on an instance (or every instance), under `base`. */
function shardCapabilities(base: string): PermissionNode[] {
  const n = (s: string) => `${base}.${s}`;
  return [
    leaf("view", n("view")),
    group("power", n("power.*"), [leaf("start", n("power.start")), leaf("stop", n("power.stop")), leaf("restart", n("power.restart")), leaf("kill", n("power.kill"))]),
    group("update", n("update.*"), [leaf("run", n("update.run")), leaf("abort", n("update.abort"))]),
    group("console", n("console.*"), [leaf("read", n("console.read")), leaf("send", n("console.send"))]),
    group("files", n("files.*"), [
      leaf("read", n("files.read")),
      leaf("write", n("files.write")),
      leaf("delete", n("files.delete")),
      leaf("bypassrestrictions", n("files.bypassrestrictions")),
    ]),
    group("settings", n("settings.*"), [leaf("read", n("settings.read")), leaf("write", n("settings.write"))]),
    group("infra", n("infra.*"), [leaf("read", n("infra.read")), leaf("write", n("infra.write")), leaf("limits", n("infra.limits"))]),
    group("ports", n("ports.*"), [leaf("read", n("ports.read")), leaf("write", n("ports.write"))]),
    group("snapshots", n("snapshots.*"), [
      leaf("read", n("snapshots.read")),
      leaf("create", n("snapshots.create")),
      leaf("restore", n("snapshots.restore")),
      leaf("delete", n("snapshots.delete")),
    ]),
    group("schedule", n("schedule.*"), [leaf("read", n("schedule.read")), leaf("write", n("schedule.write"))]),
    group("analytics", n("analytics.*"), [leaf("read", n("analytics.read")), leaf("users", n("analytics.users")), leaf("addresses", n("analytics.addresses"))]),
    leaf("clone", n("clone")),
    leaf("move", n("move")),
    leaf("suspend", n("suspend")),
    leaf("suspendBypass", n("suspend.bypass")),
    leaf("delete", n("delete")),
  ];
}

/** What can be granted on a machine (or every machine), under `base`. */
function spireCapabilities(base: string): PermissionNode[] {
  const n = (s: string) => `${base}.${s}`;
  return [
    leaf("view", n("view")),
    leaf("createServer", n("shards.create")),
    leaf("discover", n("discover")),
    group("settings", null, [leaf("read", n("settings.read")), leaf("write", n("settings.write.>"))]),
    group("startup", n("startup.*"), [leaf("read", n("startup.read")), leaf("write", n("startup.write"))]),
    group("datastores", n("datastores.*"), [leaf("read", n("datastores.read")), leaf("write", n("datastores.write"))]),
    leaf("delete", n("delete")),
  ];
}

/** The whole tree: every instance, every machine, and the platform, as the panel lays it out. */
export function permissionTree(
  shards: { id: string; name: string; spireId?: string | null }[],
  spires: { id: string; name: string }[],
  catalog: Capability[],
): PermissionNode[] {
  const tree = [
    group("servers", null, [
      group("allServers", "spire.*.shard.*.>", shardCapabilities("spire.*.shard.*")),
      ...shards.map((s) => {
        const base = `spire.${s.spireId ?? "*"}.shard.${s.id}`;
        return named(s.name, `${base}.>`, shardCapabilities(base));
      }),
    ]),
    group("hosts", null, [group("allHosts", null, spireCapabilities("spire.*")), ...spires.map((s) => named(s.name, null, spireCapabilities(`spire.${s.id}`)))]),
    group("platform", null, [
      group("users", "users.*", [
        leaf("read", "users.read"),
        leaf("create", "users.create"),
        leaf("edit", "users.edit"),
        leaf("suspend", "users.suspend"),
        leaf("delete", "users.delete"),
        leaf("resetPassword", "users.resetpassword"),
        leaf("invite", "users.invite"),
      ]),
      group("roles", "roles.*", [leaf("read", "roles.read"), leaf("create", "roles.create"), leaf("edit", "roles.edit"), leaf("delete", "roles.delete"), leaf("assign", "roles.assign")]),
      group("settings", null, [leaf("read", "platform.settings.read"), leaf("write", "platform.settings.write.>")]),
      leaf("audit", "audit.read"),
      leaf("templates", "templates.manage"),
      leaf("createHost", "spire.create"),
      leaf("debug", "platform.debug"),
      leaf("support", "platform.support"),
      group("ampUpdates", "platform.update.*", [leaf("check", "platform.update.check"), leaf("apply", "platform.update.apply")]),
      group("network", "network.*", [leaf("read", "network.read"), leaf("manage", "network.manage")]),
      group("licence", "licence.*", [leaf("read", "licence.read"), leaf("manage", "licence.manage")]),
      group("webhooks", "webhooks.*", [leaf("internal", "webhooks.internal")]),
    ]),
  ];
  assignIds(tree, "");
  markByNameOnly(tree, catalog.filter((c) => c.byNameOnly));
  return tree;
}

function assignIds(nodes: PermissionNode[], prefix: string) {
  const seen = new Map<string, number>();
  for (const n of nodes) {
    const key = n.node ?? n.labelKey ?? n.label ?? "n";
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    n.id = (prefix ? `${prefix}/` : "") + key + (count ? `~${count}` : "");
    assignIds(n.children, n.id);
  }
}

/** Marks the rows for capabilities that only count when named, as the panel does. */
function markByNameOnly(nodes: PermissionNode[], named: Capability[]) {
  for (const n of nodes) {
    if (n.node) {
      const parts = n.node.toLowerCase().split(".");
      n.byNameOnly = named.some((c) => {
        const cap = c.node.toLowerCase().split(".");
        const skip = c.scope === "Shard" ? 4 : c.scope === "Spire" ? 2 : 0;
        if (parts.length !== skip + cap.length) return false;
        if (c.scope === "Shard" && (parts[0] !== "spire" || parts[2] !== "shard")) return false;
        if (c.scope === "Spire" && (parts[0] !== "spire" || parts[2] === "shard")) return false;
        return cap.every((p, i) => parts[skip + i] === p);
      });
    }
    markByNameOnly(n.children, named);
  }
}

// ---- Matching and toggling -------------------------------------------------------------------

/** Whether a grant pattern covers a node (both without a leading `-`). */
export function covers(pattern: string, node: string): boolean {
  const p = pattern.toLowerCase().split(".");
  const n = node.toLowerCase().split(".");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === ">") return n.length > i;
    if (i >= n.length) return false;
    if (p[i] !== "*" && p[i] !== n[i]) return false;
  }
  return p.length === n.length;
}

export type GrantState = "on" | "inherited" | "denied" | "off";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** How a single capability stands under a set of grants. */
export function stateOf(grants: string[], node: string, byNameOnly = false): GrantState {
  const denies = grants.filter((g) => g.startsWith("-")).map((g) => g.slice(1));
  if (denies.some((d) => (byNameOnly ? same(d, node) : covers(d, node)))) return "denied";
  const allows = grants.filter((g) => !g.startsWith("-"));
  if (allows.some((a) => same(a, node))) return "on";
  if (!byNameOnly && allows.some((a) => covers(a, node))) return "inherited";
  return "off";
}

/** The rows with a grant of their own and no children: the capabilities themselves. */
export function leaves(n: PermissionNode): PermissionNode[] {
  if (!n.children.length) return n.node ? [n] : [];
  return n.children.flatMap(leaves);
}

/** A row's summary: a capability's own state, or how many of a group's are on. */
export function rowState(grants: string[], n: PermissionNode): { state: GrantState | "mixed"; on: number; total: number } {
  const all = leaves(n);
  if (!n.children.length && n.node) {
    const s = stateOf(grants, n.node, n.byNameOnly);
    return { state: s, on: s === "on" || s === "inherited" ? 1 : 0, total: 1 };
  }
  const states = all.map((l) => stateOf(grants, l.node!, l.byNameOnly));
  const on = states.filter((s) => s === "on" || s === "inherited").length;
  const explicit = n.node && grants.some((g) => same(g, n.node!));
  const state: GrantState | "mixed" = on === 0 ? (states.some((s) => s === "denied") ? "denied" : "off") : on === all.length ? (explicit ? "on" : states.every((s) => s === "inherited") ? "inherited" : "on") : "mixed";
  return { state, on, total: all.length };
}

/**
 * Turns a row on or off and returns the new grants. On: drops the denies in its way and
 * grants its node (a group's own wildcard, or each capability when it has none). Off: drops
 * its own and its capabilities' grants, then denies what a wider wildcard still allows.
 */
export function toggle(grants: string[], n: PermissionNode): string[] {
  const all = leaves(n);
  const nodes = [...(n.node ? [n.node] : []), ...all.map((l) => l.node!)];
  const { state } = rowState(grants, n);
  const turningOn = state === "off" || state === "denied" || state === "mixed";
  // This row's own grants and denies, and its capabilities', are rewritten; wider ones stay.
  let next = grants.filter((g) => {
    const bare = g.startsWith("-") ? g.slice(1) : g;
    return !nodes.some((x) => same(x, bare));
  });
  if (turningOn) {
    if (n.node) next.push(n.node);
    else for (const l of all) next.push(l.node!);
  } else {
    // Still allowed by something wider: block it here.
    const stillOn = all.filter((l) => stateOf(next, l.node!, l.byNameOnly) !== "off");
    if (stillOn.length) {
      if (n.node && stillOn.length === all.length) next.push(`-${n.node}`);
      else for (const l of stillOn) next.push(`-${l.node}`);
    }
  }
  next = [...new Set(next)];
  return next;
}

/** Grants that no row of the tree stands for (typed by hand, or for things gone since). */
export function otherGrants(grants: string[], tree: PermissionNode[]): string[] {
  const known = new Set<string>();
  const walk = (ns: PermissionNode[]) => {
    for (const x of ns) {
      if (x.node) known.add(x.node.toLowerCase());
      walk(x.children);
    }
  };
  walk(tree);
  return grants.filter((g) => !known.has((g.startsWith("-") ? g.slice(1) : g).toLowerCase()));
}
