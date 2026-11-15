import { Picker, Scroll, signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import {
  copyFile,
  createArchive,
  createFolder,
  deleteFile,
  downloadUrl,
  type ExtractResult,
  extractArchive,
  type FileEntry,
  formatBytes,
  isArchive,
  isTextFile,
  joinPath,
  nameProblem,
  listFiles,
  type ManagedFile,
  managedFiles,
  moveFile,
  parentOf,
  uploadFile,
  writeText,
} from "../api/files";
import { Backdrop } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Dropdown, type DropdownItem, MoreButton } from "../components/Dropdown";
import { Prompt, type PromptRequest } from "../components/Prompt";
import { AppPage, ErrorText } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, locked } from "../state/servers";
import { sessionRejected } from "../lib/session";
import { openSafe } from "../lib/links";

const checkName = nameProblem;

function when(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function summary(result: ExtractResult): string {
  const skipped = result.skippedOnDisk + result.skippedDenied + result.skippedBlocked + result.skippedManaged;
  return skipped ? `${result.extracted} written, ${skipped} skipped` : `${result.extracted} written`;
}

/** One folder of an instance's files. Folders open as pages of their own, so back goes up. */
export function FilesScreen(props: { serverId: string; id: string; title: string; path: string }) {
  const entries = signal<FileEntry[] | null>(null);
  const managed = signal<Record<string, ManagedFile>>({});
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const refreshing = signal(false);
  const upload = signal<{ name: string; loaded: number; total: number } | null>(null);
  const prompt = signal<PromptRequest | null>(null);

  const client = () => clientFor(props.serverId);

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set(e.message && !e.message.startsWith("You don't") ? e.message : "Your account isn't allowed to do that here.");
    } else {
      error.set((e as Error).message);
    }
  };

  let loadSeq = 0;
  const load = async () => {
    const mine = ++loadSeq;
    try {
      const [list, man] = await Promise.all([
        listFiles(client(), props.id, props.path),
        managedFiles(client(), props.id, props.path).catch(() => [] as ManagedFile[]),
      ]);
      if (mine !== loadSeq) return; // a newer listing started (after an action): its answer wins
      entries.set(
        [...list].sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1)),
      );
      managed.set(Object.fromEntries(man.map((m) => [m.path, m])));
      error.set(null);
    } catch (e) {
      await fail(e);
    }
  };
  load();

  const act = async (work: () => Promise<string | void>) => {
    error.set(null);
    notice.set(null);
    try {
      const message = await work();
      if (message) notice.set(message);
      await load();
    } catch (e) {
      await fail(e);
    }
  };

  const open = (entry: FileEntry) => {
    if (entry.isDirectory) {
      nav.push({ name: "files", serverId: props.serverId, id: props.id, title: props.title, path: entry.path });
    } else if (isTextFile(entry)) {
      nav.push({
        name: "fileEdit",
        serverId: props.serverId,
        id: props.id,
        path: entry.path,
        managed: managed()[entry.path]?.kind ?? null,
      });
    } else {
      actions(entry);
    }
  };

  const download = (entry: FileEntry) =>
    act(async () => {
      // There's no in-app save: the browser downloads it (iOS: Safari → Files › Downloads;
      // Android: the browser's Downloads). Neither needs a storage permission.
      const url = await downloadUrl(client(), props.id, entry);
      // Only ever to this server: the link carries a one-time download ticket.
      const host = new URL(client().baseUrl).hostname.toLowerCase();
      // A plain-HTTP panel's download is plain HTTP too, from that panel only.
      await openSafe(url, (h) => h === host, true);
      return entry.isDirectory
        ? "Downloading as a zip in your browser. It will be in your Downloads."
        : "Downloading in your browser. It will be in your Downloads.";
    });

  const remove = async (entry: FileEntry) => {
    const action = await confirm({
      title: `Delete ${entry.name}?`,
      message: entry.isDirectory ? "The folder and everything in it are deleted. This can't be undone." : "This can't be undone.",
      icon: "🗑️",
      tone: "danger",
      actions: [{ id: "delete", label: "Delete", tone: "danger" }],
    });
    if (action === "delete") await act(async () => deleteFile(client(), props.id, entry.path));
  };

  const ask = (request: PromptRequest) => prompt.set(request);

  const rename = (entry: FileEntry) =>
    ask({
      title: `Rename ${entry.isDirectory ? "folder" : "file"}`,
      icon: "🏷️",
      value: entry.name,
      confirm: "Rename",
      onSubmit: async (name) => {
        const bad = checkName(name);
        if (bad) return bad;
        if (name === entry.name) return;
        await moveFile(client(), props.id, entry.path, joinPath(parentOf(entry.path), name));
        await load();
      },
    });

  const duplicate = (entry: FileEntry) => {
    const dot = entry.isDirectory ? -1 : entry.name.lastIndexOf(".");
    const copyName = dot > 0 ? `${entry.name.slice(0, dot)} copy${entry.name.slice(dot)}` : `${entry.name} copy`;
    ask({
      title: `Copy ${entry.name}`,
      icon: "📋",
      message: "Name of the copy, in this folder:",
      value: copyName,
      confirm: "Copy",
      onSubmit: async (name) => {
        const bad = checkName(name);
        if (bad) return bad;
        const result = await copyFile(client(), props.id, entry.path, joinPath(parentOf(entry.path), name));
        notice.set(`Copied: ${summary(result)}.`);
        await load();
      },
    });
  };

  const zip = (entry: FileEntry) =>
    ask({
      title: `Zip ${entry.name}`,
      icon: "🗜️",
      value: `${entry.name}.zip`,
      confirm: "Create zip",
      onSubmit: async (name) => {
        const bad = checkName(name);
        if (bad) return bad;
        await createArchive(client(), props.id, [entry.path], joinPath(props.path, name.endsWith(".zip") ? name : `${name}.zip`));
        await load();
      },
    });

  const extract = async (entry: FileEntry) => {
    const action = await confirm({
      title: `Extract ${entry.name}?`,
      message: "Into this folder. Files that already exist are kept unless you choose to replace them.",
      icon: "🗜️",
      actions: [
        { id: "keep", label: "Extract", tone: "primary" },
        { id: "overwrite", label: "Extract and replace", tone: "danger" },
      ],
    });
    if (action === "keep" || action === "overwrite") {
      await act(async () => `Extracted: ${summary(await extractArchive(client(), props.id, entry.path, action === "overwrite"))}.`);
    }
  };

  /** The row whose dropdown is open (by path). */
  const menuFor = signal<string | null>(null);
  const actions = (entry: FileEntry) => menuFor.set(entry.path);

  const menuItems = (entry: FileEntry): DropdownItem[] => [
    ...(entry.isDirectory
      ? [{ id: "open", label: "Open", icon: "📂", onSelect: () => open(entry) }]
      : isTextFile(entry)
        ? [{ id: "open", label: "Edit", icon: "✏️", onSelect: () => open(entry) }]
        : []),
    { id: "download", label: entry.isDirectory ? "Download as zip" : "Download", icon: "⬇️", onSelect: () => download(entry) },
    { id: "rename", label: "Rename", icon: "🏷️", onSelect: () => rename(entry) },
    { id: "copy", label: "Copy", icon: "📋", onSelect: () => duplicate(entry) },
    ...(isArchive(entry) ? [{ id: "extract", label: "Extract here", icon: "🗜️", onSelect: () => extract(entry) }] : []),
    ...(entry.isDirectory ? [{ id: "zip", label: "Zip", icon: "🗜️", onSelect: () => zip(entry) }] : []),
    { id: "delete", label: "Delete", icon: "🗑️", tone: "danger" as const, onSelect: () => remove(entry) },
  ];

  const newFolder = () =>
    ask({
      title: "New folder",
      icon: "📁",
      placeholder: "Folder name",
      confirm: "Create",
      onSubmit: async (name) => {
        const bad = checkName(name);
        if (bad) return bad;
        await createFolder(client(), props.id, joinPath(props.path, name));
        await load();
      },
    });

  const newFile = () =>
    ask({
      title: "New text file",
      icon: "📄",
      placeholder: "e.g. notes.txt",
      confirm: "Create",
      onSubmit: async (name) => {
        const bad = checkName(name);
        if (bad) return bad;
        if (entries()?.some((e) => e.name === name)) return "Something with that name already exists";
        const path = joinPath(props.path, name);
        await writeText(client(), props.id, path, "");
        await load();
        nav.push({ name: "fileEdit", serverId: props.serverId, id: props.id, path, managed: null });
      },
    });

  const pickAndUpload = async () => {
    error.set(null);
    notice.set(null);
    let picked;
    try {
      // The system document picker (iOS UIDocumentPickerViewController, Android
      // ACTION_OPEN_DOCUMENT) hands over only what the user picks: no storage permission.
      picked = await Picker.pickFiles({ multiple: true, limit: 20 });
    } catch (e) {
      error.set((e as Error).message);
      return;
    }
    if (!picked.length) return;
    let done = 0;
    try {
      for (const { file } of picked) {
        if (locked()) break;
        if (entries()?.some((e) => e.name === file.name)) {
          const action = await confirm({
            title: `Replace ${file.name}?`,
            message: "A file with this name is already in this folder.",
            icon: "📄",
            cancelLabel: "Skip",
            actions: [{ id: "replace", label: "Replace", tone: "danger" }],
          });
          if (action !== "replace") continue;
        }
        upload.set({ name: file.name, loaded: 0, total: file.size });
        await uploadFile(
          client(),
          props.id,
          props.path,
          file,
          (loaded, total) => upload.set({ name: file.name, loaded, total }),
          // The lock takes every session out of memory: an upload doesn't carry on behind it.
          () => locked(),
        );
        done++;
      }
      if (done) notice.set(done === 1 ? "Uploaded." : `Uploaded ${done} files.`);
    } catch (e) {
      await fail(e);
    } finally {
      upload.set(null);
      await load();
    }
  };

  const crumbs = () => (props.path ? props.path.split("/") : []);
  const percent = (): `${number}%` => {
    const u = upload();
    return u && u.total ? `${Math.max(2, Math.round((u.loaded / u.total) * 100))}%` : "2%";
  };

  return (
    <AppPage title={`${props.title} files`} subtitle={`/${props.path}`}>
      <View class="flex-1 bg-background">
        <Backdrop dim="strong" />
        <View class="gap-2 border-b border-white/10 bg-card/70 px-4 py-2.5">
          <Text class="font-mono text-xs text-muted-foreground" testID="files-path">{`/${props.path}`}</Text>
          <View class="flex-row flex-wrap items-center gap-2">
            <ToolButton testID="new-folder" label="＋ Folder" onPress={newFolder} />
            <ToolButton testID="new-file" label="＋ File" onPress={newFile} />
            <ToolButton testID="upload" label="⇧ Upload" onPress={pickAndUpload} disabled={upload() !== null} />
          </View>
          <Text class="text-[10px] text-muted-foreground">Uploads up to 512 MB per file. Larger files: use SFTP or the web panel.</Text>
        </View>

        <If when={upload()}>
          {(u) => (
            <View class="gap-1.5 border-b border-white/10 bg-card/80 px-4 py-2.5">
              <Text class="text-xs text-foreground">
                Uploading {u().name} · {formatBytes(u().loaded)} of {formatBytes(u().total)}
              </Text>
              <View class="h-1.5 overflow-hidden rounded-full bg-white/10">
                <View class="h-full rounded-full bg-linear-to-r from-hero-from to-hero-to" style={{ width: percent() }} />
              </View>
            </View>
          )}
        </If>

        <Scroll
          class="flex-1"
          refreshing={refreshing()}
          onRefresh={async () => {
            refreshing.set(true);
            await load();
            refreshing.set(false);
          }}
        >
          <View class="w-full max-w-4xl gap-2 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
            <If when={notice()}>{(m) => <Text class="text-sm text-success">{m()}</Text>}</If>
            <If when={entries() === null && !error()}>
              <Text class="text-sm text-muted-foreground">Loading…</Text>
            </If>
            <If when={entries()?.length === 0}>
              <Text class="py-6 text-center text-sm text-muted-foreground">This folder is empty.</Text>
            </If>
            <View class="overflow-hidden rounded-(--radius) border border-white/10 bg-card/85">
              <Each of={entries()} key={(e: FileEntry) => e.path}>
                {(entry) => (
                  <FileRow
                    entry={entry()}
                    managed={managed()[entry().path]}
                    onPress={() => open(entry())}
                    menuOpen={menuFor() === entry().path}
                    onMenuOpenChange={(o) => menuFor.set(o ? entry().path : null)}
                    items={menuItems(entry())}
                  />
                )}
              </Each>
            </View>
          </View>
        </Scroll>

        <Prompt request={prompt()} onClose={() => prompt.set(null)} />
      </View>
    </AppPage>
  );
}

function ToolButton(props: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      onPress={() => !props.disabled && props.onPress()}
      class={`rounded-lg border border-white/10 px-3 py-1.5 ${props.disabled ? "opacity-50" : "bg-secondary active:opacity-70"}`}
    >
      <Text class="text-sm font-semibold text-secondary-foreground">{props.label}</Text>
    </View>
  );
}

function FileRow(props: {
  entry: FileEntry;
  managed?: ManagedFile;
  onPress: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  items: DropdownItem[];
}) {
  const icon = () => (props.entry.isDirectory ? "📁" : isArchive(props.entry) ? "🗜️" : isTextFile(props.entry) ? "📄" : "📦");
  return (
    <View
      role="button"
      testID={`file-${props.entry.name}`}
      onPress={props.onPress}
      onLongPress={() => props.onMenuOpenChange(true)}
      class="flex-row items-center gap-3 border-b border-white/5 px-3 py-3 active:bg-accent"
    >
      <Text class="text-xl">{icon()}</Text>
      <View class="flex-1 gap-0.5">
        <Text class="text-sm font-medium text-card-foreground">{props.entry.name}</Text>
        <Text class="text-xs text-muted-foreground">
          {props.entry.isDirectory ? when(props.entry.modified) : `${formatBytes(props.entry.size)} · ${when(props.entry.modified)}`}
        </Text>
      </View>
      <If when={props.managed}>
        <View class="rounded-md bg-primary/15 px-1.5 py-0.5">
          <Text class="text-[10px] font-semibold text-primary">AMP</Text>
        </View>
      </If>
      <Dropdown
        open={props.menuOpen}
        onOpenChange={props.onMenuOpenChange}
        title={props.entry.name}
        items={props.items}
        trigger={<MoreButton testID={`more-${props.entry.name}`} class="bg-transparent" />}
      />
    </View>
  );
}
