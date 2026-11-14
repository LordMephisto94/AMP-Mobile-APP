import { expect, open, test } from "nsh/test";

const SERVER = "https://amp.example.test";

const shardsRoute = (request: { url: string; headers: Record<string, string> }) => {
  if (request.headers.authorization !== "Bearer tok-1") return { status: 401 };
  if (request.url.includes("/state")) {
    return { body: { shardId: "a1", status: 25, isRunning: true, metrics: { cpuUsagePercent: 3.4, memoryUsageMB: 2678, memoryLimitMB: 8192 } } };
  }
  if (request.url.includes("/endpoints")) {
    const endpoints = [
        { portRef: "QueryPort", name: "Query", port: 17777, protocol: "Udp", isPrimary: false, isPublic: true, addresses: [] },
        {
          portRef: "PrimaryApplicationPort",
          name: "Game",
          port: 2001,
          protocol: "Udp",
          isPrimary: true,
          isPublic: true,
          addresses: [
            { reach: "Public", host: "203.0.113.7", port: 2001, showPort: true, display: "203.0.113.7:2001" },
            { reach: "Local", host: "192.168.1.20", port: 2001, showPort: true, display: "192.168.1.20:2001" },
          ],
        },
    ];
    // The list asks for every shard's at once, keyed by id.
    return { body: request.url.includes("/api/Shards/endpoints") ? { a1: endpoints } : endpoints };
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

test("starts with an Add Server button and no servers, and says it is unofficial", async () => {
  const app = await open("./App.tsx");
  await app.waitFor("text:No servers yet");
  expect(app.texts()).toContain("Add Server");
  expect(app.texts()).toContain("Unofficial app. Not made by or affiliated with CubeCoders, the makers of AMP.");
  await app.press("about");
  await app.waitFor("text:AMP Mobile 1.0.0");
  await app.press("confirm-ok");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile 1.0.0"));
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
  await app.waitFor("text:203.0.113.7:2001"); // the primary port's public address, above the name
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
          { spec: { fieldName: "Difficulty", displayName: "Difficulty", category: "Gameplay:stadia_controller", inputType: "enum", enumValues: { easy: "Easy", hard: "Hard" } }, value: "easy" },
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
  expect(app.texts()).not.toContain("Gameplay:stadia_controller");
  expect(app.texts()).toContain("🎮");
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

  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("Delete instance");
  await app.waitFor("text:Delete Minecraft SMP?");
  await app.press("confirm-delete");
  await app.waitFor("text:Recently deleted");

  await app.press("recently-deleted");
  await app.press("more-deleted-Old server");
  await app.press("menu-restore");
  await app.waitFor("shard-Old server");

  await app.press("more-deleted-Scrap");
  await app.press("menu-purge");
  await app.waitFor("text:Permanently delete Scrap?");
  await app.press("confirm-purge");
  await app.waitUntil(() => calls.includes("purge c3"));
  await app.waitUntil(() => !app.texts().includes("Scrap"));
  expect(calls).toEqual(["delete a1", "restore b2", "purge c3"]);
});

test("browses, edits, creates, uploads and deletes files", async () => {
  const FILES = `${SERVER}/api/shards/a1/files`;
  const tree: Record<string, { name: string; isDirectory: boolean; size?: number }[]> = {
    "": [
      { name: "server.properties", isDirectory: false, size: 1200 },
      { name: "world", isDirectory: true },
      { name: "eula.txt", isDirectory: false, size: 10 },
    ],
    world: [{ name: "level.dat", isDirectory: false, size: 4096 }],
  };
  const contents: Record<string, string> = { "server.properties": "motd=Hello\nmax-players=20\n", "eula.txt": "eula=true\n" };
  const calls: string[] = [];
  const chunks: number[] = [];
  const pathOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("path") ?? "");
  const listing = (dir: string) =>
    (tree[dir] ?? []).map((e) => ({ ...e, path: dir ? `${dir}/${e.name}` : e.name, modified: "2026-11-14T06:00:00Z" }));

  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${FILES}/managed*`]: (r) => ({ body: pathOf(r.url) === "" ? [{ path: "eula.txt", kind: "generated", importable: false, source: "config" }] : [] }),
      [`GET ${FILES}/content*`]: (r) => ({ body: { content: contents[pathOf(r.url)] ?? "" } }),
      [`PUT ${FILES}/content*`]: (r) => {
        const path = pathOf(r.url);
        contents[path] = JSON.parse(r.body!).content;
        if (!tree[""].some((e) => e.name === path)) tree[""].push({ name: path, isDirectory: false, size: 0 });
        calls.push(`write ${path}`);
        return { status: 204 };
      },
      [`POST ${FILES}/folder`]: (r) => {
        const path = JSON.parse(r.body!).path;
        tree[""].push({ name: path, isDirectory: true });
        calls.push(`folder ${path}`);
        return { status: 204 };
      },
      [`POST ${FILES}/upload-start`]: (r) => {
        calls.push(`upload-start ${JSON.parse(r.body!).path} ${JSON.parse(r.body!).size}`);
        return { body: { sessionId: "sess1", received: 0 } };
      },
      [`POST ${FILES}/upload-chunk*`]: (r) => {
        chunks.push(r.body!.length);
        return { body: { received: 5 } };
      },
      [`POST ${FILES}/upload-commit*`]: () => {
        tree[""].push({ name: "mod.jar", isDirectory: false, size: 5 });
        calls.push("upload-commit");
        return { status: 204 };
      },
      [`DELETE ${FILES}*`]: (r) => {
        const path = pathOf(r.url);
        tree[""] = tree[""].filter((e) => e.name !== path);
        calls.push(`delete ${path}`);
        return { status: 204 };
      },
      [`GET ${FILES}*`]: (r) => ({ body: listing(pathOf(r.url)) }),
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("open-files");
  await app.waitFor("text:server.properties");
  expect(app.texts()).toContain("AMP"); // eula.txt is AMP-managed

  // Folders open as their own page.
  await app.press("file-world");
  await app.waitFor("text:level.dat");
  await app.back();

  // Edit and save a text file.
  await app.press("file-server.properties");
  await app.waitFor("file-content");
  await app.type("file-content", "online-mode=false\n");
  await app.press("save-file");
  await app.waitFor("text:Saved.");
  expect(contents["server.properties"]).toBe("motd=Hello\nmax-players=20\nonline-mode=false\n");
  // Unsaved edits: the header's back asks first; keep editing, then discard.
  await app.type("file-content", "x");
  await app.press("back");
  await app.waitFor("text:Discard your changes?");
  await app.press("confirm-cancel");
  await app.waitUntil(() => !app.texts().includes("Discard your changes?"));
  await app.wait(300);
  await app.press("back");
  await app.waitFor("text:Discard your changes?");
  await app.wait(200);
  await app.press("confirm-discard");
  await app.waitFor("file-eula.txt");

  // A generated managed file opens read-only.
  await app.press("file-eula.txt");
  await app.waitFor("text:AMP rewrites this file from the instance's settings on every start, so it's read-only here. Change the settings instead.");
  await app.back();

  // New folder through the prompt.
  await app.press("new-folder");
  await app.type("prompt-input", "mods");
  await app.press("text:Create");
  await app.waitFor("file-mods");

  // Upload through the picker, in chunks.
  app.onPick(() => [{ name: "mod.jar", data: new Uint8Array([1, 2, 3, 4, 5]) }]);
  await app.press("upload");
  await app.waitFor("text:Uploaded.");
  await app.waitFor("file-mod.jar");
  expect(chunks).toEqual([5]);

  // Delete, confirmed.
  // The row's dropdown, then the app's own confirm dialog.
  await app.press("more-mod.jar");
  await app.press("menu-delete");
  await app.waitFor("text:Delete mod.jar?");
  await app.press("confirm-delete");
  await app.waitUntil(() => calls.includes("delete mod.jar"));

  expect(calls).toEqual(["write server.properties", "folder mods", "upload-start mod.jar 5", "upload-commit", "delete mod.jar"]);
});

test("the server menu is the app's own dropdown, and removing asks first", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: { [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } }, [`POST ${SERVER}/api/Auth/logout`]: { status: 204 } },
  });
  await app.press("more-Home Lab");
  await app.waitFor("menu-signOut");
  expect(app.dialogs()).toEqual([]); // no system sheet

  await app.press("menu-remove");
  await app.waitFor("text:Remove Home Lab?");
  await app.press("confirm-cancel");
  await app.waitUntil(() => !app.texts().includes("Remove Home Lab?"));
  expect(app.texts()).toContain("Home Lab");

  await app.press("more-Home Lab");
  await app.press("menu-remove");
  await app.press("confirm-remove");
  await app.waitFor("text:No servers yet");
});

test("instance controls are a dropdown, enabled by state, and ask before stopping", async () => {
  const sent: string[] = [];
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`POST ${SERVER}/api/Shards/a1/*`]: (r) => (sent.push(r.url.split("/").pop()!), { status: 200 }),
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  // From the card's menu on the list: Start is greyed out while running; Stop asks first.
  await app.press("server-Home Lab");
  await app.waitFor("text:Running");
  await app.press("more-Minecraft SMP");
  await app.waitFor("text:Already running");
  await app.press("menu-start").catch(() => {});
  expect(sent).toEqual([]);
  await app.press("menu-stop");
  await app.waitFor("text:Stop Minecraft SMP?");
  await app.press("confirm-stop");
  await app.waitUntil(() => sent.includes("stop"));

  // On the instance page: the Controls dropdown, Restart confirmed.
  await app.press("shard-Minecraft SMP");
  await app.press("controls");
  await app.press("menu-restart");
  await app.waitFor("text:Restart Minecraft SMP?");
  await app.press("confirm-restart");
  await app.waitUntil(() => sent.includes("restart"));
  expect(app.texts()).not.toContain("Start"); // no row of power buttons anymore
});

const totals = (players: number) => ({
  sessions: players * 3,
  uniqueUsers: players,
  newUsers: 2,
  minutes: "1290.5",
  bounceRatePercent: 12.5,
  averageSessionMinutes: 43,
  sessionsPerUser: 3,
  longestSessionMinutes: 260,
  activeUsers: 4,
  activeRatePercent: 50,
});

const analyticsRoute = (request: { url: string }) => {
  const url = request.url;
  if (url.includes("/api/Analytics/sessions/users/")) {
    return {
      body: {
        userKey: "k-steve",
        displayName: "Steve",
        totals: totals(1),
        servers: [{ shardId: "a1", sessions: 3, sessionsPercent: 100, minutes: 300, minutesPercent: 100, users: 1 }],
        sessions: [
          { sessionRef: "s1", shardId: "a1", userKey: "k-steve", idKind: "steam", country: "au", startedAt: new Date(Date.now() - 30 * 60_000).toISOString(), endedAt: "", running: true, displayName: "Steve" },
          { sessionRef: "s2", shardId: "a1", userKey: "k-steve", idKind: "steam", country: "au", startedAt: "2026-11-10T10:00:00Z", endedAt: "2026-11-10T12:15:00Z", running: false, displayName: "Steve" },
        ],
        firstSeen: "2026-10-01T10:00:00Z",
        lastSeen: "2026-11-15T09:00:00Z",
        isActive: true,
        recentVisits: 5,
        rule: { visits: 3, days: 14 },
        serverInfo: { a1: { name: "Minecraft SMP", game: "minecraft-java", gameName: "Minecraft", image: null } },
      },
    };
  }
  if (url.includes("/api/Analytics/profiles")) {
    return {
      body: {
        state: "complete",
        minecraft: {},
        steam: {
          "k-steve": {
            steamId: "7656",
            personaName: "Steve",
            avatarHash: null,
            visibility: "Public",
            createdAt: null,
            countryCode: "au",
            bans: { vacBanned: true, vacBans: 1, gameBans: 0, daysSinceLastBan: 400, communityBanned: false, tradeBanned: false },
            limited: false,
            source: "webapi",
            profileUrl: "https://steamcommunity.com/profiles/7656",
          },
        },
      },
    };
  }
  if (url.includes("/api/Analytics/users")) {
    return { body: { users: [{ userKey: "k-alex", displayName: "Alex", userId: "7657", idKind: "steam", shards: ["a1"], lastSeen: "2026-11-14T09:00:00Z" }], serverInfo: {} } };
  }
  return {
    body: {
      window: { from: "2026-11-08T00:00:00Z", to: "2026-11-15T00:00:00Z" },
      current: totals(8),
      previous: totals(4),
      change: { uniqueUsers: 100, sessions: 100, minutes: 0, newUsers: null, bounceRatePercent: -20 },
      activity: Array.from({ length: 7 }, (_, i) => ({ start: new Date(Date.parse("2026-11-08T00:00:00Z") + i * 86_400_000).toISOString(), end: "", users: i })),
      countries: [{ country: "au", sessions: 20, sessionsPercent: 80, minutes: 1000, minutesPercent: 78, users: 6 }],
      topUsers: [{ userKey: "k-steve", displayName: "Steve", sessions: 9, minutes: 300, percent: 23, servers: 1, online: true }],
      busiest: { start: "2026-11-14T20:00:00Z", end: "", users: 6 },
      quietest: null,
      servers: [{ shardId: "a1", sessions: 24, sessionsPercent: 100, minutes: 1290, minutesPercent: 100, users: 8 }],
      games: [],
      isDemo: url.includes("demo-server"),
      serverInfo: { a1: { name: "Minecraft SMP", game: "minecraft-java", gameName: "Minecraft", image: null } },
      rule: { visits: 3, days: 14 },
    },
  };
};

test("shows player analytics, finds a player and opens their history", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Analytics/*`]: analyticsRoute,
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.waitFor("text:203.0.113.7:2001"); // the address on the card
  await app.press("main-menu");
  await app.waitFor("text:Main Menu");
  await app.press("nav-networking").catch(() => {}); // not in the app yet: stays open
  expect(app.texts()).toContain("Main Menu");
  await app.press("nav-analytics");
  await app.waitFor("text:TOP PLAYERS");
  // Headline figures (minutes as a string), changes, countries and the busiest time.
  expect(app.texts()).toContain("21h 31m");
  expect(app.texts()).toContain("no earlier data"); // newUsers: null
  expect(app.texts()).toContain("▲ 100%");
  expect(app.texts()).toContain("▼ 20%");
  expect(app.texts()).toContain("AU");
  expect(app.texts()).toContain("Steve");
  expect(app.texts()).not.toContain("Demo numbers");
  expect(app.requests().some((r) => r.url.includes("/api/Analytics/sessions?from="))).toBe(true);

  await app.press("period-30d");
  await app.waitUntil(() => app.requests().filter((r) => r.url.includes("/api/Analytics/sessions?")).length >= 2);

  await app.type("player-search", "ale");
  await app.waitFor("match-Alex");

  await app.clear("player-search");
  await app.press("player-Steve");
  await app.waitFor("text:Online now");
  await app.waitFor("text:1 VAC ban");
  expect(app.texts()).toContain("Active player");
  expect(app.texts()).toContain("2h 15m");

  // The menu takes you back to the instance list, not deeper into the stack.
  await app.press("main-menu");
  await app.press("nav-shards");
  await app.waitFor("shard-Minecraft SMP");
  await app.back();
  await app.waitFor("text:Home Lab");
});

test("analytics for one instance asks for just that instance, and says when numbers are demo", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Analytics/*`]: (r) => analyticsRoute({ url: `${r.url}&demo-server` }),
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("open-analytics");
  await app.waitFor("text:Demo numbers");
  expect(app.requests().some((r) => r.url.includes("/api/Analytics/sessions?") && r.url.includes("shard=a1"))).toBe(true);
});

test("analytics without permission explains why", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Analytics/*`]: { status: 403 },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-analytics");
  await app.waitFor("text:Your AMP account can't see analytics. An admin can give your role the analytics permission on this server.");
});

const auditEvent = (id: string, action: string, extra: Record<string, unknown> = {}) => ({
  id,
  tenantId: "t1",
  timestamp: "2026-11-15T03:10:00Z",
  severity: 0,
  principal: { kind: 1, userId: "u1", userDisplayName: "admin", onBehalfOfUserId: null, onBehalfOfUserDisplayName: null, systemSource: null },
  action,
  targetType: "Shard",
  targetId: "a1",
  taskId: null,
  correlationId: { value: `c-${id}` },
  origin: 1,
  details: null,
  originIp: "198.51.100.4",
  originNode: "node-1",
  ...extra,
});

test("the activity log lists flows, filters them, and opens one with its details", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Audit/roots*`]: (r) => {
        const warnings = r.url.includes("minSeverity=Warning");
        const items = [
          {
            correlationId: "c-e1",
            root: auditEvent("e1", "ShardStopped"),
            eventCount: 2,
            startedAt: "2026-11-15T03:10:00Z",
            endedAt: "2026-11-15T03:10:05Z",
            maxSeverity: 1,
            rootMissing: false,
          },
          {
            correlationId: "c-e3",
            root: auditEvent("e3", "UserLoggedIn", { origin: 0, principal: { kind: 0, userId: null, userDisplayName: null, systemSource: "Daily Backup" }, targetType: "", targetId: "" }),
            eventCount: 1,
            startedAt: "2026-11-15T02:00:00Z",
            endedAt: "2026-11-15T02:00:00Z",
            maxSeverity: 0,
            rootMissing: false,
          },
        ].filter((f) => !warnings || f.maxSeverity >= 1);
        return { body: { total: warnings ? 1 : 45, page: 1, pageSize: 30, caughtUp: true, items } };
      },
      [`GET ${SERVER}/api/Audit/tree/*`]: {
        body: {
          correlationId: "c-e1",
          rootMissing: false,
          eventCount: 2,
          startedAt: "",
          endedAt: "",
          root: {
            event: auditEvent("e1", "ShardStopped"),
            children: [{ event: auditEvent("e2", "ShardSettingChanged", { severity: 1, details: '{"PreviousValue":"20","NewValue":"40"}' }), children: [] }],
          },
        },
      },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-activity");
  await app.waitFor("text:Shard stopped");
  expect(app.texts()).toContain("User logged in");
  expect(app.texts()).toContain("admin · Minecraft SMP"); // the instance by name, not its id
  expect(app.texts()).toContain("Daily Backup");
  expect(app.texts()).toContain("2 of 45");

  await app.press("flow-ShardStopped");
  await app.waitFor("text:Shard setting changed");
  await app.press("details-e2");
  await app.waitUntil(() => app.texts().some((x) => x.includes('"NewValue": "40"')));

  await app.press("filter-warnings");
  await app.waitUntil(() => !app.texts().includes("User logged in"));
  expect(app.requests().some((r) => r.url.includes("/api/Audit/roots") && r.url.includes("minSeverity=Warning"))).toBe(true);
});

test("the activity log without permission explains why", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Audit/*`]: { status: 403 },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-activity");
  await app.waitFor("text:Your AMP account can't read the activity log. It needs the audit read permission (platform.audit.read).");
});

test("the overview shows totals, hosts and recent activity in the panel's wording", async () => {
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/assets/i18n/en.json`]: {
        body: { audit: { action: { ShardStopped: "Stopped a server", ShardBusCredentialPruned: "Removed a server's old message bus credential after its renewal" } } },
      },
      [`GET ${SERVER}/api/Spires/sp1/state`]: {
        body: {
          spireId: "sp1",
          online: true,
          shardCount: 4,
          cpuUsagePercent: "8.2",
          memoryUsedMb: 2600,
          memoryTotalMb: 32000,
          networkInKBps: 84,
          networkOutKBps: 12,
          platform: { freeDiskMb: 457728, totalDiskMb: 900000 },
        },
      },
      [`GET ${SERVER}/api/Spires`]: { body: [{ id: "sp1", displayName: "amp3" }] },
      [`GET ${SERVER}/api/Audit/roots*`]: {
        body: {
          total: 2,
          page: 1,
          pageSize: 6,
          caughtUp: true,
          items: [
            { correlationId: "c1", root: auditEvent("e1", "ShardStopped"), eventCount: 1, startedAt: "2026-11-15T03:10:00Z", endedAt: "", maxSeverity: 0, rootMissing: false },
            {
              correlationId: "c2",
              root: auditEvent("e2", "ShardBusCredentialPruned", { origin: 0, principal: { kind: 0, userId: null, userDisplayName: null, systemSource: "BusCredentials" } }),
              eventCount: 1,
              startedAt: "2026-11-15T03:01:00Z",
              endedAt: "",
              maxSeverity: 0,
              rootMissing: false,
            },
          ],
        },
      },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-overview");
  await app.waitFor("text:HOSTS");
  await app.waitFor("text:amp3");
  await app.waitFor("text:4 shards");
  expect(app.texts()).toContain("8%");
  expect(app.texts()).toContain("2.5 GB / 31 GB");
  expect(app.texts()).toContain("↓ 82 KiB/s");
  expect(app.texts()).toContain("2.6 GB"); // RAM of the running instance
  await app.waitFor("text:Stopped a server");
  expect(app.texts()).toContain("Removed a server's old message bus credential after its renewal");
  expect(app.texts()).toContain("BusCredentials · Minecraft SMP");

  await app.press("view-all-activity");
  await app.waitFor("filter-all");
  await app.waitFor("text:Stopped a server");
});

test("spires list the machines, and a machine shows its hardware, addresses, storage, instances and ports", async () => {
  const spireState = {
    spireId: "sp1",
    online: true,
    lastHeartbeat: "2026-11-15T03:00:00Z",
    shardCount: 2,
    cpuUsagePercent: 8,
    memoryUsedMb: 2600,
    memoryTotalMb: 32000,
    networkInKBps: 84,
    networkOutKBps: 12,
    diskActivePercent: 3,
    busLatencyMs: 1.2,
    platform: {
      osName: "Ubuntu 24.04",
      architecture: "X64",
      hostname: "amp3",
      cpu: { modelName: "AMD Ryzen 9 5950X", totalCores: 16, totalThreads: 32 },
      installedRamMb: 32768,
      virtualization: "None",
      reportedIps: [
        { address: "192.168.1.20", isV6: false, isInternal: true, isPrimary: true, isTunnel: false, interfaceName: "eth0" },
      ],
      externalIp: "203.0.113.7",
      reachability: "Nat",
      freeDiskMb: 457728,
      totalDiskMb: 950000,
      loadAvgPercent: 45,
    },
  };
  const app = await open("./App.tsx", {
    storage: signedIn,
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Spires/roster`]: {
        body: [{ spire: { id: "sp1", displayName: "amp3", isLocal: true }, online: true, lastSeen: null, version: "3.0.1", behind: false, installationVersion: "3.0.1" }],
      },
      [`GET ${SERVER}/api/Spires/sp1/state`]: { body: spireState },
      [`GET ${SERVER}/api/Spires/sp1/startup`]: {
        body: [
          { shardId: "a1", shardName: "Minecraft SMP", startOnBoot: true, order: 100 },
          { shardId: "c3", shardName: "Valheim", startOnBoot: false, order: 50 },
        ],
      },
      [`GET ${SERVER}/api/Spires/sp1/ports`]: {
        body: [
          { port: 25565, protocol: "Tcp", ref: "Main", name: "Game port", shardId: "a1", shardName: "Minecraft SMP", ipBinding: "0.0.0.0", running: true, listening: true, conflict: false },
          { port: 2456, protocol: "Udp", ref: "Main", name: "Game port", shardId: "c3", shardName: "Valheim", ipBinding: "0.0.0.0", running: false, listening: false, conflict: true },
        ],
      },
      [`GET ${SERVER}/api/Spires/sp1/datastores`]: { body: [{ id: "d1", name: "Default", path: "/home/amp/shards", isDefault: true, enabled: true, tags: ["NVMe"] }] },
      [`GET ${SERVER}/api/Spires/sp1/usage`]: {
        body: {
          spireId: "sp1",
          scannedAt: "2026-11-15T03:00:00Z",
          datastores: [
            {
              datastoreId: "d1",
              totalUsedMb: 20480,
              driveFreeMb: 457728,
              driveTotalMb: 950000,
              shards: [{ kind: "Shard", shardId: "a1", name: "minecraft-smp", sizeMb: 15360, deleted: false, displayName: "Minecraft SMP" }],
            },
          ],
        },
      },
      [`GET ${SERVER}/api/Spires`]: { body: [{ id: "sp1", displayName: "amp3", isLocal: true, sftpEnabled: true, sftpPort: 2222, tags: ["Melbourne"] }] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-spires");
  await app.waitFor("host-amp3");
  await app.waitFor("text:v3.0.1");
  expect(app.texts()).toContain("Panel host");

  await app.press("host-amp3");
  await app.waitFor("text:AMD Ryzen 9 5950X · 16 cores / 32 threads");
  expect(app.texts()).toContain("Ubuntu 24.04 · X64");
  expect(app.texts()).not.toContain("None"); // bare metal says nothing
  await app.waitFor("text:203.0.113.7");
  expect(app.texts()).toContain("Internet sees · Behind NAT");
  expect(app.texts()).toContain("eth0 · primary · private");
  await app.waitFor("text:SFTP on port 2222");
  await app.waitUntil(() => app.texts().includes("/home/amp/shards"));
  expect(app.texts()).toContain("15 GB");
  await app.waitFor("text:Starts on boot");
  expect(app.texts()).toContain("Clash");
  // Boot order: Valheim (50) before Minecraft (100).
  const t = app.texts();
  const section = t.slice(t.indexOf("INSTANCES"), t.indexOf("PORTS"));
  expect(section.indexOf("Valheim")).toBeLessThan(section.indexOf("Minecraft SMP"));

  await app.press("spire-shard-Minecraft SMP");
  await app.waitFor("text:PERFORMANCE");
});
