import { connectionProblem, isTailscaleHost, normalizeServerUrl, plainHttpRisk } from "./src/api/client";
import { splitCategory } from "./src/api/manage";
import { statusLabel } from "./src/api/schedules";
import { safeHttpsUrl } from "./src/lib/links";
import { uploadFile } from "./src/api/files";
import { hideDetails, priv, privIps, privJson } from "./src/lib/privacy";
import { expect, open, test } from "nsh/test";
import { createVault } from "./src/state/vaultCrypto";

const SERVER = "https://amp.example.test";

/** The PIN of the vault the tests start with. */
const PIN = "246810";

/** Storage with the Home Lab server kept signed in: its token sealed in a vault behind `PIN`, as the app writes it. */
async function vaultStorage(): Promise<Record<string, string>> {
  const { blob } = await createVault(PIN, { s1: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } });
  return {
    "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true }]),
    "amp.vault": JSON.stringify(blob),
  };
}

async function enterPin(app: { press(s: string): Promise<void> }, pin = PIN) {
  for (const digit of pin) await app.press(`pin-${digit}`);
  await app.press("pin-done");
}

/** Opens the app with the vault above and unlocks it, as a returning user does. */
async function openSignedIn(options: NonNullable<Parameters<typeof open>[1]>) {
  const app = await open("./App.tsx", { ...options, storage: { ...(await vaultStorage()), ...(options.storage ?? {}) } });
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app);
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));
  return app;
}


/**
 * Empties an input and waits until it reads empty. A real window reports the change a
 * moment later (typing straight after could land first), and a clear made while a closing
 * menu still fades over the field can miss, so it tries again.
 */
async function clearField(
  app: { clear(s: string): Promise<void>; value(s: string): string | null; wait(ms: number): Promise<void> },
  selector: string,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await app.clear(selector);
    for (let i = 0; i < 10; i++) {
      if ((app.value(selector) ?? "") === "") return;
      await app.wait(100);
    }
  }
  throw new Error(`${selector} never emptied: ${JSON.stringify(app.value(selector))}`);
}

/**
 * Presses a row that opens and waits for what it shows. Far down a long page, a real
 * window scrolls the row in and can tap where it was a moment before, so it tries again.
 */
async function openRow(app: { press(s: string): Promise<void>; count(s: string): number; wait(ms: number): Promise<void> }, row: string, shows: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await app.press(row);
    for (let i = 0; i < 10; i++) {
      if (app.count(shows) > 0) return;
      await app.wait(100);
    }
  }
  throw new Error(`${row} never showed ${shows}`);
}

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
  await app.waitFor("text:AMP Mobile 0.3.0");
  await app.press("confirm-ok");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile 0.2.6"));
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

  // Staying signed in needs a PIN, set twice.
  await app.waitFor("text:Set a PIN to stay signed in");
  await enterPin(app, "135790");
  await app.waitFor("text:Enter it again");
  await enterPin(app, "135790");

  await app.waitFor("text:Minecraft SMP");
  expect(app.texts()).not.toContain("Old server");

  await app.back();
  await app.waitFor("text:Home Lab");
  expect(app.texts()).toContain("Signed in");

  // Remembered without the password, and the token only sealed in the vault.
  const stored = app.storage();
  expect(stored["amp.servers"]).not.toContain("tok-1");
  expect(stored["amp.servers"]).not.toContain('"pw"');
  expect(stored["amp.vault"]).toBeTruthy();
  expect(stored["amp.vault"]).not.toContain("tok-1");
});

test("opens a remembered server straight to its instances", async () => {
  const app = await openSignedIn({
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
  const app = await openSignedIn({
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


test("creates an instance from the catalogue", async () => {
  const created: any[] = [];
  const app = await openSignedIn({
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
  await clearField(app, "template-search");
  await app.press("template-valheim");
  await app.waitFor("text:Create instance");
  await clearField(app, "instance-name");
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
  const app = await openSignedIn({
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
  expect(app.texts()).toContain("Gameplay"); // its icon is drawn, not an emoji
  expect(app.texts().some((t) => /\p{Extended_Pictographic}/u.test(t))).toBe(false);
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

  await clearField(app, "setting-MaxPlayers");
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
  await clearField(app, "setting-infra.cpuLimit");
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
  const app = await openSignedIn({
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

  const app = await openSignedIn({
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

  // Upload through the picker, in chunks. Only headless runs can answer the system's
  // picker (`onPick`); in a real window it reports a cancel, so there the upload and the
  // delete of the uploaded file are left to the headless run.
  let picked = false;
  app.onPick(() => {
    picked = true;
    return [{ name: "mod.jar", data: new Uint8Array([1, 2, 3, 4, 5]) }];
  });
  await app.press("upload");
  await app.wait(500);
  if (!picked) {
    expect(app.texts()).not.toContain("Uploaded.");
    expect(calls).toEqual(["write server.properties", "folder mods"]);
    return;
  }
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
  const app = await openSignedIn({
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
  const app = await openSignedIn({
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

test("the looks after a power action stop when the page is left, so signing out doesn't jump to sign in", async () => {
  const app = await openSignedIn({
    clock: {},
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`POST ${SERVER}/api/Auth/logout`]: { status: 204 },
      [`POST ${SERVER}/api/Shards/a1/*`]: { status: 200 },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  await app.press("server-Home Lab");
  await app.waitFor("text:Running");
  await app.press("more-Minecraft SMP");
  await app.press("menu-stop");
  await app.press("confirm-stop");
  await app.waitUntil(() => app.requests().some((r) => r.url.endsWith("/a1/stop")));
  await app.press("back");
  await app.waitFor("text:Your servers");
  await app.press("more-Home Lab");
  await app.press("menu-signOut");
  await app.waitFor("text:Signed out");
  const asked = app.requests().length;
  await app.wait(16_000);
  expect(app.texts()).toContain("Your servers");
  expect(app.requests().slice(asked).filter((r) => r.url.includes("/api/Shards"))).toEqual([]);
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
  const app = await openSignedIn({
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
  expect(app.texts()).not.toContain("SOON"); // every section is in the app
  await app.press("nav-analytics");
  await app.waitFor("text:TOP PLAYERS");
  // Headline figures (minutes as a string), changes, countries and the busiest time.
  expect(app.texts()).toContain("21h 31m");
  expect(app.texts()).toContain("no earlier data"); // newUsers: null
  expect(app.texts()).toContain("100%"); // with a rise icon
  expect(app.texts()).toContain("20%"); // with a fall icon
  expect(app.texts()).toContain("AU");
  expect(app.texts()).toContain("Steve");
  expect(app.texts()).not.toContain("Demo numbers");
  expect(app.requests().some((r) => r.url.includes("/api/Analytics/sessions?from="))).toBe(true);

  await app.press("period-30d");
  await app.waitUntil(() => app.requests().filter((r) => r.url.includes("/api/Analytics/sessions?")).length >= 2);

  await app.type("player-search", "ale");
  await app.waitFor("match-Alex");

  await clearField(app, "player-search");
  await app.waitFor("player-Steve"); // the top players are back once the search is empty
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
  const app = await openSignedIn({
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
  const app = await openSignedIn({
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
  const app = await openSignedIn({
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
  const app = await openSignedIn({
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
  const app = await openSignedIn({
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
          total: 3,
          page: 1,
          pageSize: 6,
          caughtUp: true,
          items: [
            { correlationId: "c1", root: auditEvent("e1", "ShardStopped"), eventCount: 1, startedAt: "2026-11-15T03:10:00Z", endedAt: "", maxSeverity: 0, rootMissing: false },
            {
              correlationId: "c3",
              root: { ...auditEvent("e3", "SftpLoginFailed", { origin: 0, principal: { kind: 0, userId: null, userDisplayName: null, systemSource: "Sftp" } }), targetType: "Address", targetId: "203.0.113.9" },
              eventCount: 1,
              startedAt: "2026-11-15T03:05:00Z",
              endedAt: "",
              maxSeverity: 0,
              rootMissing: false,
            },
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
  expect(app.texts()).toContain("82 KiB/s"); // with its "received" arrow icon
  expect(app.texts()).toContain("2.6 GB"); // RAM of the running instance
  await app.waitFor("text:Stopped a server");
  expect(app.texts()).toContain("Removed a server's old message bus credential after its renewal");
  expect(app.texts()).toContain("BusCredentials · Minecraft SMP");
  // Like the Activity page: what an event acted on, an address included.
  expect(app.texts()).toContain("Sftp · Address: 203.0.113.9");

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
  const app = await openSignedIn({
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

test("networking shows the panel's address, ports, publications, tunnels and firewall, and changes access", async () => {
  const accessCalls: string[] = [];
  const pubCalls: string[] = [];
  let ports = [
    { ref: "Main", name: "Game port", protocol: "Tcp", port: 25565, isPublic: true, custom: false, primary: true },
    { ref: "Rcon", name: "RCON", protocol: "Tcp", port: 25575, isPublic: true, custom: false, primary: false },
  ];
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/https`]: {
        body: {
          mode: "managed",
          hostName: "panel.example.test",
          url: "https://panel.example.test",
          certificateVerified: true,
          agentPresent: true,
          panelExposed: true,
          entryNode: false,
          externalAddress: "203.0.113.7",
          reachability: "Nat",
          internalAddress: "192.168.1.20",
          ipv6Address: null,
          trustedProxies: [],
        },
      },
      [`GET ${SERVER}/api/networking/publications`]: {
        body: [
          {
            id: "p1",
            frontSpireId: "sp2",
            publicPort: 30000,
            protocol: "Udp",
            shardId: "a1",
            portRef: "Main",
            enabled: true,
            createdAt: "",
            status: { state: "Active", activeFlows: 3, bytesIn: 1572864, bytesOut: 204800 },
          },
        ],
      },
      [`PUT ${SERVER}/api/networking/publications/p1`]: (r) => (pubCalls.push(r.body!), { body: {} }),
      [`GET ${SERVER}/api/networking/gateways`]: { body: [] },
      [`GET ${SERVER}/api/networking/tunnels`]: {
        body: [
          {
            id: "t1",
            frontSpireId: "sp2",
            backSpireId: "sp1",
            frontEndpointHost: "vps.example.test",
            interfaceName: "wg0",
            listenPort: 51820,
            front: { spireId: "sp2", spireName: "melb-vps", keyPublished: true, agentInstalled: true, agentReachable: true, agentError: null },
            back: { spireId: "sp1", spireName: "amp3", keyPublished: true, agentInstalled: true, agentReachable: true, agentError: null },
            status: { up: true, rttMs: 14.2, phase: "Up" },
          },
        ],
      },
      [`GET ${SERVER}/api/networking/firewall`]: {
        body: {
          running: true,
          status: { backend: "nftables", healthy: true, applied: [{ port: 25565, protocol: "TCP", label: "Minecraft SMP" }], rejected: [], advisories: [] },
          withheld: [{ shardId: "a1", shardName: "Minecraft SMP", source: "Shard", port: 2222, protocol: "TCP", kind: "Sftp" }],
        },
      },
      [`GET ${SERVER}/api/Shards/a1/ports`]: () => ({ body: ports }),
      [`PUT ${SERVER}/api/Shards/a1/ports/Rcon/access`]: (r) => {
        accessCalls.push(r.body!);
        ports = ports.map((p) => (p.ref === "Rcon" ? { ...p, isPublic: JSON.parse(r.body!).public } : p));
        return { body: ports };
      },
      [`GET ${SERVER}/api/Spires`]: { body: [{ id: "sp2", displayName: "melb-vps", publicHost: "vps.example.test" }] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-networking");
  await app.waitFor("text:HTTPS by AMP");
  expect(app.texts()).toContain("Certificate OK");
  expect(app.texts()).toContain("Behind NAT: forward ports on your router");
  expect(app.texts()).toContain("This machine: point port forwards here");

  await app.waitFor("text:Published on vps.example.test:30000");
  expect(app.texts()).toContain("vps.example.test:30000");
  for (const t of ["3 connections", "1.5 MB", "200 KB", "amp3", "melb-vps"]) expect(app.texts()).toContain(t);
  expect(app.texts()).toContain("vps.example.test:51820 · 14 ms");
  expect(app.texts()).toContain("nftables");
  expect(app.texts()).toContain("Minecraft SMP: port 2222 is held by AMP's SFTP server, so it's unreachable until moved.");

  // RCON private, confirmed first; the main port has no menu.
  expect(app.count("port-more-Main")).toBe(0);
  await app.press("port-more-Rcon");
  await app.press("menu-private");
  await app.waitFor("text:Make RCON private?");
  await app.press("confirm-go");
  await app.waitFor("text:RCON is now private.");
  expect(accessCalls).toEqual(['{"public":false}']);

  // Pause the publication.
  await app.press("pub-more-30000");
  await app.press("menu-pause");
  await app.waitUntil(() => pubCalls.length === 1);
  expect(JSON.parse(pubCalls[0])).toEqual({ enabled: false, publicPort: 30000 });
});

test("access lists users, roles and invites; edits a user, resets a password and sends an invite", async () => {
  const puts: unknown[] = [];
  const resets: unknown[] = [];
  const created: unknown[] = [];
  let bob = {
    id: "u2",
    userName: "bob",
    displayName: "Bob",
    email: null,
    roleIds: ["r2"],
    isAdmin: false,
    suspended: false,
    passwordExpires: false,
    requirePasswordChange: false,
    createdAt: "2026-10-01T00:00:00Z",
    lastLoginAt: null,
  };
  const admin = { ...bob, id: "u1", userName: "admin", displayName: null, roleIds: ["r1"], isAdmin: true, lastLoginAt: "2026-11-15T01:00:00Z" };
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/users`]: () => ({ body: [admin, bob] }),
      [`GET ${SERVER}/api/users/u2`]: () => ({ body: bob }),
      [`PUT ${SERVER}/api/users/u2`]: (r) => {
        const body = JSON.parse(r.body!);
        puts.push(body);
        bob = { ...bob, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)) };
        return { body: bob };
      },
      [`POST ${SERVER}/api/users/u2/reset-password`]: (r) => (resets.push(JSON.parse(r.body!)), { status: 204 }),
      [`GET ${SERVER}/api/roles`]: {
        body: [
          { id: "r1", name: "Administrators", description: "Everything", permissions: ["*"], createdAt: "" },
          { id: "r2", name: "Moderators", description: "Start and stop", permissions: ["shard.*.view", "shard.*.power", "-shard.*.delete"], createdAt: "" },
        ],
      },
      [`GET ${SERVER}/api/invites`]: {
        body: [
          {
            id: "i1",
            userName: "carol",
            displayName: null,
            roleIds: ["r2"],
            createdByName: "admin",
            createdAt: "2026-11-14T00:00:00Z",
            expiresAt: "2026-11-17T00:00:00Z",
            accepted: false,
            acceptedAt: null,
            status: "pending",
          },
        ],
      },
      [`POST ${SERVER}/api/invites`]: (r) => {
        const body = JSON.parse(r.body!);
        created.push(body);
        return { body: { invite: { id: "i2", userName: body.userName, roleIds: body.roleIds, status: "pending", createdAt: "", expiresAt: "" }, token: "abc 123" } };
      },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-access");
  await app.waitFor("user-bob");
  expect(app.texts()).toContain("(you)"); // signed in as admin
  expect(app.texts()).toContain("Moderators");
  expect(app.texts()).toContain("bob · never signed in");

  // Roles: members and permissions.
  await app.press("tab-roles");
  await app.waitFor("text:Members: Bob");
  await app.press("role-Moderators");
  await app.waitFor("text:-shard.*.delete");

  // Invites: one pending; a new one shows its link once.
  await app.press("tab-invites");
  // The date is in the device's own format.
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("Moderators · expires ") && t.endsWith(" · by admin")));
  await app.press("text:New invite");
  await app.type("invite-username", "dave");
  await app.press("text:Create invite");
  await app.waitFor("text:Pick at least one role: an account with none can't do anything.");
  await app.press("invite-role-Moderators");
  await app.press("expiry-168");
  await app.press("text:Create invite");
  await app.waitFor("text:Invite link for dave");
  expect(app.texts()).toContain(`${SERVER}/invite?token=abc%20123`);
  expect(created).toEqual([{ userName: "dave", displayName: null, roleIds: ["r2"], expiresInHours: 168 }]);
  await app.press("invite-done");
  await app.waitFor("tab-invites");

  // A user: add a role and suspend (confirmed), then reset the password.
  await app.press("tab-users");
  await app.press("user-bob");
  await app.waitFor("role-check-Administrators");
  await app.press("role-check-Administrators");
  await app.press("text:Suspended (can't sign in)");
  await app.press("text:Save 2 changes");
  await app.waitFor("text:Suspend Bob?");
  await app.press("confirm-go");
  await app.waitFor("text:Saved.");
  expect(puts).toEqual([
    { displayName: null, email: null, roleIds: ["r2", "r1"], suspended: true, passwordExpires: null, requirePasswordChange: null },
  ]);

  await app.press("reset-password");
  await app.type("prompt-input", "n3w-pass!");
  await app.press("prompt-confirm");
  await app.waitFor("text:Password changed. They've been signed out.");
  expect(resets).toEqual([{ newPassword: "n3w-pass!" }]);
});

test("adding a user sends the form and opens the new account", async () => {
  const posted: unknown[] = [];
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/users`]: { body: [] },
      [`GET ${SERVER}/api/roles`]: { body: [{ id: "r2", name: "Moderators", description: null, permissions: [], createdAt: "" }] },
      [`GET ${SERVER}/api/invites`]: { status: 403 },
      [`POST ${SERVER}/api/users`]: (r) => {
        posted.push(JSON.parse(r.body!));
        return { body: { id: "u9", userName: "erin", displayName: "Erin", email: null, roleIds: ["r2"], isAdmin: false, suspended: false, passwordExpires: false, requirePasswordChange: true, createdAt: null, lastLoginAt: null } };
      },
      [`GET ${SERVER}/api/users/u9`]: {
        body: { id: "u9", userName: "erin", displayName: "Erin", email: null, roleIds: ["r2"], isAdmin: false, suspended: false, passwordExpires: false, requirePasswordChange: true, createdAt: null, lastLoginAt: null },
      },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-access");
  await app.press("text:Add user");
  await app.type("new-username", "erin");
  await app.type("new-password", "Temp-pass-1");
  await app.type("display-name", "Erin");
  await app.press("role-check-Moderators");
  await app.press("text:Add user");
  await app.waitFor("text:Delete user");
  expect(posted).toEqual([
    { userName: "erin", password: "Temp-pass-1", displayName: "Erin", email: null, roleIds: ["r2"], passwordExpires: false, requirePasswordChange: true },
  ]);

  // Invites refused: only that tab says so.
  await app.back();
  await app.press("tab-invites");
  await app.waitFor("text:Your AMP account can't manage invites.");
});

test("settings shows your account, updates, licence and the panel's settings, and saves changes", async () => {
  const saved: unknown[] = [];
  const passwords: unknown[] = [];
  const actions: string[] = [];
  let values: Record<string, string> = { "smtp.enabled": "false", "smtp.host": "", "smtp.password": "", "security.minLength": "8" };
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/assets/i18n/en.json`]: {
        body: {
          settings: {
            category: { email: "Email", security: "Security" },
            smtp: { enabled: "Send email", host: "SMTP server", password: "SMTP password", hostHelp: "Where mail is sent from" },
            security: { minLength: "Minimum password length" },
            actions: { "smtp.test": "Send a test email" },
          },
        },
      },
      [`GET ${SERVER}/api/settings/manifest`]: () => ({
        body: {
          specs: [
            { fieldName: "smtp.enabled", displayName: "settings.smtp.enabled", category: "settings.category.email", inputType: "checkbox", order: 1 },
            {
              fieldName: "smtp.host",
              displayName: "settings.smtp.host",
              description: "settings.smtp.hostHelp",
              category: "settings.category.email",
              inputType: "text",
              order: 2,
              conditionSetting: "smtp.enabled",
              conditionValue: "true",
            },
            {
              fieldName: "smtp.password",
              displayName: "settings.smtp.password",
              category: "settings.category.email",
              inputType: "password",
              isSecret: true,
              order: 3,
              conditionSetting: "smtp.enabled",
              conditionValue: "true",
            },
            // Panels also send bare group keys: worded by the panel when it can, made readable otherwise.
            { fieldName: "security.minLength", displayName: "settings.security.minLength", category: "security", inputType: "number", order: 1 },
            { fieldName: "net.publicHost", displayName: "Public host", category: "public-address", inputType: "text", order: 1 },
          ],
          values,
          secretHasValue: { "smtp.password": true },
          actions: [{ id: "smtp.test", category: "settings.category.email", subcategory: "" }],
          unavailable: { "security.minLength": "settings.lockedHere" },
        },
      }),
      [`POST ${SERVER}/api/settings/values`]: (r) => {
        const body = JSON.parse(r.body!);
        saved.push(body);
        values = { ...values, ...body };
        return { body: { notices: [] } };
      },
      [`POST ${SERVER}/api/settings/actions/smtp.test`]: () => (actions.push("smtp.test"), { body: { message: "Sent to admin@example.test" } }),
      [`GET ${SERVER}/api/Updates/check`]: {
        body: {
          currentVersion: "3.0.1",
          stream: "Mainline",
          availableStreams: ["Mainline"],
          latestVersion: "3.0.2",
          updateAvailable: true,
          mandatory: false,
          codename: "Ember",
          releaseNotesUrl: "https://example.test/notes",
          supervised: true,
          canApply: true,
          note: null,
          spiresBehind: [{ spireId: "sp2", name: "melb-vps", version: "3.0.0", online: true }],
          packageManaged: false,
        },
      },
      [`GET ${SERVER}/api/licence`]: {
        body: {
          licences: [{ spireName: "amp3", productName: "AMP", gradeName: "Professional", state: "Valid", standing: "Active", expires: null, graceEnds: null, shardLimit: 10 }],
          shardCount: 4,
          otherInstallationShards: 0,
          licensed: true,
          confirmed: true,
          shardLimit: 10,
          lastVerifiedAt: null,
        },
      },
      [`GET ${SERVER}/api/Profile`]: { body: { id: "u1", userName: "admin", displayName: "Ironwing Admin", email: "admin@example.test", emailConfirmed: true } },
      [`GET ${SERVER}/api/Profile/sessions`]: {
        body: [
          { id: "s1", createdAt: "", lastSeenAt: "2026-11-15T03:00:00Z", expiresAt: "", remoteIp: "198.51.100.4", userAgent: "okhttp", isCurrent: true },
          {
            id: "s2",
            createdAt: "",
            lastSeenAt: "2026-11-14T03:00:00Z",
            expiresAt: "",
            remoteIp: "198.51.100.9",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
            isCurrent: false,
          },
        ],
      },
      [`POST ${SERVER}/api/Profile/password`]: (r) => (passwords.push(JSON.parse(r.body!)), { status: 204 }),
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-settings");
  await app.waitFor("text:Ironwing Admin");
  expect(app.texts()).toContain("Chrome on Windows");
  expect(app.texts()).toContain("This app");
  await app.waitFor("text:3.0.2 available");
  expect(app.texts()).toContain("melb-vps is still on 3.0.0.");
  expect(app.texts()).toContain("AMP Professional Edition");
  expect(app.texts()).toContain("4 instances of 10 allowed");

  // Settings in the panel's words; the SMTP fields show once email is on.
  for (const group of ["Email", "Security", "Public address"]) expect(app.texts()).toContain(group);
  expect(app.texts()).not.toContain("public-address");
  await app.press("group-Email");
  await app.waitFor("text:Send email");
  expect(app.texts()).not.toContain("SMTP server");
  await app.press("text:Send email");
  await app.waitFor("text:SMTP server");
  expect(app.texts()).toContain("Where mail is sent from");
  await app.type("setting-smtp.host", "mail.example.test");
  await app.press("text:Save 2 changes");
  await app.waitFor("text:Saved.");
  expect(saved).toEqual([{ "smtp.enabled": "true", "smtp.host": "mail.example.test" }]);

  await app.press("action-smtp.test");
  await app.waitFor("text:Send a test email: Sent to admin@example.test");

  // Your password.
  await app.press("change-password");
  await app.type("current-password", "old");
  await app.type("new-password", "new-1");
  await app.type("repeat-password", "new-2");
  await app.press("save-password");
  await app.waitFor("text:The new passwords don't match.");
  await clearField(app, "repeat-password");
  await app.type("repeat-password", "new-1");
  await app.press("save-password");
  await app.waitFor("text:Password changed. Your other sessions were signed out.");
  expect(passwords).toEqual([{ currentPassword: "old", newPassword: "new-1" }]);
});

test("roles are edited as a permission tree, with wildcards, blocks and raw grants", async () => {
  const puts: unknown[] = [];
  const posts: unknown[] = [];
  let mods = { id: "r2", name: "Moderators", description: "Start and stop", permissions: ["spire.*.shard.*.view", "spire.*.shard.*.power.*"], createdAt: "" };
  const ALL = "servers/spire.any.shard.any.all";
  const MC = "servers/spire.any.shard.a1.all";
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/assets/i18n/en.json`]: { body: { access: { tree: { servers: "Servers", allServers: "All servers", power: "Power", stop: "Stop", files: "Files", platform: "Platform", audit: "Audit log" } } } },
      [`GET ${SERVER}/api/users`]: { body: [] },
      [`GET ${SERVER}/api/invites`]: { body: [] },
      [`GET ${SERVER}/api/roles`]: () => ({ body: [mods] }),
      [`PUT ${SERVER}/api/roles/r2`]: (r) => {
        const body = JSON.parse(r.body!);
        puts.push(body);
        mods = { ...mods, ...body };
        return { body: mods };
      },
      [`POST ${SERVER}/api/roles`]: (r) => (posts.push(JSON.parse(r.body!)), { status: 201, body: { id: "r3", ...JSON.parse(r.body!), createdAt: "" } }),
      [`GET ${SERVER}/api/me/permissions`]: { body: { grants: ["*"], catalog: [], roleIds: ["r1"] } },
      [`GET ${SERVER}/api/Spires`]: { body: [{ id: "sp1", displayName: "amp3" }] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });

  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-access");
  await app.press("tab-roles");
  await app.press("role-Moderators");
  await app.press("edit-role-Moderators");
  await app.waitFor("text:All servers");

  // All servers: view and every power action are on; files are off until switched on.
  await app.press(`perm-open-${ALL}`);
  await app.waitFor("text:Power");
  expect(app.texts()).toContain("all, including anything added later");
  await app.press(`perm-${ALL}/spire.any.shard.any.files.any`);

  // One instance: power is allowed by the wider grant; stopping it there is blocked.
  await openRow(app, `perm-open-${MC}`, `perm-open-${MC}/spire.any.shard.a1.power.any`);
  // Scroll it clear of the Cancel / Save bar at the bottom, as a person would.
  await app.scroll(`perm-open-${MC}`, 400);
  await openRow(app, `perm-open-${MC}/spire.any.shard.a1.power.any`, `perm-${MC}/spire.any.shard.a1.power.any/spire.any.shard.a1.power.stop`);
  expect(app.texts()).toContain("allowed by a wider permission");
  await app.press(`perm-${MC}/spire.any.shard.a1.power.any/spire.any.shard.a1.power.stop`);
  await app.waitFor("text:Blocked");

  // A grant the tree doesn't show.
  await app.type("extra-grant", "webhooks.custom");
  await app.press("add-grant");
  await app.waitFor("remove-grant-webhooks.custom");

  await app.press("text:Save role");
  await app.waitUntil(() => puts.length === 1);
  expect(puts[0]).toEqual({
    name: "Moderators",
    description: "Start and stop",
    permissions: ["spire.*.shard.*.view", "spire.*.shard.*.power.*", "spire.*.shard.*.files.*", "-spire.*.shard.a1.power.stop", "webhooks.custom"],
  });
  await app.waitFor("tab-roles");

  // A new role.
  await app.press("text:New role");
  await app.waitFor("text:PLATFORM");
  await app.press("text:Create role");
  await app.waitFor("text:Give the role a name.");
  await app.type("role-name", "Auditors");
  await app.press("perm-platform/audit.read");
  await app.press("text:Create role");
  await app.waitUntil(() => posts.length === 1);
  expect(posts[0]).toEqual({ name: "Auditors", description: null, permissions: ["audit.read"] });
});

// ---- The token vault and the lock -------------------------------------------------------------

const unlockedHome = {
  [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
  [`POST ${SERVER}/api/Auth/logout`]: { status: 204 },
  [`GET ${SERVER}/api/Shards*`]: shardsRoute,
};

test("each server card says whether its panel answers, signed in or not", async () => {
  const OTHER = "https://down.example.test";
  let up = true;
  const app = await open("./App.tsx", {
    storage: {
      "amp.servers": JSON.stringify([
        { id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: false },
        { id: "s2", name: "Far Away", serverUrl: OTHER, username: "admin", color: 1, rememberMe: false },
      ]),
    },
    network: {
      [`GET ${SERVER}/api/Auth/password-policy`]: () => (up ? { body: { minLength: 8 } } : { status: 502, body: "Bad Gateway" }),
      [`GET ${OTHER}/api/Auth/password-policy`]: { error: "connection refused" },
    },
    clock: {},
  });
  await app.waitFor("id:reach-Home Lab >> text:Online");
  await app.waitFor("id:reach-Far Away >> text:Offline");
  // No token goes with the check.
  expect(app.requests().every((r) => !r.headers.authorization && !r.headers.Authorization)).toBe(true);
  // A proxy answering for a panel that's down counts as offline, at the next check.
  up = false;
  await app.wait(61_000);
  await app.waitFor("id:reach-Home Lab >> text:Offline");
});

test("a wrong PIN is counted, waits grow after five, and the tenth erases the saved sign-ins", async () => {
  const app = await open("./App.tsx", { storage: await vaultStorage(), network: unlockedHome });
  await app.waitFor("text:AMP Mobile is locked");
  expect(app.requests().length).toBe(0); // nothing is asked of the server while locked

  await enterPin(app, "111222");
  await app.waitFor("text:Wrong PIN. 9 tries left before your saved sign-ins are erased.");
  expect(JSON.parse(app.storage()["amp.vault.lockout"]!).failures).toBe(1);

  // A count that survives restarts: at nine, one more wrong PIN erases the vault.
  const storage = { ...(await vaultStorage()), "amp.vault.lockout": JSON.stringify({ failures: 9, until: 0 }) };
  const again = await open("./App.tsx", { storage, network: unlockedHome });
  await again.waitFor("text:AMP Mobile is locked");
  await enterPin(again, "111222");
  await again.waitUntil(() => !again.texts().includes("AMP Mobile is locked"));
  expect(again.texts()).toContain("Signed out");
  expect(again.storage()["amp.vault"]).toBeUndefined();
  expect(again.storage()["amp.servers"]).toContain("Home Lab"); // the server stays
});

test("five wrong PINs make the next try wait", async () => {
  const storage = { ...(await vaultStorage()), "amp.vault.lockout": JSON.stringify({ failures: 4, until: 0 }) };
  const app = await open("./App.tsx", { storage, network: unlockedHome });
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app, "111222");
  await app.waitFor("text:Try again in 30 s");
  // Even the right PIN is ignored until the wait is over.
  await enterPin(app);
  await app.wait(300);
  expect(app.texts()).toContain("AMP Mobile is locked");
  expect(JSON.parse(app.storage()["amp.vault.lockout"]!).failures).toBe(5);
});

test("forgot PIN erases the saved sign-ins after asking", async () => {
  const app = await open("./App.tsx", { storage: await vaultStorage(), network: unlockedHome });
  await app.press("forgot-pin");
  await app.waitFor("text:Forgot your PIN?");
  await app.press("confirm-erase");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));
  expect(app.texts()).toContain("Signed out");
  expect(app.storage()["amp.vault"]).toBeUndefined();
});

test("a plain-text token from an older version is scrubbed from disk at once", async () => {
  const app = await open("./App.tsx", {
    storage: {
      "amp.servers": JSON.stringify([
        { id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" },
      ]),
    },
    network: unlockedHome,
  });
  await app.waitFor("text:Set a PIN to stay signed in");
  expect(app.storage()["amp.servers"]).not.toContain("tok-1");

  // Declining keeps this run signed in, from memory, and stops asking.
  await app.press("pin-cancel");
  await app.waitFor("text:Signed in");
  expect(app.storage()["amp.vault"]).toBeUndefined();
  expect(JSON.parse(app.storage()["amp.servers"]!)[0].rememberMe).toBe(false);
});

test("a weak or mismatched PIN is refused", async () => {
  const app = await open("./App.tsx", {
    storage: { "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" }]) },
    network: unlockedHome,
  });
  await app.waitFor("text:Set a PIN to stay signed in");
  await enterPin(app, "123456");
  await app.waitFor("text:That PIN is too easy to guess");
  await enterPin(app, "777777");
  await app.waitFor("text:That PIN is too easy to guess");
  await enterPin(app, "135790");
  await enterPin(app, "135791");
  await app.waitFor("text:The PINs don't match. Start again.");
});

test("the app locks itself in the background, and unlocking renews the sessions", async () => {
  const storage = { ...(await vaultStorage()), "amp.security": JSON.stringify({ autoLockSeconds: 0 }) };
  const app = await openSignedIn({ storage, network: unlockedHome });
  await app.waitFor("text:Signed in");
  expect(app.requests().some((r) => r.url.endsWith("/api/Auth/renew"))).toBe(true);

  // Only headless runs can send the app to the background; a real window stops here.
  try {
    await app.setLifecycle("background");
  } catch {
    return;
  }
  await app.setLifecycle("active");
  await app.waitFor("text:AMP Mobile is locked");
  expect(app.texts()).not.toContain("Home Lab"); // hidden behind the lock
  await enterPin(app);
  await app.waitFor("text:Signed in");
});

test("a renewal that finishes after a sign-out doesn't sign the server back in", async () => {
  const app = await openSignedIn({
    network: {
      ...unlockedHome,
      [`POST ${SERVER}/api/Auth/renew`]: { delay: 400, body: { token: "tok-2", expiration: "2099-01-02T00:00:00Z" } },
    },
  });
  await app.waitFor("server-Home Lab");
  // Sign out while the launch renewal is still in flight.
  await app.press("more-Home Lab");
  await app.press("menu-signOut");
  await app.waitFor("text:Signed out");
  await app.wait(700);
  expect(app.texts()).toContain("Signed out");
  expect(app.storage()["amp.vault"]).not.toContain("tok-2");
});

test("a saved session past its token's expiry is still offered for renewal", async () => {
  const { blob } = await createVault(PIN, { s1: { token: "tok-old", expiration: "2020-01-01T00:00:00Z" } });
  const renewedWith: string[] = [];
  const app = await open("./App.tsx", {
    storage: {
      "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true }]),
      "amp.vault": JSON.stringify(blob),
    },
    network: {
      ...unlockedHome,
      [`POST ${SERVER}/api/Auth/renew`]: (r) => (renewedWith.push(r.headers.authorization), { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } }),
    },
  });
  await enterPin(app);
  await app.waitFor("text:Signed in");
  expect(renewedWith).toEqual(["Bearer tok-old"]);
});

test("the security page changes the PIN, locks on demand and sets the auto-lock", async () => {
  const app = await openSignedIn({ network: unlockedHome });
  await app.press("security");
  await app.waitFor("text:App PIN");
  expect(app.texts()).toContain("On");

  await app.press("autolock-300");
  await app.waitUntil(() => JSON.parse(app.storage()["amp.security"] ?? "{}").autoLockSeconds === 300);

  // A wrong current PIN is refused; the right one leads on.
  await app.press("change-pin");
  await enterPin(app, "999000");
  await enterPin(app, "864200");
  await enterPin(app, "864200");
  await app.waitFor("text:That isn't your current PIN.");
  await enterPin(app);
  await enterPin(app, "864200");
  await enterPin(app, "864200");
  await app.waitFor("text:PIN changed.");

  await app.press("lock-now");
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app); // the old PIN no longer opens it
  await app.waitFor("text:Wrong PIN. 9 tries left before your saved sign-ins are erased.");
  await enterPin(app, "864200");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));
  await app.waitFor("text:App PIN"); // back where it was
});

// ---- Transport -----------------------------------------------------------------------------

test("plain HTTP on the internet needs the tick, and addresses with credentials or other schemes are refused", async () => {
  const PUB = "http://amp.example.test";
  const app = await open("./App.tsx", {
    network: {
      [`POST ${PUB}/api/Auth/login`]: { body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } },
      [`GET ${PUB}/api/Auth/password-policy`]: { body: {} },
      [`GET ${PUB}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("Add Server");
  await app.type("server", "ftp://amp.example.test");
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");
  await app.waitFor("text:The address must start with https:// (or http://)");

  await clearField(app, "server");
  await app.type("server", "https://admin:pw@amp.example.test");
  await app.press("text:Add Server");
  await app.waitFor("text:Leave the user name and password out of the address");
  expect(app.requests().length).toBe(0); // nothing was sent anywhere

  // An internet address over plain HTTP: the warning, and nothing sent until the box is ticked.
  await clearField(app, "server");
  await app.type("server", PUB);
  await app.waitFor("text:Not secure: plain HTTP");
  await app.press("text:Add Server");
  await app.waitFor("text:Tick the box to confirm you understand your login will travel unencrypted, or use https://.");
  expect(app.requests().some((r) => r.url.includes("/api/Auth/login"))).toBe(false);
  await app.press("plain-http-understood");
  await app.press("Stay signed in");
  await app.press("text:Add Server");
  await app.waitFor("text:Running");
  await app.press("back");
  await app.waitFor("text:Your servers");
  expect(app.shows("insecure-amp.example.test")).toBe(true);
});

test("plain HTTP on the local network asks first, every sign-in", async () => {
  const LAN = "http://192.168.1.20:8080";
  const app = await open("./App.tsx", {
    network: {
      [`POST ${LAN}/api/Auth/login`]: { body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } },
      [`GET ${LAN}/api/Auth/password-policy`]: { body: {} },
      [`GET ${LAN}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("Add Server");
  await app.type("server", LAN);
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.waitFor("text:Not secure: plain HTTP");
  expect(app.shows("plain-http-understood")).toBe(false); // a confirm, not a tick, on the local network
  await app.press("text:Add Server");
  await app.waitFor("text:Send your login unencrypted?");
  await app.press("confirm-cancel");
  expect(app.requests().some((r) => r.url.includes("/api/Auth/login"))).toBe(false);
  await app.press("text:Add Server");
  await app.waitFor("text:Send your login unencrypted?");
  await app.press("confirm-send");
  await app.waitFor("text:Running");
});

test("a redirect is refused, so the session token never follows it to another host", async () => {
  const app = await openSignedIn({
    network: {
      ...unlockedHome,
      [`GET ${SERVER}/api/Shards*`]: { status: 302, headers: { Location: "https://evil.example.test/steal" } },
      "GET https://evil.example.test/*": { body: [] },
    },
  });
  await app.press("server-Home Lab");
  await app.waitFor("text:Try again");
  expect(app.requests().some((r) => r.url.startsWith("https://evil.example.test"))).toBe(false);
});

// ---- Edge cases and races --------------------------------------------------------------------

test("a 401 first offers AMP a renewal, and only a refusal sends the user to sign in", async () => {
  let token = "tok-1";
  let renewOk = true;
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: () => (renewOk ? ((token = "tok-2"), { body: { token: "tok-2", expiration: "2099-01-02T00:00:00Z" } }) : { status: 401 }),
      [`GET ${SERVER}/api/Shards*`]: (r) =>
        r.headers.authorization === `Bearer ${token}` && token === "tok-2" ? shardsRoute({ ...r, headers: { authorization: "Bearer tok-1" } }) : { status: 401 },
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  // The launch renewal already moved the session to tok-2, so the list loads.
  await app.press("server-Home Lab");
  await app.waitFor("text:Minecraft SMP");
  expect(app.texts()).not.toContain("Sign in to Home Lab");

  // Now AMP refuses: the next 401 can't be renewed, so it's back to sign in.
  token = "revoked";
  renewOk = false;
  await app.back();
  await app.press("server-Home Lab");
  await app.waitFor("text:Sign in to Home Lab");
});

test("locking cancels an open dialog, so nothing is answered behind the lock", async () => {
  const sent: string[] = [];
  const storage = { "amp.security": JSON.stringify({ autoLockSeconds: 0 }) };
  const app = await openSignedIn({
    storage,
    network: {
      ...unlockedHome,
      [`POST ${SERVER}/api/Shards/a1/*`]: (r) => (sent.push(r.url), { status: 200 }),
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  await app.press("server-Home Lab");
  await app.waitFor("text:Running");
  await app.press("more-Minecraft SMP");
  await app.press("menu-stop");
  await app.waitFor("text:Stop Minecraft SMP?");
  try {
    await app.setLifecycle("background");
  } catch {
    return; // a real window can't be sent to the background from a test
  }
  await app.setLifecycle("active");
  await app.waitFor("text:AMP Mobile is locked");
  expect(app.texts()).not.toContain("Stop Minecraft SMP?");
  await enterPin(app);
  await app.wait(300);
  expect(sent).toEqual([]);
});

test("adding the same account on the same panel again updates it instead of duplicating it", async () => {
  const app = await openSignedIn({
    network: {
      ...unlockedHome,
      [`POST ${SERVER}/api/Auth/login`]: { body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } },
    },
  });
  await app.press("Add Server");
  await app.type("server", "AMP.example.test");
  await app.type("username", "Admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");
  await app.waitFor("text:Minecraft SMP");
  expect(JSON.parse(app.storage()["amp.servers"]!)).toHaveLength(1);
});

test("a damaged vault doesn't hide the server list, and a lockout set by a skewed clock is capped", async () => {
  const broken = await open("./App.tsx", {
    storage: { ...(await vaultStorage()), "amp.vault": "{not json" },
    network: unlockedHome,
  });
  await broken.waitFor("text:Home Lab");
  expect(broken.texts()).not.toContain("AMP Mobile is locked");

  const skewed = await open("./App.tsx", {
    storage: { ...(await vaultStorage()), "amp.vault.lockout": JSON.stringify({ failures: 6, until: Date.now() + 365 * 86_400_000 }) },
    network: unlockedHome,
  });
  await skewed.waitFor("text:AMP Mobile is locked");
  await skewed.waitUntil(() => skewed.texts().some((t) => /^Try again in \d+ s$/.test(t)));
  const shown = skewed.texts().find((t) => /^Try again in \d+ s$/.test(t))!;
  expect(Number(shown.match(/\d+/)![0])).toBeLessThanOrEqual(900);
});

test("wrong current PINs on the change-PIN screen count like any other", async () => {
  const app = await openSignedIn({ network: unlockedHome });
  await app.press("security");
  await app.press("change-pin");
  await enterPin(app, "999000");
  await enterPin(app, "864200");
  await enterPin(app, "864200");
  await app.waitFor("text:That isn't your current PIN.");
  expect(JSON.parse(app.storage()["amp.vault.lockout"]!).failures).toBe(1);
});

test("going back while a sign-in finishes leaves the home screen in place", async () => {
  const app = await open("./App.tsx", {
    network: {
      // Slow enough that "back" comes first, even in a real window.
      [`POST ${SERVER}/api/Auth/login`]: { delay: 2500, body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("Add Server");
  await app.type("server", "amp.example.test");
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");
  await app.back();
  await app.wait(3000);
  await app.press("pin-cancel").catch(() => {}); // the PIN prompt for staying signed in
  expect(app.texts()).toContain("Your servers");
  expect(app.texts()).not.toContain("Minecraft SMP");
});

test("users, roles and invites with missing fields still show", async () => {
  const app = await openSignedIn({
    network: {
      ...unlockedHome,
      [`GET ${SERVER}/api/users`]: { body: [{ id: "u5", userName: "nofields" }] },
      [`GET ${SERVER}/api/roles`]: { body: [{ id: "r9", name: "Bare" }] },
      [`GET ${SERVER}/api/invites`]: { body: [{ id: "i9", userName: "pending-one" }] },
    },
  });
  await app.press("server-Home Lab");
  await app.press("main-menu");
  await app.press("nav-access");
  await app.waitFor("user-nofields");
  await app.press("tab-roles");
  await app.waitFor("text:0 permissions");
  await app.press("tab-invites");
  await app.waitFor("text:Unknown");
});

test("typing during a save stays unsaved, and an edit survives the app locking", async () => {
  const FILES = `${SERVER}/api/shards/a1/files`;
  const contents: Record<string, string> = { "server.properties": "motd=Hello\n" };
  const pathOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("path") ?? "");
  const app = await openSignedIn({
    storage: { "amp.security": JSON.stringify({ autoLockSeconds: 0 }) },
    network: {
      ...unlockedHome,
      [`GET ${FILES}/managed*`]: { body: [] },
      [`GET ${FILES}/content*`]: (r) => ({ body: { content: contents[pathOf(r.url)] ?? "" } }),
      [`PUT ${FILES}/content*`]: (r) => ((contents[pathOf(r.url)] = JSON.parse(r.body!).content), { delay: 400, status: 204 }),
      [`GET ${FILES}*`]: { body: [{ name: "server.properties", path: "server.properties", isDirectory: false, size: 12 }] },
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await app.press("open-files");
  await app.press("file-server.properties");
  await app.waitFor("file-content");
  await app.type("file-content", "a=1\n");
  await app.press("save-file");
  await app.type("file-content", "b=2\n"); // while the save is in flight
  await app.wait(700);
  expect(contents["server.properties"]).toBe("motd=Hello\na=1\n");
  expect(app.texts()).not.toContain("Saved."); // b=2 isn't saved

  try {
    await app.setLifecycle("background");
  } catch {
    return; // a real window can't be sent to the background from a test
  }
  await app.setLifecycle("active");
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app);
  await app.waitFor("draft-restored");
  expect(app.value("file-content")).toBe("motd=Hello\na=1\nb=2\n");
});

// ---- The vault bound to the device's key store --------------------------------------------------

/**
 * Plays the Android app around the TSX app: its key store, where sealing is reversible, the
 * quick key opens only while `recent` holds, and the biometric prompt answers with `finger`.
 */
function fakeDeviceKeys(state: { recent: boolean; keys: Set<string>; finger?: "ok" | "cancel" | "invalid"; biometric?: string; prompts?: string[] }) {
  type Args = { alias: string; data?: string; sealed?: string; kind?: string; prompt?: { title: string } | null };
  const ask = (a: Args) => {
    if (!a.prompt) return;
    state.prompts?.push(a.prompt.title);
    if (state.finger === "cancel") throw new Error("cancel: use the PIN");
    if (state.finger === "invalid") throw new Error("invalid: KeyPermanentlyInvalidatedException");
  };
  return {
    handlers: {
      "deviceKey.status": () => ({ keys: true, biometric: state.biometric ?? "ready" }),
      "deviceKey.seal": async (a: Args) => {
        if (a.kind === "quick" && !state.recent) throw new Error("auth: not unlocked recently");
        if (a.kind === "biometric") ask(a);
        state.keys.add(a.alias);
        return `${a.alias}:${a.data}`;
      },
      "deviceKey.open": async (a: Args) => {
        if (!state.keys.has(a.alias)) throw new Error("missing: no such key");
        if (a.alias.endsWith("quick") && !state.recent) throw new Error("auth: not unlocked recently");
        if (a.alias.endsWith("bio")) {
          if (!a.prompt) throw new Error("auth: needs the prompt");
          ask(a);
        }
        return a.sealed!.slice(a.alias.length + 1);
      },
      "deviceKey.forget": async (a: Args) => state.keys.delete(a.alias),
    },
  };
}

test("on a phone with a key store, the vault is bound to it and opens on a recent phone unlock", async () => {
  const state = { recent: true, keys: new Set<string>() };
  const storage = { "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" }]) };
  const app = await open("./App.tsx", { storage, network: unlockedHome, host: fakeDeviceKeys(state) });
  await app.waitFor("text:Set a PIN to stay signed in");
  await enterPin(app, "135790");
  await enterPin(app, "135790");
  await app.waitUntil(() => JSON.parse(app.storage()["amp.vault"] ?? "{}").v === 2);
  const vault = JSON.parse(app.storage()["amp.vault"]!);
  expect(vault.pinWrap.startsWith("amp.vault.bound:")).toBe(true);
  expect(app.storage()["amp.vault"]).not.toContain("tok-1");

  // The quick way in appears at the next unlock (the phone was unlocked recently).
  await app.press("security");
  await app.waitFor("text:App PIN");
  expect(app.texts().some((t) => t.includes("locked to this phone's secure hardware"))).toBe(true);
  await app.press("lock-now");
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app, "135790");
  await app.waitUntil(() => !!JSON.parse(app.storage()["amp.vault"]!).quickWrap);

  // "Lock now" stays locked even though the phone was unlocked moments ago...
  await app.press("lock-now");
  await app.waitFor("text:AMP Mobile is locked");
  await app.wait(300);
  expect(app.texts()).toContain("AMP Mobile is locked");
  // ...until the user steps away and comes back after unlocking the phone: no PIN then.
  // Turning the screen off may only make the app inactive, which counts too.
  try {
    await app.setLifecycle("inactive");
  } catch {
    return; // a real window can't be sent to the background from a test
  }
  await app.setLifecycle("active");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));
  expect(app.texts()).toContain("App PIN");
  // And after leaving for the background.
  await app.press("lock-now");
  await app.waitFor("text:AMP Mobile is locked");
  await app.setLifecycle("background");
  await app.setLifecycle("active");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));
});

test("without a recent phone unlock the PIN is asked, and a lost phone key clears the vault", async () => {
  const state = { recent: false, keys: new Set<string>(["amp.vault.bound", "amp.vault.quick"]) };
  // Build a bound vault the way the app does, then reopen it.
  const first = await open("./App.tsx", {
    storage: { "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" }]) },
    network: unlockedHome,
    host: fakeDeviceKeys({ recent: true, keys: state.keys }),
  });
  await enterPin(first, "135790");
  await enterPin(first, "135790");
  await first.waitUntil(() => JSON.parse(first.storage()["amp.vault"] ?? "{}").v === 2);
  const saved = first.storage();

  const app = await open("./App.tsx", { storage: saved, network: unlockedHome, host: fakeDeviceKeys(state) });
  await app.waitFor("text:AMP Mobile is locked");
  await app.wait(300);
  expect(app.texts()).toContain("AMP Mobile is locked"); // no quick way in
  await enterPin(app, "135790");
  await app.waitFor("text:Signed in");

  // The same file on a phone without the key (a reset, a copied backup).
  const elsewhere = await open("./App.tsx", { storage: saved, network: unlockedHome, host: fakeDeviceKeys({ recent: true, keys: new Set() }) });
  await elsewhere.waitFor("text:AMP Mobile is locked");
  await enterPin(elsewhere, "135790");
  await elsewhere.waitFor("text:Saved sign-ins cleared");
  expect(elsewhere.storage()["amp.vault"]).toBeUndefined();
});

test("if the key store refuses, setting a PIN falls back to the PIN-only vault", async () => {
  const app = await open("./App.tsx", {
    storage: { "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" }]) },
    network: unlockedHome,
    host: {
      handlers: {
        "deviceKey.status": { keys: true, biometric: "unavailable" },
        "deviceKey.seal": async () => {
          throw new Error("error: keystore unavailable");
        },
        "deviceKey.open": async () => {
          throw new Error("error: keystore unavailable");
        },
        "deviceKey.forget": true,
      },
    },
  });
  await enterPin(app, "135790");
  await enterPin(app, "135790");
  await app.waitUntil(() => JSON.parse(app.storage()["amp.vault"] ?? "{}").v === 1);
  await app.waitFor("text:Signed in");
});

const KEPT_SERVER = { "amp.servers": JSON.stringify([{ id: "s1", name: "Home Lab", serverUrl: SERVER, username: "admin", color: 0, rememberMe: true, token: "tok-1", expiration: "2099-01-01T00:00:00Z" }]) };

/** A bound vault with the PIN 135790, made the way the app makes it. */
async function boundVault(keys: Set<string>) {
  const first = await open("./App.tsx", { storage: KEPT_SERVER, network: unlockedHome, host: fakeDeviceKeys({ recent: true, keys }) });
  await enterPin(first, "135790");
  await enterPin(first, "135790");
  await first.waitUntil(() => JSON.parse(first.storage()["amp.vault"] ?? "{}").v === 2);
  return first;
}

test("fingerprint unlock: turned on in Security, it opens the lock screen and replaces the quick way in", async () => {
  const prompts: string[] = [];
  const state = { recent: true, keys: new Set<string>(), finger: "ok" as "ok" | "cancel" | "invalid", prompts };
  const app = await open("./App.tsx", { storage: KEPT_SERVER, network: unlockedHome, host: fakeDeviceKeys(state) });
  await enterPin(app, "135790");
  await enterPin(app, "135790");
  await app.waitUntil(() => JSON.parse(app.storage()["amp.vault"] ?? "{}").v === 2);

  await app.press("security");
  await app.waitFor("text:Fingerprint unlock");
  await app.press("biometric-toggle");
  await app.waitFor("text:Fingerprint unlock is on.");
  expect(prompts).toEqual(["Turn on fingerprint unlock"]);
  const vault = JSON.parse(app.storage()["amp.vault"]!);
  expect(vault.bioWrap.startsWith("amp.vault.bio:")).toBe(true);
  expect(vault.quickWrap).toBeUndefined();

  // "Lock now" doesn't prompt by itself; the button does.
  await app.press("lock-now");
  await app.waitFor("text:AMP Mobile is locked");
  await app.wait(300);
  expect(prompts.length).toBe(1);
  await app.press("lock-biometric");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));
  expect(prompts).toEqual(["Turn on fingerprint unlock", "Unlock AMP Mobile"]);
  // No quick way in comes back while it's on.
  expect(JSON.parse(app.storage()["amp.vault"]!).quickWrap).toBeUndefined();

  // Back from the background, the prompt opens by itself; "Use PIN" leaves the PIN pad, and
  // the prompt doesn't come back on its own until the app leaves again.
  state.finger = "cancel";
  await app.press("autolock-0");
  await app.setLifecycle("background");
  await app.setLifecycle("active");
  await app.waitFor("text:AMP Mobile is locked");
  await app.waitUntil(() => prompts.length === 3);
  await app.setLifecycle("inactive");
  await app.setLifecycle("active");
  await app.wait(300);
  expect(prompts.length).toBe(3);
  await enterPin(app, "135790");
  await app.waitUntil(() => !app.texts().includes("AMP Mobile is locked"));

  // Turning it off brings the quick way in back.
  await app.press("biometric-toggle");
  await app.waitFor("text:Fingerprint unlock is off.");
  await app.waitUntil(() => !!JSON.parse(app.storage()["amp.vault"]!).quickWrap);
  expect(JSON.parse(app.storage()["amp.vault"]!).bioWrap).toBeUndefined();
  expect(state.keys.has("amp.vault.bio")).toBe(false);
});

test("a fingerprint added to the phone turns fingerprint unlock off, and the PIN still opens the vault", async () => {
  const keys = new Set<string>();
  const first = await boundVault(keys);
  await first.press("security");
  await first.waitFor("text:Fingerprint unlock");
  await first.press("biometric-toggle");
  await first.waitFor("text:Fingerprint unlock is on.");
  const saved = first.storage();

  const app = await open("./App.tsx", { storage: saved, network: unlockedHome, host: fakeDeviceKeys({ recent: false, keys, finger: "invalid" }) });
  await app.waitFor("text:AMP Mobile is locked");
  await app.waitFor("text:Fingerprint unlock turned off because the phone's fingerprints or face changed. Enter your PIN, then turn it on again in Security.");
  expect(JSON.parse(app.storage()["amp.vault"]!).bioWrap).toBeUndefined();
  expect(app.count("lock-biometric")).toBe(0);
  await enterPin(app, "135790");
  await app.waitFor("text:Signed in");
});

test("changing the PIN keeps fingerprint unlock working", async () => {
  const keys = new Set<string>();
  const app = await boundVault(keys);
  await app.press("security");
  await app.waitFor("text:Fingerprint unlock");
  await app.press("biometric-toggle");
  await app.waitFor("text:Fingerprint unlock is on.");
  await app.press("change-pin");
  await enterPin(app, "135790");
  await enterPin(app, "246801");
  await enterPin(app, "246801");
  await app.waitFor("text:PIN changed.");
  const saved = app.storage();
  expect(JSON.parse(saved["amp.vault"]!).bioWrap).toBeTruthy();

  const again = await open("./App.tsx", { storage: saved, network: unlockedHome, host: fakeDeviceKeys({ recent: false, keys, finger: "ok" }) });
  await again.waitUntil(() => !again.texts().includes("AMP Mobile is locked"));
  await again.waitFor("text:Signed in");
});

test("a key store that doesn't answer never erases the vault", async () => {
  const keys = new Set<string>();
  const saved = (await boundVault(keys)).storage();
  const app = await open("./App.tsx", {
    storage: saved,
    network: unlockedHome,
    host: {
      handlers: {
        "deviceKey.status": { keys: true, biometric: "ready" },
        "deviceKey.open": async () => {
          throw new Error("error: keystore busy");
        },
        "deviceKey.seal": async () => {
          throw new Error("error: keystore busy");
        },
        "deviceKey.forget": true,
      },
    },
  });
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app, "135790");
  await app.waitFor("text:The phone's key store didn't answer. Try again.");
  expect(app.storage()["amp.vault"]).toBe(saved["amp.vault"]);
});

test("an account held for a password change sets a new one and signs in", async () => {
  const changes: unknown[] = [];
  const app = await open("./App.tsx", {
    network: {
      [`POST ${SERVER}/api/Auth/login`]: (r) =>
        JSON.parse(r.body!).password === "N3w-pass!"
          ? { body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } }
          : { body: { passwordChangeRequired: true, reason: "expired" } },
      [`GET ${SERVER}/api/Auth/password-policy`]: { body: { requiredLength: 8, requireDigit: true } },
      [`POST ${SERVER}/api/Auth/change-expired-password`]: (r) => (changes.push(JSON.parse(r.body!)), { status: 200 }),
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("Add Server");
  await app.type("server", "amp.example.test");
  await app.type("username", "admin");
  await app.type("password", "old-pass");
  await app.press("text:Add Server");
  await app.waitFor("text:Set a new password");
  expect(app.texts()).toContain("Needs at least 8 characters, a digit.");

  await app.type("new-password", "N3w-pass!");
  await app.type("repeat-password", "N3w-pass?");
  await app.press("text:Change password and sign in");
  await app.waitFor("text:The new passwords don't match");
  expect(changes).toEqual([]);

  await clearField(app, "repeat-password");
  await app.type("repeat-password", "N3w-pass!");
  await app.press("text:Change password and sign in");
  await app.waitFor("text:Set a PIN to stay signed in");
  expect(changes).toEqual([{ username: "admin", currentPassword: "old-pass", newPassword: "N3w-pass!" }]);
});

test("snapshots: the timeline, taking one, following it, restoring, pinning, deleting and the limits", async () => {
  const SNAPS = `${SERVER}/api/shards/a1/snapshots`;
  const calls: string[] = [];
  const full = {
    id: "n1", parentId: null, kind: 0, content: 1, trigger: 1, status: 2, name: null, description: null, sticky: false,
    skippedFiles: [], skippedCount: 0, archiveMissing: false, createdAt: "2026-11-10T02:00:00Z",
    sizeMb: 1536, uncompressedMb: 4000, fileCount: 1200, stage: 0, processedFiles: 0, totalFiles: 0,
  };
  let nodes: Record<string, unknown>[] = [
    full,
    { ...full, id: "n2", parentId: "n1", kind: 1, content: 5, trigger: 0, name: "Before 1.21", sticky: true, createdAt: "2026-11-12T09:00:00Z", sizeMb: 40, fileCount: 30, skippedCount: 2, skippedFiles: [{ relPath: "logs/latest.log", reason: "locked" }] },
    { ...full, id: "n3", parentId: "n2", kind: 1, status: 3, trigger: 0, name: "Broken one", failureReason: "Disk full", createdAt: "2026-11-13T09:00:00Z" },
  ];
  let settings = { maxBackupSizeMb: 0, maxTotalStorageMb: 0, stopWhenNoQuiesce: false };
  let restoring: string | null = null;
  let polls = 0;
  const graph = () => {
    polls++;
    // A capture that's running moves on each time the timeline is read, then finishes.
    nodes = nodes.map((n) =>
      n.status === 1 ? (polls > 3 ? { ...n, status: 2, stage: 0, sizeMb: 12, fileCount: 8 } : { ...n, stage: 2, processedFiles: 4, totalFiles: 8 }) : n,
    );
    return { shardId: "a1", tenantId: "t", nodes, headId: "n2", settings, restoringId: restoring, restoreStage: restoring ? 2 : 0, restoreProcessed: 10, restoreTotal: 40 };
  };

  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`PUT ${SNAPS}/settings`]: (r) => {
        settings = JSON.parse(r.body!);
        calls.push(`limits ${settings.maxBackupSizeMb} ${settings.maxTotalStorageMb}`);
        return { body: settings };
      },
      [`POST ${SNAPS}/*/restore`]: (r) => {
        restoring = r.url.split("/").at(-2)!;
        calls.push(`restore ${restoring}`);
        return { body: nodes.find((n) => n.id === restoring) };
      },
      [`PUT ${SNAPS}/*/meta`]: (r) => {
        const id = r.url.split("/").at(-2)!;
        const meta = JSON.parse(r.body!);
        nodes = nodes.map((n) => (n.id === id ? { ...n, ...meta } : n));
        calls.push(`meta ${id} ${meta.name} ${meta.sticky}`);
        return { status: 204 };
      },
      [`DELETE ${SNAPS}/*`]: (r) => {
        const id = r.url.split("/").at(-1)!;
        nodes = nodes.filter((n) => n.id !== id);
        calls.push(`delete ${id}`);
        return { status: 204 };
      },
      [`POST ${SNAPS}`]: (r) => {
        const body = JSON.parse(r.body!);
        calls.push(`take ${body.kind} ${body.content} ${body.name} ${body.sticky}`);
        const made = { ...full, id: "n4", parentId: "n2", kind: body.kind, content: body.content, trigger: 0, status: 1, name: body.name, sticky: body.sticky, createdAt: "2026-11-15T09:00:00Z", stage: 1 };
        nodes = [...nodes, made];
        polls = 0;
        return { body: made };
      },
      [`GET ${SNAPS}`]: (r) => (r.headers.authorization === "Bearer tok-1" ? { body: graph() } : { status: 401 }),
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });

  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await openRow(app, "open-snapshots", "text:Change limits");
  await app.waitFor("text:Before 1.21");
  const texts = () => app.texts().join("\n");
  expect(texts()).toContain("On disk now");
  expect(texts()).toContain("Pinned");
  expect(texts()).toContain("Game data, AMP settings");
  expect(texts()).toContain("Disk full");
  expect(texts()).toContain("2 files couldn't be read and aren't in it (e.g. logs/latest.log).");
  expect(texts()).toContain("1.5 GB");

  // Take a partial snapshot with a name, game data only, pinned.
  await app.press("text:Take a snapshot");
  await app.type("snapshot-name", "Quick save");
  await app.press("snapshot-pin");
  await app.press("snapshot-take");
  await app.waitUntil(() => calls.some((c) => c.startsWith("take")));
  expect(calls).toContain("take 1 1 Quick save true");
  // It's followed while it runs, then shows as done.
  await app.waitFor("text:Quick save");
  await app.waitUntil(() => texts().includes("12 MB"), { timeout: 15_000 });

  // Rename and unpin through the row's menu.
  await app.press("snapshot-more-n2");
  await app.press("menu-pin");
  await app.waitUntil(() => calls.includes("meta n2 Before 1.21 false"));
  await app.press("snapshot-more-n1");
  await app.press("menu-rename");
  await app.type("prompt-input", "First full");
  await app.press("prompt-confirm");
  await app.waitUntil(() => calls.includes("meta n1 First full false"));
  await app.waitUntil(() => !app.texts().includes("Name this snapshot"));

  // Delete the failed one, confirmed.
  await app.press("snapshot-more-n3");
  await app.press("menu-delete");
  await app.waitFor("text:Delete Broken one?");
  await app.press("confirm-delete");
  await app.waitUntil(() => calls.includes("delete n3"));

  // Restore asks first, then shows its progress.
  await app.press("snapshot-more-n1");
  await app.press("menu-restore");
  await app.waitFor("text:Restore First full?");
  await app.press("confirm-restore");
  await app.waitUntil(() => calls.includes("restore n1"));
  await app.waitFor("restoring");
  expect(texts()).toContain("Processing · 10 of 40 files");
  // Nothing can be deleted while a restore runs.
  await app.press("snapshot-more-n2");
  await app.waitFor("menu-pin");
  expect(app.count("menu-delete")).toBe(0);
  await app.press("menu-pin");
  restoring = null;

  // Limits: whole megabytes only.
  await app.press("limits-edit");
  await app.type("limit-each", "5000");
  await app.type("limit-total", "lots");
  await app.press("limits-save");
  await app.waitFor("text:Use whole megabytes, or leave it empty for no limit.");
  await clearField(app, "limit-total");
  await app.type("limit-total", "20000");
  await app.press("limits-save");
  await app.waitUntil(() => calls.includes("limits 5000 20000"));
  await app.waitFor("text:Limits saved.");
});

test("schedules: the list, on and off, run now, editing a straight one, keeping a branched one, a new one, history and delete", async () => {
  const SCH = `${SERVER}/api/shards/a1/schedules`;
  const calls: string[] = [];
  const bodies: Record<string, any> = {};
  const nightlySteps = [
    { type: "task", id: "t1", taskType: "app.consoleSend", parameters: { command: "say restarting" }, await: true, onSuccess: [], onFailure: [], failureOverride: null },
    { type: "task", id: "t2", taskType: "flow.wait", parameters: { seconds: "60" }, await: true, onSuccess: [], onFailure: [], failureOverride: "Continue" },
    { type: "task", id: "t3", taskType: "power.restart", parameters: {}, await: true, onSuccess: [], onFailure: [], failureOverride: null },
  ];
  const greetSteps = [
    {
      type: "if", id: "c1", match: "All",
      conditions: [{ value: "{@PlayerName}", operator: "NotEquals", comparand: "Steve" }],
      then: [{ type: "task", id: "t9", taskType: "app.consoleSend", parameters: { command: "say hi {@PlayerName}" }, await: true, onSuccess: [], onFailure: [], failureOverride: null }],
      else: [],
    },
  ];
  let list: any[] = [
    {
      definition: {
        id: "s1", name: "Nightly restart", description: "", enabled: true, timeout: "00:30:00",
        trigger: { type: "cron", expression: "0 4 * * *", timeZoneId: "Australia/Brisbane" }, steps: nightlySteps,
      },
      status: { lastRunAt: "2026-11-15T04:00:00Z", lastRunStatus: "Succeeded", consecutiveFailures: 0 },
      nextFireTime: "2026-11-16T04:00:00Z",
      withheld: [],
    },
    {
      definition: { id: "s2", name: "Greet players", description: "Says hello", enabled: true, timeout: "00:05:00", trigger: { type: "event", eventType: "player.joined" }, steps: greetSteps },
      status: { lastRunAt: "2026-11-15T03:00:00Z", lastRunStatus: "Failed", lastError: "Console not ready", consecutiveFailures: 3 },
      nextFireTime: null,
      withheld: [],
    },
  ];
  const catalog = {
    triggers: [
      { id: "player.joined", category: "players", emits: [] },
      { id: "app.stateChanged", category: "application", emits: [] },
    ],
    tasks: [
      { id: "app.consoleSend", category: "app", isAsync: false, defaultFailure: "Abort", parameters: [{ name: "command", inputType: "text", required: true }] },
      { id: "backup.create", category: "backups", isAsync: true, defaultFailure: "Abort", parameters: [{ name: "name", inputType: "text", required: false }] },
      { id: "flow.wait", category: "flow", isAsync: false, defaultFailure: "Abort", parameters: [{ name: "seconds", inputType: "number", required: true }] },
      { id: "power.restart", category: "power", isAsync: true, defaultFailure: "Abort", parameters: [] },
    ],
    commonEmits: [],
  };
  const en = {
    schedule: {
      task: {
        app_consoleSend: { name: "Send a console command" },
        backup_create: { name: "Create a backup", note: "Creating a backup may shut down the application temporarily." },
        flow_wait: { name: "Wait" },
        power_restart: { name: "Restart the server" },
      },
      taskCategory: { app: "Application", backups: "Backups", flow: "Flow", power: "Power" },
      taskParam: { command: "Command", seconds: "Seconds", name: "Backup name" },
      trigger: { player_joined: { name: "A user connects", desc: "When a user connects to the server." } },
      op: { NotEquals: "does not equal" },
    },
  };
  const byId = (url: string) => url.split("/schedules/")[1].split(/[/?]/)[0];

  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/assets/i18n/en.json`]: { body: en },
      [`GET ${SCH}/catalog`]: { body: catalog },
      [`POST ${SCH}/preview-firings`]: (r) => {
        calls.push(`preview ${JSON.stringify(JSON.parse(r.body!).trigger)}`);
        return { body: ["2026-11-16T05:30:00Z", "2026-11-17T05:30:00Z"] };
      },
      [`POST ${SCH}/*/enabled`]: (r) => {
        const id = byId(r.url);
        const on = JSON.parse(r.body!).enabled;
        list = list.map((s) => (s.definition.id === id ? { ...s, definition: { ...s.definition, enabled: on } } : s));
        calls.push(`enabled ${id} ${on}`);
        return { status: 200 };
      },
      [`POST ${SCH}/*/run`]: (r) => {
        calls.push(`run ${byId(r.url)}`);
        return { status: 202 };
      },
      [`GET ${SCH}/*/history*`]: {
        body: [
          {
            id: "r1", scheduleId: "s1", status: "CompletedWithErrors", queuedAt: "2026-11-15T04:00:00Z", startedAt: "2026-11-15T04:00:00Z",
            completedAt: "2026-11-15T04:01:05Z", attemptNumber: 1, errorMessage: null,
            stepOutcomes: [
              { stepId: "t1", lane: "main", status: "Succeeded", detail: "Sent" },
              { stepId: "t2", lane: "main", status: "Failed", detail: "Interrupted" },
              { stepId: "t3", lane: "main", status: "Succeeded", detail: null },
            ],
          },
        ],
      },
      [`PUT ${SCH}/*`]: (r) => {
        const id = byId(r.url);
        const body = JSON.parse(r.body!);
        bodies[`put ${id}`] = body;
        calls.push(`put ${id}`);
        list = list.map((s) => (s.definition.id === id ? { ...s, definition: { ...s.definition, ...body, id } } : s));
        return { body: list.find((s) => s.definition.id === id) };
      },
      [`DELETE ${SCH}/*`]: (r) => {
        const id = byId(r.url);
        list = list.filter((s) => s.definition.id !== id);
        calls.push(`delete ${id}`);
        return { status: 204 };
      },
      [`GET ${SCH}/*`]: (r) => {
        const s = list.find((x) => x.definition.id === byId(r.url));
        return s ? { body: s } : { status: 404 };
      },
      [`POST ${SCH}`]: (r) => {
        const body = JSON.parse(r.body!);
        bodies.post = body;
        calls.push("post");
        const made = { definition: { ...body, id: "s3" }, status: null, nextFireTime: "2026-11-15T10:15:00Z", withheld: [] };
        list = [...list, made];
        return { status: 201, body: made };
      },
      [`GET ${SCH}`]: () => ({ body: list }),
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  const texts = () => app.texts().join("\n");
  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await openRow(app, "open-schedules", "text:Nightly restart");
  await app.waitFor("text:Daily at 04:00 (Australia/Brisbane)");
  expect(texts()).toContain("When: A user connects");
  expect(texts()).toContain("Failed 3 times in a row");
  expect(texts()).toContain("Console not ready");
  expect(texts()).toContain("• Send a console command: say restarting");
  expect(texts()).toContain("• If {@PlayerName} does not equal Steve");

  // On and off is one tap; Run now asks first.
  await app.press("schedule-toggle-s1");
  await app.waitUntil(() => calls.includes("enabled s1 false"));
  await app.waitFor("text:Nightly restart is off.");
  await app.press("schedule-more-s2");
  await app.press("menu-run");
  await app.waitFor("text:Run Greet players now?");
  await app.press("confirm-run");
  await app.waitUntil(() => calls.includes("run s2"));

  // A straight list of tasks is edited in place: the trigger rebuilt, the steps kept with their ids.
  await app.press("schedule-more-s1");
  await app.press("menu-edit");
  await app.waitFor("schedule-time");
  expect(app.value("schedule-time")).toBe("04:00");
  expect(app.value("schedule-tz")).toBe("Australia/Brisbane");
  await clearField(app, "schedule-time");
  await app.type("schedule-time", "05:30");
  await app.waitUntil(() => calls.some((c) => c.includes("30 5 * * *")));
  await app.waitFor("schedule-preview");
  await clearField(app, "task-1-command");
  await app.type("task-1-command", "say back in 5");
  await app.press("task-add");
  await app.press("task-type-4");
  await app.press("menu-backup.create");
  await app.waitFor("text:Creating a backup may shut down the application temporarily.");
  await app.press("schedule-save");
  await app.waitUntil(() => calls.includes("put s1"));
  const put = bodies["put s1"];
  expect(put.trigger).toEqual({ type: "cron", expression: "30 5 * * *", timeZoneId: "Australia/Brisbane" });
  expect(put.timeout).toBe("00:30:00");
  expect(put.enabled).toBe(false);
  expect(put.steps.map((x: any) => x.id).slice(0, 3)).toEqual(["t1", "t2", "t3"]);
  expect(put.steps[0].parameters).toEqual({ command: "say back in 5" });
  expect(put.steps[1].failureOverride).toBe("Continue");
  expect(put.steps[3].taskType).toBe("backup.create");
  await app.waitFor("text:Daily at 05:30 (Australia/Brisbane)");

  // A schedule with branches: shown, renamed, and its steps sent back untouched.
  await app.press("schedule-more-s2");
  await app.press("menu-edit");
  await app.waitFor("text:Send a console command: say hi {@PlayerName}");
  await clearField(app, "schedule-name");
  await app.type("schedule-name", "Greet everyone");
  await app.press("schedule-save");
  await app.waitUntil(() => calls.includes("put s2"));
  expect(bodies["put s2"].steps).toEqual(greetSteps);
  expect(bodies["put s2"].trigger).toEqual({ type: "event", eventType: "player.joined" });
  await app.waitFor("text:Greet everyone");

  // A new one: every 15 minutes; a required parameter is asked for.
  await app.press("text:New schedule");
  await app.waitFor("schedule-name");
  await app.type("schedule-name", "Autosave");
  await app.press("schedule-mode");
  await app.press("menu-interval");
  await clearField(app, "schedule-minutes");
  await app.type("schedule-minutes", "15");
  await app.press("schedule-save");
  await app.waitFor("text:Send a console command: fill in command.");
  await app.type("task-1-command", "save-all");
  await app.press("schedule-save");
  await app.waitUntil(() => calls.includes("post"));
  expect(bodies.post.trigger).toEqual({ type: "interval", interval: "00:15:00" });
  expect(bodies.post.steps[0]).toMatchObject({ type: "task", taskType: "app.consoleSend", parameters: { command: "save-all" }, await: true });
  expect(bodies.post.timeout).toBe(null);
  await app.waitFor("text:Every 15 minutes");

  // Run history names each step.
  await app.press("schedule-more-s1");
  await app.press("menu-history");
  await app.waitFor("text:Completed with errors");
  expect(texts()).toContain("Send a console command: say back in 5");
  expect(texts()).toContain("Interrupted");
  expect(texts()).toContain("1 min 5 s");
  await app.press("back");

  // Delete asks first.
  await app.waitFor("schedule-more-s1");
  await app.press("schedule-more-s1");
  await app.press("menu-delete");
  await app.waitFor("text:Delete Nightly restart?");
  await app.press("confirm-delete");
  await app.waitUntil(() => calls.includes("delete s1"));
  await app.waitUntil(() => !app.texts().includes("Nightly restart"));
});

test("a sign-in that finishes after the app locked is dropped, and the server told", async () => {
  const OTHER = "https://other.example.test";
  const storage = { ...(await vaultStorage()), "amp.security": JSON.stringify({ autoLockSeconds: 0 }) };
  let backgrounded: "yes" | "unsupported" | null = null;
  // The app goes to the background (and so locks) while the panel is still answering.
  let app: Awaited<ReturnType<typeof openSignedIn>>;
  app = await openSignedIn({
    storage,
    network: {
      ...unlockedHome,
      [`POST ${OTHER}/api/Auth/login`]: async () => {
        try {
          await app.setLifecycle("background");
          backgrounded = "yes";
        } catch {
          backgrounded = "unsupported";
        }
        return { body: { token: "tok-late", expiration: "2099-01-01T00:00:00Z" } };
      },
      [`POST ${OTHER}/api/Auth/logout`]: { status: 204 },
    },
  });
  await app.waitFor("text:Signed in");
  await app.press("text:Add Server");
  await app.type("server", "other.example.test");
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");
  await app.waitUntil(() => backgrounded !== null);
  if (backgrounded === "unsupported") return; // a real window can't be sent to the background
  await app.waitUntil(() => app.requests().some((r) => r.url === `${OTHER}/api/Auth/logout`));
  expect(app.requests().find((r) => r.url === `${OTHER}/api/Auth/logout`)?.headers.authorization).toBe("Bearer tok-late");
  await app.setLifecycle("active");
  await app.waitFor("text:AMP Mobile is locked");
  await enterPin(app);
  // Back on the form it was on, with nothing of that sign-in kept.
  await app.waitFor("text:Connect a server");
  expect(JSON.parse(app.storage()["amp.servers"]).map((s: { serverUrl: string }) => s.serverUrl)).toEqual([SERVER]);
});

test("a sign-in answer without a valid expiry is refused", async () => {
  const app = await open("./App.tsx", {
    network: { [`POST ${SERVER}/api/Auth/login`]: { body: { token: "tok-1" } } },
  });
  await app.press("Add Server");
  await app.type("server", "amp.example.test");
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");
  await app.waitFor("text:The server's sign-in answer had no valid expiry. Is this an AMP 3 server?");
});

test("a schedule's trigger is sent back exactly as stored when the form leaves it alone", async () => {
  const SCH = `${SERVER}/api/shards/a1/schedules`;
  let put: any = null;
  const stored = {
    definition: {
      id: "s1", name: "Heartbeat", description: "", enabled: true, timeout: "00:02:00",
      trigger: { type: "interval", interval: "00:00:30", anchor: "2026-01-01T00:00:10Z" },
      steps: [{ type: "task", id: "t1", taskType: "app.consoleSend", parameters: { command: "list" }, await: true, onSuccess: [], onFailure: [], failureOverride: null }],
    },
    status: null, nextFireTime: "2026-11-16T00:00:10Z", withheld: [],
  };
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/assets/i18n/en.json`]: { status: 404 },
      [`GET ${SCH}/catalog`]: {
        body: { triggers: [], tasks: [{ id: "app.consoleSend", category: "app", isAsync: false, defaultFailure: "Abort", parameters: [{ name: "command", inputType: "text", required: true }] }], commonEmits: [] },
      },
      [`POST ${SCH}/preview-firings`]: { body: [] },
      [`PUT ${SCH}/s1`]: (r) => {
        put = JSON.parse(r.body!);
        return { body: stored };
      },
      [`GET ${SCH}/s1`]: { body: stored },
      [`GET ${SCH}`]: { body: [stored] },
      [`GET ${SERVER}/api/Shards/a1/metrics*`]: { body: [] },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  await app.press("server-Home Lab");
  await app.press("shard-Minecraft SMP");
  await openRow(app, "open-schedules", "text:Heartbeat");
  await app.waitFor("text:Every 30 seconds");
  await app.press("schedule-more-s1");
  await app.press("menu-edit");
  await app.waitFor("schedule-name");
  await clearField(app, "schedule-name");
  await app.type("schedule-name", "Heartbeat 2");
  await app.press("schedule-save");
  await app.waitUntil(() => put !== null);
  expect(put.trigger).toEqual({ type: "interval", interval: "00:00:30", anchor: "2026-01-01T00:00:10Z" });
  expect(put.name).toBe("Heartbeat 2");
});

// ---- Fifth audit --------------------------------------------------------------------------------

/** A stand-in AmpClient that answers the upload's calls from `answers`, by path. */
function fakeUploadClient(answers: Record<string, unknown>, calls: string[]) {
  return {
    baseUrl: SERVER,
    token: "tok-1",
    request: async (path: string) => {
      const step = path.split("/").pop()!;
      calls.push(step);
      return answers[step];
    },
  } as unknown as Parameters<typeof uploadFile>[0];
}

const fiveBytes = () => Object.assign(new Blob([new Uint8Array([1, 2, 3, 4, 5])]), { name: "mod.jar" });

test("an upload whose server answers a count that makes no sense is never committed", async () => {
  for (const bad of ["abc", -1, 99, 2.5]) {
    const calls: string[] = [];
    const client = fakeUploadClient({ "upload-start": { sessionId: "s1", received: 0 }, "upload-chunk": { received: bad } }, calls);
    await expect(uploadFile(client, "a1", "", fiveBytes())).rejects.toThrow("didn't make sense");
    expect(calls).not.toContain("upload-commit");
  }
  // A resumed session claiming more than the file holds is refused before any chunk.
  const calls: string[] = [];
  await expect(uploadFile(fakeUploadClient({ "upload-start": { sessionId: "s1", received: 6 } }, calls), "a1", "", fiveBytes())).rejects.toThrow();
  expect(calls).toEqual(["upload-start"]);
  // And one told to stop (the app locked) commits nothing.
  const stopped: string[] = [];
  const ok = fakeUploadClient({ "upload-start": { sessionId: "s1", received: 0 }, "upload-chunk": { received: 5 } }, stopped);
  await expect(uploadFile(ok, "a1", "", fiveBytes(), undefined, () => true)).rejects.toThrow("the app locked");
  expect(stopped).toEqual(["upload-start"]);
  // A good one still goes through.
  const good: string[] = [];
  await uploadFile(fakeUploadClient({ "upload-start": { sessionId: "s1", received: 0 }, "upload-chunk": { received: 5 } }, good), "a1", "", fiveBytes());
  expect(good).toEqual(["upload-start", "upload-chunk", "upload-commit"]);
});

test("a renewal answer without a readable expiry keeps the session it had", async () => {
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-bad", expiration: "soon" } },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
    },
  });
  await app.waitFor("text:Signed in");
  await app.press("server-Home Lab");
  await app.waitFor("text:Running");
  const shardCalls = app.requests().filter((r) => r.url.includes("/api/Shards"));
  expect(shardCalls.every((r) => (r.headers.authorization ?? r.headers.Authorization) !== "Bearer tok-bad")).toBe(true);
});

// ---- Hide personal details --------------------------------------------------------------------

test("Hide personal details dots out addresses and names on the fly, and is remembered", async () => {
  const app = await openSignedIn({
    network: { [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } }, [`GET ${SERVER}/api/Shards*`]: shardsRoute },
  });
  expect(app.texts()).toContain("admin · amp.example.test");
  await app.press("security");
  await app.waitFor("text:Hide personal details");
  await app.press("hide-details-toggle");
  await app.waitFor("text:Addresses, IPs, account and player names, emails and invite links are blurred everywhere, console lines included. Copy buttons still copy the real value.");
  await app.press("back");
  await app.waitFor("text:Your servers");
  expect(app.texts()).not.toContain("admin · amp.example.test");
  // Each hidden run is its own blurred piece; the separator between them stays sharp.
  for (const piece of ["•••••", " · ", "•••.•••••••.••••"]) expect(app.texts()).toContain(piece);
  expect(JSON.parse(app.storage()["amp.privacy"]!)).toEqual({ hideDetails: true });

  // The instances page: neither its header nor its banner names the panel.
  await app.press("server-Home Lab");
  await app.waitFor("text:Running");
  expect(app.texts().some((t) => t.includes("amp.example.test"))).toBe(false);
  await app.press("back");

  // Remembered at the next launch, before anything is shown.
  const again = await open("./App.tsx", { storage: app.storage(), network: unlockedHome });
  await again.waitFor("text:AMP Mobile is locked");
  await enterPin(again);
  await again.waitFor("text:Your servers");
  for (const piece of ["•••••", "•••.•••••••.••••"]) expect(again.texts()).toContain(piece);
});

test("hidden details: IPs inside console lines are dotted out, times and versions aren't", () => {
  hideDetails.set(true);
  try {
    expect(privIps("[12:34:56] Steve[/203.0.113.7:51234] logged in on 1.20.4")).toBe("[12:34:56] Steve[/•••.•.•••.•:51234] logged in on 1.20.4");
    expect(privIps("from 2001:db8::1 and [::1]:8080")).toBe("from ••••:•••::• and [::•]:8080");
    expect(priv("admin@example.test")).toBe("•••••@•••••••.••••");
    // An event's details: personal keys dotted out, IPs anywhere, the rest readable.
    expect(JSON.parse(privJson('{"user":"root","remoteAddress":"35.214.243.124","reason":"from 10.0.0.2","attempts":5}'))).toEqual({
      user: "••••",
      remoteAddress: "••.•••.•••.•••",
      reason: "from ••.•.•.•",
      attempts: 5,
    });
    // Keys are read by their words: "description" or "zipFile" aren't an "ip"; "remoteIpAddress" is.
    expect(JSON.parse(privJson('{"description":"Daily backup","zipFile":"world.zip","remoteIpAddress":"host-9","shard":{"ownerName":"Ada"}}'))).toEqual({
      description: "Daily backup",
      zipFile: "world.zip",
      remoteIpAddress: "••••-•",
      shard: { ownerName: "•••" },
    });
  } finally {
    hideDetails.set(false);
  }
  expect(privIps("Steve[/203.0.113.7:51234]")).toBe("Steve[/203.0.113.7:51234]");
});

test("connection failures explain a panel without HTTPS, and an untrusted certificate", () => {
  // What a tester saw adding a panel that only speaks plain HTTP (over Tailscale).
  const plain = connectionProblem("Network request failed: io: received corrupt message of type InvalidContentType");
  expect(plain.startsWith("This address answered without HTTPS.")).toBe(true);
  expect(plain).toContain("InvalidContentType");
  expect(connectionProblem("invalid peer certificate: UnknownIssuer").startsWith("This server's HTTPS certificate isn't trusted")).toBe(true);
  expect(connectionProblem("dns error: no such host")).toBe("Couldn't reach the server: dns error: no such host");
});

test("adding a panel that answers in plain HTTP says so", async () => {
  const app = await open("./App.tsx", {
    network: { [`POST https://100.69.36.88:8443/api/Auth/login`]: { error: "io: received corrupt message of type InvalidContentType" } },
  });
  await app.press("text:Add Server");
  await app.type("server", "100.69.36.88:8443");
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("text:Add Server");
  // A Tailscale address: the message says how to add it over plain HTTP.
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("This address answered without HTTPS. It's a Tailscale address") && t.includes("http://100.69.36.88:8443")));
});

test("addresses are classed for plain HTTP: Tailscale is safe, the rest local or public", () => {
  for (const yes of ["100.64.0.1", "100.69.36.88", "100.127.255.255", "[fd7a:115c:a1e0::1]", "panel.tail1234.ts.net"]) expect(isTailscaleHost(yes)).toBe(true);
  for (const no of ["100.63.255.255", "100.128.0.1", "10.0.0.5", "192.168.1.2", "8.8.8.8", "ts.net", "evilts.net", "[fd7a:115c:a1e1::1]", "example.com"]) expect(isTailscaleHost(no)).toBe(false);
  expect(normalizeServerUrl("http://100.69.36.88:8443/")).toBe("http://100.69.36.88:8443");
  expect(normalizeServerUrl("100.69.36.88:8443")).toBe("https://100.69.36.88:8443"); // HTTPS stays the default
  // Plain HTTP elsewhere is allowed but classed, for the warning.
  expect(plainHttpRisk("http://100.69.36.88:8443")).toBeNull();
  // A tailnet name is only inside the tunnel while this device is on the tailnet: it's confirmed first.
  expect(plainHttpRisk("http://panel.tail1234.ts.net")).toBe("tailnet");
  // Odd spellings are judged by what they parse to; anything unrecognised is treated as the internet.
  expect(plainHttpRisk("http://2130706433:8080")).toBe("local");
  expect(plainHttpRisk("http://[::ffff:192.168.1.1]")).toBe("public");
  expect(plainHttpRisk("http://100.64.0.1.nip.io")).toBe("public");
  expect(plainHttpRisk("https://amp.example.test")).toBeNull();
  for (const local of ["http://192.168.1.2:8080", "http://10.0.0.5", "http://172.20.0.3", "http://localhost:8080", "http://amp-box", "http://nas.local", "http://[fd00::5]"]) expect(plainHttpRisk(local)).toBe("local");
  for (const pub of ["http://amp.example.test", "http://8.8.8.8", "http://172.32.0.1", "http://100.128.0.1"]) expect(plainHttpRisk(pub)).toBe("public");
  // Plain links open only when the caller pins the host (a panel's own download).
  expect(safeHttpsUrl("http://192.168.1.2/f?ticket=t", (h) => h === "192.168.1.2", true)).toBe("http://192.168.1.2/f?ticket=t");
  expect(safeHttpsUrl("http://192.168.1.2/f", undefined, true)).toBeNull();
  expect(safeHttpsUrl("http://100.69.36.88:8443/f", () => true)).toBeNull();
});

test("a panel on a plain-HTTP Tailscale address signs in, and says how it's reached", async () => {
  const TS = "http://100.69.36.88:8443";
  const app = await open("./App.tsx", {
    network: {
      [`POST ${TS}/api/Auth/login`]: { body: { token: "tok-1", expiration: "2099-01-01T00:00:00Z" } },
      [`GET ${TS}/api/Auth/password-policy`]: { body: {} },
      [`GET ${TS}/api/Shards*`]: shardsRoute,
    },
  });
  await app.press("text:Add Server");
  await app.type("server", TS);
  await app.waitFor("text:Plain HTTP over Tailscale: Tailscale encrypts the connection end to end. Your phone must be on the same tailnet.");
  expect(app.shows("plain-http-warning")).toBe(false);
  await app.type("username", "admin");
  await app.type("password", "pw");
  await app.press("Stay signed in");
  await app.press("text:Add Server");
  await app.waitFor("text:Running");
  await app.press("back");
  await app.waitFor("text:Your servers");
  expect(app.texts().some((t) => t.includes("HTTP over Tailscale"))).toBe(true);
  expect(app.requests().every((r) => r.url.startsWith(TS))).toBe(true);
});

test("a page that let its artwork go while buried draws it again when it's back on top", async () => {
  const app = await openSignedIn({
    network: {
      [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-1", expiration: "2099-01-02T00:00:00Z" } },
      [`GET ${SERVER}/api/Shards*`]: shardsRoute,
      [`GET ${SERVER}/api/shards/a1/snapshots*`]: { body: { nodes: [], headId: null, settings: null } },
      [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 },
    },
  });
  expect(app.count("backdrop-art")).toBe(1); // home
  await app.press("server-Home Lab");
  await app.waitFor("text:Running");
  await app.press("shard-Minecraft SMP");
  await app.waitFor("controls");
  await app.press("open-snapshots");
  await app.waitFor("text:Snapshots");
  expect(app.count("backdrop-art")).toBe(1); // the snapshots page's own
  // Home and the instances list were two and three deep, with no artwork; back on top they draw it.
  await app.press("back");
  await app.press("back");
  await app.waitFor("text:Running");
  await app.waitUntil(() => app.count("backdrop-art") === 1);
  await app.press("back");
  await app.waitFor("text:Your servers");
  await app.waitUntil(() => app.count("backdrop-art") === 1);
});

test("names from the panel never pick up JavaScript's built-in keys", () => {
  expect(splitCategory("Arma Reforger:stadia_controller")).toEqual({ name: "Arma Reforger", icon: "gamepad" });
  expect(splitCategory("Odd:constructor")).toEqual({ name: "Odd", icon: null });
  expect(splitCategory("Odd:toString")).toEqual({ name: "Odd", icon: null });
  expect(statusLabel("constructor")).toBe("constructor");
});

// ---- Crash alerts --------------------------------------------------------------------------

/** The Android app's crash alerts, played by the test: what it keeps, and the permission. */
function fakeCrashWatch(state: { permission: string; askAnswer?: string; watched: Map<string, { token: string; url: string }>; paused?: string[]; cleared?: number }) {
  type Args = { serverId: string; url?: string; name?: string; token?: string; expiration?: string };
  return {
    handlers: {
      "crashWatch.status": () => ({ permission: state.permission, watched: [...state.watched.keys()], paused: state.paused ?? [] }),
      "crashWatch.requestPermission": () => {
        if (state.permission === "default") state.permission = state.askAnswer ?? "granted";
        return state.permission;
      },
      "crashWatch.openSettings": () => true,
      "crashWatch.set": (a: Args) => {
        state.watched.set(a.serverId, { token: a.token!, url: a.url! });
        return true;
      },
      "crashWatch.token": (a: Args) => {
        const w = state.watched.get(a.serverId);
        if (!w) return false;
        w.token = a.token!;
        return true;
      },
      "crashWatch.remove": (a: Args) => state.watched.delete(a.serverId),
      "crashWatch.clear": () => {
        state.watched.clear();
        state.cleared = (state.cleared ?? 0) + 1;
        return true;
      },
    },
  };
}

test("crash alerts: turned on in Security after the permission and a warning, handed new tokens, and gone with the PIN", async () => {
  const state = { permission: "default", watched: new Map<string, { token: string; url: string }>() };
  const app = await openSignedIn({
    network: { ...unlockedHome, [`POST ${SERVER}/api/Auth/renew`]: { body: { token: "tok-2", expiration: "2099-01-03T00:00:00Z" } } },
    host: fakeCrashWatch(state),
  });
  await app.press("security");
  await app.waitFor("id:crash-alerts");
  await app.press("crash-alerts-Home Lab");
  // The permission was asked, then what it costs is said once.
  await app.waitFor("text:Turn on crash alerts?");
  expect(state.permission).toBe("granted");
  await app.press("confirm-on");
  await app.waitUntil(() => state.watched.has("s1"));
  expect(state.watched.get("s1")!.url).toBe(SERVER);
  expect(["tok-1", "tok-2"]).toContain(state.watched.get("s1")!.token);
  await app.waitFor("id:crash-alerts >> text:On");

  // Off, then on again: with none on, the warning is said again.
  await app.press("crash-alerts-Home Lab");
  await app.waitUntil(() => !state.watched.has("s1"));
  await app.press("crash-alerts-Home Lab");
  await app.waitFor("text:Turn on crash alerts?");
  await app.press("confirm-on");
  await app.waitUntil(() => state.watched.has("s1"));

  // Removing the PIN erases the saved sign-ins, and the alerts' copies with them.
  await app.press("remove-pin");
  await app.press("confirm-erase");
  await app.waitUntil(() => state.watched.size === 0);
});

test("crash alerts: a refused permission offers the phone's settings and turns nothing on", async () => {
  const state = { permission: "default", askAnswer: "denied", watched: new Map<string, { token: string; url: string }>() };
  const app = await openSignedIn({ network: unlockedHome, host: fakeCrashWatch(state) });
  await app.press("security");
  await app.waitFor("id:crash-alerts");
  await app.press("crash-alerts-Home Lab");
  await app.waitFor("text:Notifications are off");
  await app.press("confirm-settings");
  await app.waitUntil(() => app.host.calls().some((c) => c.name === "crashWatch.openSettings"));
  expect(state.watched.size).toBe(0);
});

test("crash alerts: a fresh sign-in hands the token over, and signing out takes it back", async () => {
  const state = { permission: "granted", watched: new Map([["s1", { token: "old", url: SERVER }]]) };
  const app = await openSignedIn({ network: unlockedHome, host: fakeCrashWatch(state) });
  // Unlocking applied the saved session: the alerts have it.
  await app.waitUntil(() => state.watched.get("s1")?.token === "tok-1");
  await app.press("more-Home Lab");
  await app.waitFor("menu-signOut");
  await app.press("menu-signOut");
  await app.waitUntil(() => !state.watched.has("s1"));
});

test("crash alerts: a pressed alert opens its instance once the app is unlocked", async () => {
  const state = { permission: "granted", watched: new Map([["s1", { token: "tok-1", url: SERVER }]]) };
  const app = await open("./App.tsx", {
    storage: await vaultStorage(),
    network: { ...unlockedHome, [`GET ${SERVER}/api/shards/a1/snapshots*`]: { body: { nodes: [], headId: null, settings: null } }, [`GET ${SERVER}/assets/app-icons/*`]: { status: 404 } },
    host: fakeCrashWatch(state),
  });
  await app.waitFor("text:AMP Mobile is locked");
  await app.host.send("crashWatch.open", { serverId: "s1", shardId: "a1", title: "Minecraft SMP" });
  expect(app.texts()).toContain("AMP Mobile is locked"); // nothing opens behind the lock
  await enterPin(app);
  await app.waitFor("controls");
  expect(app.texts()).toContain("Minecraft SMP");
  // An alert for a server that's gone does nothing.
  await app.host.send("crashWatch.open", { serverId: "nope", shardId: "x" });
  expect(app.texts()).toContain("Minecraft SMP");
});
