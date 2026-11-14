import { createNavStack } from "nsh/base";

/** Routes of the app's navigation stack. Add a variant per screen. */
export type Route =
  | { name: "servers" }
  | { name: "addServer" }
  | { name: "signIn"; serverId: string }
  | { name: "shards"; serverId: string }
  | {
      name: "shard";
      serverId: string;
      id: string;
      title: string;
      /** The template's `displayImageSource`, for the artwork. */
      image?: string | null;
    }
  | { name: "console"; serverId: string; id: string; title: string; tenantId?: string }
  | { name: "createShard"; serverId: string }
  | { name: "shardSettings"; serverId: string; id: string; title: string }
  | { name: "files"; serverId: string; id: string; title: string; path: string }
  /** Player analytics for a server, or for one instance when `shardId` is given. */
  | { name: "analytics"; serverId: string; shardId?: string; title?: string }
  | { name: "player"; serverId: string; userKey: string; playerName?: string | null; shardId?: string }
  /** A server at a glance: totals, machines, recent activity. */
  | { name: "overview"; serverId: string }
  /** A server's machines, and one machine. */
  | { name: "spires"; serverId: string }
  | { name: "spire"; serverId: string; id: string; title: string }
  /** How a server is reached: panel address, ports, publications, tunnels, firewall. */
  | { name: "networking"; serverId: string }
  /** Who can use the panel: users, roles, invites; one user (none: a new one); a new invite. */
  | { name: "access"; serverId: string; tab?: "users" | "roles" | "invites" }
  | { name: "user"; serverId: string; userId?: string }
  | { name: "invite"; serverId: string }
  /** The panel's own settings, updates, licence and your account. */
  | { name: "settings"; serverId: string }
  /** The panel's audit log for a server. */
  | { name: "activity"; serverId: string }
  | { name: "fileEdit"; serverId: string; id: string; path: string; managed?: string | null };

export const nav = createNavStack<Route>([{ name: "servers" }]);
