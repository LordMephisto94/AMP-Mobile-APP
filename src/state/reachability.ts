import { signal } from "nsh";
import { AmpClient, AmpError } from "../api/client";
import type { SavedServer } from "./servers";

/**
 * Whether each saved server's panel answers, for the cards on the home page. Asked with
 * AMP's password policy, a small answer that needs no sign-in, so it works signed in or
 * out and never sends a token. Any answer from the panel (even a refusal) means it's up;
 * no answer, or a proxy's 5xx (the panel behind it is down), means it isn't.
 */
export type Reach = "checking" | "online" | "offline";

const states = signal<Record<string, { url: string; reach: Reach }>>({});
/** The newest check per server: an older one that answers late is dropped. */
const latest = new Map<string, number>();
let seq = 0;

/** The server's last known state; "checking" until its first answer, or when its address changed. */
export function reachOf(server: SavedServer): Reach {
  const s = states()[server.id];
  return s && s.url === server.serverUrl ? s.reach : "checking";
}

export async function checkServer(server: SavedServer): Promise<void> {
  const id = server.id;
  const url = server.serverUrl;
  const mine = ++seq;
  latest.set(id, mine);
  let reach: Reach;
  try {
    await new AmpClient(url).request("/api/Auth/password-policy", { anonymous: true, timeoutMs: 8000 });
    reach = "online";
  } catch (e) {
    const status = e instanceof AmpError ? e.status : 0;
    reach = status > 0 && status < 500 ? "online" : "offline";
  }
  if (latest.get(id) !== mine) return;
  latest.delete(id);
  states.set({ ...states(), [id]: { url, reach } });
}

/** Checks every server in `list`, and forgets the ones no longer in it. */
export async function checkServers(list: SavedServer[]): Promise<void> {
  // Called from inside an effect (poll): reading `states` there would make every answer
  // start another round. After this await nothing here is tracked.
  await Promise.resolve();
  const ids = new Set(list.map((s) => s.id));
  const kept = Object.fromEntries(Object.entries(states()).filter(([id]) => ids.has(id)));
  if (Object.keys(kept).length !== Object.keys(states()).length) states.set(kept);
  await Promise.all(list.map((s) => checkServer(s)));
}
