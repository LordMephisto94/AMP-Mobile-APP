import type { AmpClient } from "./client";

/** `ConsoleLineDto`: one console entry. `seq` orders history and the live feed in one space. */
export interface ConsoleLine {
  streamId: string;
  text: string;
  timestamp: string;
  /** Per-shard monotonic; may arrive as a string (int64). */
  seq?: number | string;
  /** `line`, `marker` (lifecycle event), `notice`, `error` or `info`. */
  kind?: "line" | "marker" | "notice" | "error" | "info" | string;
  /** The `ApplicationState` a state marker carries. */
  state?: number | null;
  /** Outcome of an update-complete marker. */
  success?: boolean | null;
  code?: string | null;
  params?: Record<string, string> | null;
  /** Log level parsed by the template's console format, when it has one. */
  level?: string | null;
  origin?: string | null;
  /** Present on live hub events. */
  shardId?: string;
}

/** `ConsoleHistoryPage`: lines oldest-first, and whether older ones remain. */
export interface ConsoleHistoryPage {
  lines: ConsoleLine[];
  hasMore: boolean;
}

/**
 * `GET /api/Shards/{id}/console/history`: the newest page without `beforeSeq`; pass the
 * first line's seq to page backwards. Needs the `console.read` capability.
 */
export function getConsoleHistory(
  client: AmpClient,
  id: string,
  options: { beforeSeq?: number; limit?: number } = {},
): Promise<ConsoleHistoryPage> {
  return client.request<ConsoleHistoryPage>(`/api/Shards/${encodeURIComponent(id)}/console/history`, {
    query: { beforeSeq: options.beforeSeq, limit: options.limit ?? 200 },
  });
}

/**
 * `POST /api/Shards/{id}/console`: writes a command to the app's stdin. `promptReply` marks
 * an answer to an interactive prompt (a Steam password or Guard code) so it is never
 * audited in the clear. Needs `console.send`.
 */
export async function sendConsoleCommand(client: AmpClient, id: string, command: string, promptReply = false): Promise<void> {
  await client.request<void>(`/api/Shards/${encodeURIComponent(id)}/console`, {
    method: "POST",
    body: { command, promptReply },
  });
}

export function seqOf(line: ConsoleLine): number {
  return Number(line.seq ?? 0);
}

const ANSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

/** Strips terminal colour codes, as the panel does. */
export function stripAnsi(text: string): string {
  return text.includes("\x1b") || text.includes("\x9b") ? text.replace(ANSI, "") : text;
}
