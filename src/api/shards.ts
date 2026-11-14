import type { AmpClient } from "./client";
import type { DeployedShard, ShardMetricsSample, ShardState } from "./types";

/** `GET /api/Shards/{id}/metrics`: samples every ~5 s; `minutes` trims to the last N minutes (~2 h kept). */
export function getShardMetrics(client: AmpClient, id: string, minutes: number): Promise<ShardMetricsSample[]> {
  return client.request<ShardMetricsSample[]>(`/api/Shards/${encodeURIComponent(id)}/metrics`, { query: { minutes } });
}

/** `GET /api/Shards`: the tenant's shards (instances). */
export function listShards(client: AmpClient, includeDeleted = false): Promise<DeployedShard[]> {
  return client.request<DeployedShard[]>("/api/Shards", { query: { includeDeleted } });
}

/** `GET /api/Shards/{id}/state`: runtime state and current metrics. */
export function getShardState(client: AmpClient, id: string): Promise<ShardState> {
  return client.request<ShardState>(`/api/Shards/${encodeURIComponent(id)}/state`);
}

export type ShardPowerAction = "start" | "stop" | "restart" | "sleep" | "wake" | "update";

/** `POST /api/Shards/{id}/{start|stop|restart|sleep|wake|update}` (update runs the app's update task). */
export async function shardPower(client: AmpClient, id: string, action: ShardPowerAction): Promise<void> {
  await client.request<void>(`/api/Shards/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}
