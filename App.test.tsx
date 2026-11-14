import { expect, open, test } from "nsh/test";

const SERVER = "https://amp.example.test";

const shardsRoute = (request: { url: string; headers: Record<string, string> }) => {
  if (request.headers.authorization !== "Bearer tok-1") return { status: 401 };
  if (request.url.includes("/state")) {
    return { body: { shardId: "a1", status: 25, isRunning: true, metrics: { cpuUsagePercent: 3.4, memoryUsageMB: 2678, memoryLimitMB: 8192 } } };
  }
  if (request.url.includes("/metrics")) {
    const now = Date.now();
    return {
      body: Array.from({ length: 6 }, (_, i) => ({
        timestamp: new Date(now - (5 - i) * 5000).toISOString(),
        cpuPercent: 2 + i,
        memoryMb: 2600 + i * 10,
        memoryLimitMb: 8192,
        activeUsers: i,
        maxUsers: 16,
      })),
    };
  }
  return {
    body: [
      { id: "a1", displayName: "Minecraft SMP", templateSlug: "minecraft-java", displayImageSource: "internal:MinecraftJava", deleted: false },
      { id: "b2", displayName: "Old server", templateSlug: "valheim", deleted: true },
    ],
  };
};

test("starts with an Add Server button and no servers", async () => {
  const app = await open("./App.tsx");
  await app.waitFor("text:No servers yet");
  expect(app.texts()).toContain("Add Server");
});

test("adds a server, lists its instances, and keeps it on the home screen", async () => {
  const app = await open("./App.tsx", {
    network: {
      [`POST ${SERVER}/api/Auth/login`]: (request) => {
        const body = JSON.parse(request.body!);
        if (body.username !== "admin" || body.password !== "pw") return { status: 401, body: { title: "Invalid credentials" } };
        return { body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } };
      },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });

  await app.press("Add Server");
  await app.type("name", "Home Lab");
  await app.type("server", "amp.example.test");
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");

  await app.waitFor("text:Minecraft SMP");
  expect(app.texts()).not.toContain("Old server");

  await app.back();
  await app.waitFor("text:Home Lab");
  expect(app.texts()).toContain("Signed in");

  // Remembered without the password.
  const saved = app.storage()["amp.servers"]!;
  expect(saved).toContain("tok-1");
  expect(saved).not.toContain('"pw"');
});

test("opens a remembered server straight to its instances", async () => {
  const app = await open("./App.tsx", {
    storage: {
      "amp.servers": JSON.stringify([
        {
          id: "s1",
          name: "Home Lab",
          serverUrl: SERVER,
          username: "admin",
          color: 1,
          rememberMe: true,
          token: "tok-1",
          expiration: "2099-01-01T00:00:00Z",
        },
      ]),
    },
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.waitFor("text:Minecraft SMP");
  // State 25 (RunningReady) reads as Running, with CPU and RAM on the card.
  await app.waitFor("text:Running");
  expect(app.texts()).toContain("2,678 MB");

  await app.press("shard-Minecraft SMP");
  await app.waitFor("text:PERFORMANCE");
  await app.waitFor("text:of 16 slots");
  expect(app.texts()).not.toContain("Refresh");
  expect(app.texts()).not.toContain("State code 25");
  expect(app.requests().some((r) => r.url.includes("/metrics?minutes=30"))).toBe(true);
});

test("shows the server's error for bad credentials", async () => {
  const app = await open("./App.tsx", {
    network: {
      [`POST ${SERVER}/api/Auth/login`]: { status: 401, body: { title: "Invalid username or password" } },
    },
  });

  await app.press("Add Server");
  await app.type("server", SERVER);
  await app.type("username", "admin");
  await app.type("password", "wrong");
  await app.press("text:Add Server");

  await app.waitFor("text:Invalid username or password");
});

test("shows the console, sends a command, and falls back to polling without the hub", async () => {
  const sent: unknown[] = [];
  let seq = 3;
  const history = [
    { seq: 1, streamId: "stdout", kind: "marker", state: 25, text: "Running", timestamp: "2026-11-14T06:00:00Z" },
    { seq: 2, streamId: "stdout", kind: "line", text: "\x1b[32mServer started\x1b[0m on port 2001", timestamp: "2026-11-14T06:00:01Z" },
    { seq: 3, streamId: "stdout", kind: "line", level: "WARN", text: "Low tick rate", timestamp: "2026-11-14T06:00:02Z" },
  ];
  const app = await open("./App.tsx", {
    storage: {
      "amp.servers": JSON.stringify([
        { id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" },
      ]),
    },
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`POST ${SERVER}/api/auth/hub-token`]: { body: { token: "ticket", expiresAt: "2099-01-01T00:00:00Z" } },
      [`GET ${SERVER}/api/Shards/a1/console/history*`]: () => ({ body: { lines: history, hasMore: false } }),
      [`POST ${SERVER}/api/Shards/a1/console`]: (request) => {
        sent.push(JSON.parse(request.body!));
        history.push({ seq: ++seq, streamId: "input", kind: "line", text: "say hello", timestamp: "2026-11-14T06:00:05Z" });
        return { status: 202 };
      },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("open-console");
  await app.waitFor("text:Server started on port 2001");
  expect(app.texts()).toContain("Low tick rate");
  // The hub can't connect in a headless test, so the console polls.
  await app.waitFor("text:Polling");

  await app.type("command", "say hello");
  await app.press("Send");
  expect(sent).toEqual([{ command: "say hello", promptReply: false }]);
  await app.waitFor("text:› say hello");
});

const signedIn = {
  "amp.servers": JSON.stringify([
    { id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" },
  ]),
};

test("creates an instance from the catalogue", async () => {
  const created: any[] = [];
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Templates`]: {
        body: [
          { templateSlug: "valheim", metadata: { displayName: "Valheim", description: "Viking survival", displayImageSource: "steam:892970" } },
          { templateSlug: "minecraft-java", metadata: { displayName: "Minecraft Java Edition", displayImageSource: "internal:MinecraftJava" } },
          { templateSlug: "old-game", metadata: { displayName: "Old Game", deprecatedReason: "Gone" } },
        ],
      },
      [`GET ${SERVER}/api/Spires`]: { body: [{ id: "sp1", displayName: "Main", isLocal: true, acceptsNewShards: true, canHostShards: true }] },
      [`POST ${SERVER}/api/Shards`]: (request) => {
        created.push(JSON.parse(request.body!));
        return { body: { shard: { id: "n1", displayName: "Vikings", displayImageSource: "steam:892970" } } };
      },
      [`GET ${SERVER}/api/Shards/n1/state`]: { body: { shardId: "n1", status: 100, isBusy: true } },
      [`GET ${SERVER}/api/Shards/n1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
      [`GET https://shared.akamai.steamstatic.com/*`]: { status: 404 },
      [`GET https://shared.cloudflare.steamstatic.com/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("New instance");
  await app.waitFor("text:Valheim");
  expect(app.texts()).not.toContain("Old Game");

  await app.type("template-search", "mine");
  await app.waitUntil(() => !app.texts().includes("Valheim"));
  await app.clear("template-search");
  await app.press("template-valheim");
  await app.waitFor("text:Create instance");
  await app.clear("instance-name");
  await app.type("instance-name", "Vikings");
  await app.press("Create instance");

  await app.waitFor("text:Updating");
  expect(created).toEqual([
    { templateSlug: "valheim", displayName: "Vikings", description: "", spireId: "sp1", startNow: true, startOnBoot: false },
  ]);
});

test("edits an instance's details and settings", async () => {
  const patched: Record<string, unknown>[] = [];
  const renamed: Record<string, unknown>[] = [];
  const infraPatched: Record<string, unknown>[] = [];
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Shards/a1/settings/locale`]: { body: { en: { "cat.server": "Server" } } },
      [`GET ${SERVER}/api/Shards/a1/infra`]: {
        body: {
          settings: { startOnBoot: true, autoRestartOnCrash: true, startupOrder: 100, containerMode: "Native", memoryLimitMb: 0, cpuLimit: 0, maxUsersCap: 0, diskLimitMb: 0 },
          spireName: "Main",
          spireIsLinux: true,
          containerPolicy: 0,
          logicalCores: 8,
          templateOs: 3,
          supportsSleep: false,
          tracksUsers: true,
          reportsAddresses: false,
        },
      },
      [`PATCH ${SERVER}/api/Shards/a1/infra`]: (request) => {
        infraPatched.push(JSON.parse(request.body!));
        return { body: {} };
      },
      [`GET ${SERVER}/api/Shards/a1/settings`]: {
        body: [
          { spec: { fieldName: "MaxPlayers", displayName: "Max players", category: "cat.server", inputType: "number", minValue: 1, maxValue: 64 }, value: "16" },
          { spec: { fieldName: "PvP", displayName: "PvP", category: "cat.server", inputType: "checkbox", enumValues: { True: "true", False: "false" } }, value: "false" },
          { spec: { fieldName: "Difficulty", displayName: "Difficulty", category: "Gameplay", inputType: "enum", enumValues: { easy: "Easy", hard: "Hard" } }, value: "easy" },
          { spec: { fieldName: "Secret", displayName: "Secret", category: "Gameplay", inputType: "text", hidden: true }, value: "x" },
        ],
      },
      [`PATCH ${SERVER}/api/Shards/a1/settings`]: (request) => {
        patched.push(JSON.parse(request.body!));
        return { status: 204 };
      },
      [`PATCH ${SERVER}/api/Shards/a1`]: (request) => {
        renamed.push(JSON.parse(request.body!));
        return { body: { id: "a1", displayName: "SMP" } };
      },
      [`GET ${SERVER}/api/Shards/a1`]: { body: { id: "a1", displayName: "Minecraft SMP", description: "" } },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("open-settings");
  await app.waitFor("text:Server");
  expect(app.texts()).not.toContain("Secret");

  // A select opens in place and takes the choice.
  await app.press("group-Gameplay");
  await app.press("text:Easy");
  await app.press("text:Hard");
  await app.press("group-Server");
  await app.press("text:PvP");

  // A number over its maximum blocks saving.
  await app.type("setting-MaxPlayers", "0"); // 160
  await app.waitFor("text:At most 64");
  await app.press("Save 3 changes");
  await app.waitFor("text:Fix the highlighted settings first.");
  expect(patched).toEqual([]);

  await app.clear("setting-MaxPlayers");
  await app.type("setting-MaxPlayers", "32");
  await app.type("details-description", "Survival world");
  await app.press("Save 4 changes");
  await app.waitUntil(() => patched.length === 1);
  expect(patched[0]).toEqual({ MaxPlayers: "32", PvP: "true", Difficulty: "hard" });
  expect(renamed).toEqual([{ displayName: "Minecraft SMP", description: "Survival world", tags: null }]);

  // Infrastructure: limits show only in a container; values go back typed.
  await app.press("group-Container and limits");
  expect(app.texts()).not.toContain("Memory limit");
  await app.press("text:Native");
  await app.press("text:Docker");
  await app.waitFor("text:Memory limit");
  await app.type("setting-infra.cpuLimit", "12"); // 012 → 12 cores, over the machine's 8
  await app.waitFor("text:At most 8");
  await app.clear("setting-infra.cpuLimit");
  await app.type("setting-infra.cpuLimit", "2.5");
  await app.press("group-Startup");
  await app.press("text:Restart after a crash");
  await app.press("Save 3 changes");
  await app.waitUntil(() => infraPatched.length === 1);
  expect(infraPatched[0]).toEqual({ containerMode: "Docker", cpuLimit: 2.5, autoRestartOnCrash: false });
});

test("deletes an instance, then restores one and permanently deletes another", async () => {
  const calls: string[] = [];
  let list = [
    { id: "a1", displayName: "Minecraft SMP", templateSlug: "minecraft-java", deleted: false },
    { id: "b2", displayName: "Old server", templateSlug: "valheim", deleted: true, deletedAt: "2026-11-10T00:00:00Z" },
    { id: "c3", displayName: "Scrap", templateSlug: "terraria", deleted: true, deletedAt: "2026-11-11T00:00:00Z" },
  ];
  const mark = (id: string, deletedNow: boolean) => (list = list.map((s) => (s.id === id ? { ...s, deleted: deletedNow } : s)));
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`DELETE ${SERVER}/api/Shards/a1`]: () => (calls.push("delete a1"), mark("a1", true), { status: 200 }),
      [`POST ${SERVER}/api/Shards/b2/restore`]: () => (calls.push("restore b2"), mark("b2", false), { status: 200 }),
      [`POST ${SERVER}/api/Shards/c3/purge`]: () => (calls.push("purge c3"), (list = list.filter((s) => s.id !== "c3")), { status: 202 }),
      [`GET ${SERVER}/api/Shards/a1/state`]: { body: { shardId: "a1", status: 0, isStopped: true } },
      [`GET ${SERVER}/api/Shards/b2/state`]: { body: { shardId: "b2", status: 0, isStopped: true } },
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards?includeDeleted=true`]: () => ({ body: list }),
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  app.onDialog((d) => (d.title?.startsWith("Permanently") ? "Delete permanently" : "Delete"));

  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("Delete instance");
  await app.waitFor("text:Recently deleted");
  expect(app.dialogs()[0]).toMatchObject({ title: "Delete Minecraft SMP?" });

  await app.press("recently-deleted");
  await app.press("restore-Old server");
  await app.waitFor("shard-Old server");

  await app.press("purge-Scrap");
  await app.waitUntil(() => calls.includes("purge c3"));
  await app.waitUntil(() => !app.texts().includes("Scrap"));
  expect(app.dialogs()[1]).toMatchObject({ title: "Permanently delete Scrap?" });
  expect(calls).toEqual(["delete a1", "restore b2", "purge c3"]);
});
