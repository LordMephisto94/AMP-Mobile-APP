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
  | { name: "shardSettings"; serverId: string; id: string; title: string };

export const nav = createNavStack<Route>([{ name: "servers" }]);
