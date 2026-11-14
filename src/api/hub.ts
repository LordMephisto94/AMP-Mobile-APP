/**
 * A minimal SignalR client (JSON protocol over WebSockets) for AMP 3's hubs, which the
 * OpenAPI spec does not describe. Mirrors what the web panel does:
 *
 *   - URL `/hubs/shard` (also `/hubs/spire`, `/hubs/tasks`), WebSockets only, no negotiate
 *   - auth: a fresh single-use ticket from `POST /api/auth/hub-token` for every connect,
 *     sent as `?access_token=`
 *   - join a shard's group with `JoinShard(tenantId, shardId)`, leave with `LeaveShard`
 *   - events: `ConsoleLine(line)`, `Metrics(shardId, sample)`,
 *     `ShardStateChanged(?, shardId, state)`, `Lifecycle(event)`, `UserJoined`, ...
 */

const RS = "\x1e";

const enum MessageType {
  Invocation = 1,
  Completion = 3,
  Ping = 6,
  Close = 7,
}

export type HubStatus = "connecting" | "connected" | "reconnecting" | "closed";

export interface HubOptions {
  /** e.g. `https://panel.example.com`. */
  baseUrl: string;
  /** e.g. `/hubs/shard`. */
  path: string;
  /** Fetches a fresh hub ticket (`POST /api/auth/hub-token`). */
  ticket: () => Promise<string>;
  /** Runs after every (re)connect: join groups here. */
  onConnected?: (hub: HubConnection) => void | Promise<void>;
  onStatus?: (status: HubStatus, error?: string) => void;
}

export class HubConnection {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private buffer = "";
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;
  private handshakeDone = false;

  constructor(private readonly options: HubOptions) {}

  /** Listens to a hub event (the server's `Clients.*.SendAsync(name, ...)`). */
  on(event: string, handler: (...args: unknown[]) => void): this {
    const key = event.toLowerCase();
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler]);
    return this;
  }

  start(): void {
    this.stopped = false;
    this.open("connecting");
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.cleanupSocket();
    this.options.onStatus?.("closed");
  }

  /** Calls a hub method and resolves with its result. */
  invoke<T = unknown>(target: string, ...args: unknown[]): Promise<T> {
    const socket = this.socket;
    if (!socket || !this.handshakeDone) return Promise.reject(new Error("Hub not connected"));
    const invocationId = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(invocationId, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: MessageType.Invocation, invocationId, target, arguments: args });
    });
  }

  private async open(status: HubStatus): Promise<void> {
    this.options.onStatus?.(status);
    let ticket: string;
    try {
      ticket = await this.options.ticket();
    } catch (e) {
      this.scheduleRetry((e as Error).message);
      return;
    }
    if (this.stopped) return;

    const url = `${this.options.baseUrl.replace(/^http/, "ws")}${this.options.path}?access_token=${encodeURIComponent(ticket)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      this.scheduleRetry((e as Error).message);
      return;
    }
    this.socket = socket;
    this.buffer = "";
    this.handshakeDone = false;

    socket.onopen = () => {
      socket.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
    };
    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (typeof event.data === "string") this.receive(event.data);
    };
    socket.onerror = () => {
      // `close` follows; the retry happens there.
    };
    socket.onclose = (event: WebSocketCloseEvent) => {
      if (this.socket !== socket) return;
      this.cleanupSocket();
      if (!this.stopped) this.scheduleRetry(event.reason || `closed (${event.code})`);
    };
  }

  private receive(data: string): void {
    this.buffer += data;
    let end: number;
    while ((end = this.buffer.indexOf(RS)) >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!frame) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(frame);
      } catch {
        continue;
      }

      if (!this.handshakeDone) {
        // The handshake response: `{}` or `{ error }`.
        if (message.error) {
          this.socket?.close();
          this.options.onStatus?.("reconnecting", String(message.error));
          return;
        }
        this.handshakeDone = true;
        this.attempt = 0;
        this.pingTimer = setInterval(() => this.send({ type: MessageType.Ping }), 15_000);
        this.options.onStatus?.("connected");
        Promise.resolve(this.options.onConnected?.(this)).catch(() => {});
        continue;
      }

      switch (message.type) {
        case MessageType.Invocation: {
          const handlers = this.handlers.get(String(message.target).toLowerCase()) ?? [];
          for (const handler of handlers) handler(...((message.arguments as unknown[]) ?? []));
          break;
        }
        case MessageType.Completion: {
          const call = this.pending.get(String(message.invocationId));
          if (!call) break;
          this.pending.delete(String(message.invocationId));
          if (message.error) call.reject(new Error(String(message.error)));
          else call.resolve(message.result);
          break;
        }
        case MessageType.Close: {
          // `hubs.error.sessionEnded` and the like: the session is gone, don't retry.
          const error = message.error ? String(message.error) : undefined;
          if (message.allowReconnect === false || error?.includes("sessionEnded")) this.stopped = true;
          this.socket?.close();
          if (this.stopped) this.options.onStatus?.("closed", error);
          break;
        }
      }
    }
  }

  private send(message: object): void {
    try {
      this.socket?.send(JSON.stringify(message) + RS);
    } catch {
      // A dead socket's close event handles it.
    }
  }

  private cleanupSocket(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const call of this.pending.values()) call.reject(new Error("Hub connection closed"));
    this.pending.clear();
    const socket = this.socket;
    this.socket = null;
    this.handshakeDone = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    this.options.onStatus?.("reconnecting", reason);
    // 0.5 s, 2 s, 5 s, 10 s, then every 30 s, as SignalR's automatic reconnect does.
    const delays = [500, 2_000, 5_000, 10_000];
    const delay = delays[this.attempt] ?? 30_000;
    this.attempt++;
    this.retryTimer = setTimeout(() => this.open("reconnecting"), delay);
  }
}
