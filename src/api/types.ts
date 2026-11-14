// Hand-written types for the parts of the AMP 3.0.1 web API the app uses.
// Source of truth: docs/reference/amp-3.0.1-api-v1.json (OpenAPI 3.1, "webapi | v1").
// Keep property names exactly as the spec writes them (camelCase JSON).

/** `AuthResponse`: what a successful sign-in or renew returns. */
export interface AuthResponse {
  token: string;
  /** ISO-8601 instant the token stops being accepted. */
  expiration: string;
}

/** `LoginRequest` body of `POST /api/Auth/login`. */
export interface LoginRequest {
  username: string;
  password: string;
  /** Long-lived session that survives the app closing. */
  rememberMe?: boolean;
}

/**
 * A 200 from `POST /api/Auth/login` is one of three shapes. The spec documents the
 * markers only in prose, so the client checks for them defensively.
 */
export type LoginOutcome =
  | { kind: "signedIn"; auth: AuthResponse }
  | { kind: "passwordChangeRequired"; reason?: string }
  | { kind: "passkeyRequired" };

/** `ProblemDetails`: RFC 7807 error body. */
export interface ProblemDetails {
  type?: string | null;
  title?: string | null;
  status?: number;
  detail?: string | null;
  instance?: string | null;
}

/** `ApiError`: AMP's own error body (e.g. on 429). */
export interface ApiError {
  code: string;
  params?: Record<string, unknown> | null;
  message: string;
}

/** `DeployedShard`: one entry of `GET /api/Shards`. AMP 3 calls instances "shards". */
export interface DeployedShard {
  id: string;
  tenantId?: string;
  displayName?: string;
  description?: string;
  name?: string;
  templateSlug?: string;
  displayImageSource?: string;
  spireId?: string;
  datastoreId?: string;
  workingDirName?: string;
  createdByUserId?: string;
  createdAt?: string;
  installedAt?: string | null;
  installedVersion?: string | null;
  tags?: string[];
  suspended?: boolean;
  diskWarningAcked?: boolean;
  deleted?: boolean;
  deletedAt?: string | null;
}

/**
 * `ApplicationState`: an integer in the spec, which does not name the values. These names
 * come from the AMP 3.0.1 web panel's own front-end code.
 */
export const ApplicationState = {
  Stopped: 0,
  LaunchingAgent: 3,
  PreStart: 5,
  Configuring: 10,
  Starting: 15,
  RunningNotReady: 20,
  RunningReady: 25,
  Stopping: 30,
  PreparingSleep: 50,
  Sleeping: 55,
  InstallingUpdating: 100,
  AwaitingUserAction: 110,
  FailedInstall: 200,
  FailedStartup: 300,
} as const;
export type ApplicationState = number;

/** How a state reads at a glance, grouped as the panel groups them. */
export type StateTone = "running" | "stopped" | "busy" | "attention" | "error";

const STATE_LABELS: Record<number, string> = {
  0: "Stopped",
  3: "Launching agent",
  5: "Pre-start",
  10: "Configuring",
  15: "Starting",
  20: "Starting",
  25: "Running",
  30: "Stopping",
  50: "Preparing to sleep",
  55: "Sleeping",
  100: "Updating",
  110: "Needs attention",
  200: "Install failed",
  300: "Startup failed",
};

export function stateLabel(state: Pick<ShardState, "status"> | null | undefined): string {
  if (!state) return "Unknown";
  return STATE_LABELS[state.status] ?? `State ${state.status}`;
}

/** The panel's grouping: attention, busy, error, running, else stopped. */
export function stateTone(state: Partial<ShardState> | null | undefined): StateTone {
  if (!state || state.status == null) return "stopped";
  if (state.status === ApplicationState.AwaitingUserAction) return "attention";
  if (state.status === ApplicationState.RunningNotReady || state.isBusy) return "busy";
  if (state.status >= ApplicationState.FailedInstall) return "error";
  if (state.isRunning || state.status === ApplicationState.RunningReady) return "running";
  return "stopped";
}

/** `MetricsModel`: a running shard's current metrics. Numbers may arrive as strings. */
export interface MetricsModel {
  cpuUsagePercent?: number | string;
  memoryUsageMB?: number | string;
  memoryLimitMB?: number | string;
  activeConnections?: number;
  networkInKBps?: number;
  networkOutKBps?: number;
  diskReadKBps?: number;
  diskWriteKBps?: number;
  taskQueueLength?: number;
}

/** `ShardState`: `GET /api/Shards/{id}/state`. */
export interface ShardState {
  shardId: string;
  tenantId?: string;
  status: ApplicationState;
  metrics?: MetricsModel | null;
  lastHeartbeat?: string;
  activeTaskId?: string | null;
  processId?: number;
  runningVersion?: string | null;
  agentVersion?: string | null;
  /** Set when the shard enters a failed state (English). */
  lastErrorMessage?: string | null;
  lastErrorCode?: string | null;
  /** What the agent is doing within its current state (English), e.g. during Pre-start. */
  statusMessage?: string | null;
  startedAt?: string | null;
  isRunning?: boolean;
  isStopped?: boolean;
  isBusy?: boolean;
  awaitsLicence?: boolean;
  acceptsTraffic?: boolean;
}

/** `ShardMetricsSample`: one sample of `GET /api/Shards/{id}/metrics` (every ~5 s, ~2 h kept). */
export interface ShardMetricsSample {
  timestamp: string;
  /** Percent; may arrive as a string. */
  cpuPercent?: number | string;
  memoryMb?: number;
  /** 0 = unlimited. */
  memoryLimitMb?: number;
  ioReadKbps?: number | string;
  ioWriteKbps?: number | string;
  /** -1 = unknown. */
  activeUsers?: number;
  /** 0 = unknown/unlimited. */
  maxUsers?: number;
  /** App-defined metrics from the console (e.g. TPS). */
  custom?: Record<string, number | string>;
  listeningPorts?: number[];
}

/** `HubTokenResponse`: single-use, 60-second ticket for opening a hub WebSocket. */
export interface HubTokenResponse {
  /** Sent as `access_token` when opening a hub WebSocket. */
  token: string;
  expiresAt: string;
}
