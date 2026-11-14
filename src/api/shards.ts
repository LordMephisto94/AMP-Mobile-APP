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

export interface ShardEndpointAddress {
  /** `Public`: from the internet; `Local`: from the same network. */
  reach: "Public" | "Local";
  host: string;
  port: number;
  showPort: boolean;
  /** As players should type it: "host:port", or just "host". */
  display: string;
  uri?: string | null;
}

export interface ShardEndpoint {
  portRef: string;
  name: string;
  port: number;
  protocol: string;
  /** The port players connect to. */
  isPrimary: boolean;
  isPublic: boolean;
  /** Public first. */
  addresses: ShardEndpointAddress[];
}

/** `GET /api/Shards/{id}/endpoints`: where to connect, as AMP resolves it (NAT, relays, advertised address). */
export function getShardEndpoints(client: AmpClient, id: string): Promise<ShardEndpoint[]> {
  return client.request<ShardEndpoint[]>(`/api/Shards/${encodeURIComponent(id)}/endpoints`);
}

/** The address players should use: the primary port's first (public-first) address. */
export function connectAddress(endpoints: ShardEndpoint[]): ShardEndpointAddress | null {
  const primary = endpoints.find((e) => e.isPrimary) ?? endpoints[0];
  return primary?.addresses?.[0] ?? null;
}
