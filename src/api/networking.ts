import { formatBytes } from "../lib/units";
import type { AmpClient } from "./client";

/**
 * How players and the panel are reached: the panel's HTTPS front, each instance's ports,
 * ports published through a public machine, whole-instance gateways, the tunnels between
 * machines, and the firewall AMP manages. Reading needs `NetworkRead` (and `ports.read` for
 * an instance's ports); changes need `NetworkManage` / `ports.write`.
 */

export type TunnelPhase = "Provisioning" | "Connecting" | "Up" | "Degraded" | "AgentUnreachable" | "AgentRejected" | "Releasing";

export interface TunnelEnd {
  spireId: string;
  spireName: string;
  keyPublished: boolean;
  agentInstalled: boolean;
  agentReachable: boolean;
  agentError: string | null;
}

export interface Tunnel {
  id: string;
  frontSpireId: string;
  backSpireId: string;
  frontEndpointHost: string;
  interfaceName: string;
  listenPort: number;
  front: TunnelEnd;
  back: TunnelEnd;
  status?: { up: boolean; rttMs?: number | string; phase?: TunnelPhase; error?: string | null; lastProbeAt?: string } | null;
  permanentForEntryNode?: boolean;
}

export type PublicationState =
  | "Pending"
  | "Active"
  | "TunnelProvisioning"
  | "TunnelDown"
  | "ShardMissing"
  | "PortRefMissing"
  | "PortConflict"
  | "Disabled"
  | "Error"
  | "PortPrivate"
  | "TunnelFault"
  | "TunnelUnavailable"
  | "ShardStopped";

export interface Publication {
  id: string;
  frontSpireId: string;
  publicPort: number;
  protocol: string;
  shardId: string;
  portRef: string;
  enabled: boolean;
  createdAt: string;
  status?: {
    state?: PublicationState;
    resolvedPort?: number;
    bytesIn?: number | string;
    bytesOut?: number | string;
    activeFlows?: number;
    tunnelPhase?: TunnelPhase;
    error?: string | null;
    updatedAt?: string;
  } | null;
}

export type GatewayState = "Provisioning" | "AwaitingShard" | "Connecting" | "Active" | "Disabled" | "Fault";

export interface Gateway {
  id: string;
  shardId: string;
  shardName: string;
  frontSpireId: string;
  frontSpireName: string;
  enabled: boolean;
  egressAllowList?: string[];
  status?: { state?: GatewayState; address?: string | null; error?: string | null } | null;
  runningWithoutRoute?: boolean;
}

export interface FirewallRule {
  port: number;
  protocol: string | number;
  tag?: string;
  label?: string;
}

export interface FirewallStatus {
  running: boolean;
  status?: {
    backend?: string;
    healthy?: boolean;
    applied?: FirewallRule[];
    rejected?: { rule: FirewallRule; reason: string }[];
    advisories?: string[];
    error?: string | null;
    updatedAt?: string;
    agentVersion?: string;
  } | null;
  withheld?: { shardId: string; shardName: string; source: string; port: number; protocol: string; kind: string }[];
}

export interface HttpsState {
  /** `none`, `managed` (AMP runs the front) or `ownProxy`. */
  mode: string;
  hostName: string | null;
  url: string | null;
  certificateVerified: boolean;
  agentPresent: boolean;
  panelExposed: boolean;
  entryNode: boolean;
  externalAddress: string | null;
  /** Unknown, Direct, Nat or Cgnat. */
  reachability: string;
  internalAddress: string | null;
  ipv6Address: string | null;
  trustedProxies: string[];
}

export interface ShardPort {
  ref: string;
  name: string;
  description?: string;
  protocol: string;
  port: number;
  isPublic: boolean;
  custom: boolean;
  /** The port players join on; always public. */
  primary: boolean;
}

export const getTunnels = (c: AmpClient) => c.request<Tunnel[]>("/api/networking/tunnels");
export const getPublications = (c: AmpClient) => c.request<Publication[]>("/api/networking/publications");
export const getGateways = (c: AmpClient) => c.request<Gateway[]>("/api/networking/gateways");
export const getFirewall = (c: AmpClient) => c.request<FirewallStatus>("/api/networking/firewall");
export const getHttps = (c: AmpClient) => c.request<HttpsState>("/api/https");

/** `GET /api/Shards/{id}/ports`: an instance's ports and whether each is public. */
export function getShardPorts(c: AmpClient, shardId: string): Promise<ShardPort[]> {
  return c.request<ShardPort[]>(`/api/Shards/${encodeURIComponent(shardId)}/ports`);
}

/** `PUT /api/Shards/{id}/ports/{ref}/access`: makes a port public or private (not the primary). */
export function setPortAccess(c: AmpClient, shardId: string, ref: string, isPublic: boolean): Promise<ShardPort[]> {
  return c.request<ShardPort[]>(`/api/Shards/${encodeURIComponent(shardId)}/ports/${encodeURIComponent(ref)}/access`, {
    method: "PUT",
    body: { public: isPublic },
  });
}

/** `PUT /api/networking/publications/{id}`: pauses or resumes a published port. */
export function setPublicationEnabled(c: AmpClient, p: Publication, enabled: boolean): Promise<unknown> {
  return c.request(`/api/networking/publications/${encodeURIComponent(p.id)}`, {
    method: "PUT",
    body: { enabled, publicPort: p.publicPort },
  });
}

/** `DELETE /api/networking/publications/{id}`: stops publishing the port. */
export async function removePublication(c: AmpClient, id: string): Promise<void> {
  await c.request<void>(`/api/networking/publications/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Bytes in the size units the user chose. */
export function bytes(value: number | string | undefined): string {
  return formatBytes(value);
}

/** "TunnelProvisioning" → "Tunnel provisioning". */
export function words(name: string | undefined | null): string {
  if (!name) return "";
  const w = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  return w.map((x, i) => (i === 0 ? x : x.toLowerCase())).join(" ");
}

/** How a state reads as a pill. */
export function stateTone(state: string | undefined | null): "success" | "warning" | "danger" | "muted" {
  if (!state) return "muted";
  if (state === "Active" || state === "Up") return "success";
  if (/Fault|Error|Down|Conflict|Missing|Rejected|Unreachable|Unavailable/.test(state)) return "danger";
  if (state === "Disabled" || state === "PortPrivate" || state === "ShardStopped") return "muted";
  return "warning";
}
