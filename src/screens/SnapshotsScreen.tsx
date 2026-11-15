import { signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import {
  Content,
  contentLabel,
  DESCRIPTION_MAX,
  deleteSnapshot,
  editSnapshot,
  getTimeline,
  isBusy,
  Kind,
  megabytes,
  NAME_MAX,
  percent,
  restoreSnapshot,
  saveSnapshotSettings,
  type Snapshot,
  type SnapshotTimeline,
  Stage,
  stageLabel,
  Status,
  takeSnapshot,
  triggerLabel,
} from "../api/snapshots";
import { momentOf, Section } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Dropdown, MoreButton } from "../components/Dropdown";
import { Prompt, type PromptRequest } from "../components/Prompt";
import { AppPage, Checkbox, ErrorText, Field, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { sessionRejected } from "../lib/session";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";

/** Checked this often while a snapshot or a restore runs, and this often otherwise. */
const BUSY_MS = 3_000;
const IDLE_MS = 30_000;

const whenOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : momentOf(d);
};

/** An instance's snapshots: take one, follow it, restore, rename, pin or delete, and the storage limits. */
export function SnapshotsScreen(props: { serverId: string; id: string; title: string }) {
  const server = serverById(props.serverId);
  const timeline = signal<SnapshotTimeline | null>(null);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const refreshing = signal(false);
  const busy = signal(false);
  const prompt = signal<PromptRequest | null>(null);
  let loadedAt = 0;
  let loadId = 0;

  const client = () => clientFor(props.serverId);

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set(e.message && !e.message.startsWith("You don't") ? e.message : "Your AMP account isn't allowed to do that on this instance.");
    } else {
      error.set((e as Error).message);
    }
  };

  const load = async () => {
    const mine = ++loadId;
    try {
      const t = await getTimeline(client(), props.id);
      if (mine !== loadId) return; // a newer load is on its way
      timeline.set(t);
      loadedAt = Date.now();
      error.set(null);
    } catch (e) {
      if (mine === loadId) await fail(e);
    }
  };

  const working = () => {
    const t = timeline();
    return !!t && (!!t.restoringId || t.nodes.some(isBusy));
  };

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "snapshots" && top.id === props.id && top.serverId === props.serverId;
  };
  // Quick checks only while something runs; otherwise the quiet pace of other pages.
  poll(
    async () => {
      if (working() || Date.now() - loadedAt >= IDLE_MS - 500) await load();
    },
    BUSY_MS,
    onTop,
  );

  const pullToRefresh = async () => {
    refreshing.set(true);
    await load();
    refreshing.set(false);
  };

  /** Runs one change at a time, then reloads. */
  const act = async (work: () => Promise<unknown>, done?: string) => {
    if (busy()) return;
    busy.set(true);
    notice.set(null);
    try {
      await work();
      if (done) notice.set(done);
      await load();
    } catch (e) {
      await fail(e);
    } finally {
      busy.set(false);
    }
  };

  const restore = async (s: Snapshot) => {
    const action = await confirm({
      title: `Restore ${s.name || whenOf(s.createdAt)}?`,
      message:
        "The instance's files go back to how they were in this snapshot. AMP first takes a snapshot of how they are now, so you can undo it. The instance may stop while it restores.",
      icon: "⏪",
      tone: "danger",
      actions: [{ id: "restore", label: "Restore", tone: "danger" }],
    });
    if (action === "restore") await act(() => restoreSnapshot(client(), props.id, s.id), "Restoring. AMP saved the current state first.");
  };

  const remove = async (s: Snapshot) => {
    const children = timeline()?.nodes.filter((n) => n.parentId === s.id).length ?? 0;
    const action = await confirm({
      title: `Delete ${s.name || whenOf(s.createdAt)}?`,
      message:
        children > 0
          ? "Later partial snapshots build on this one; AMP decides whether they can stay. This can't be undone."
          : "Its files are deleted from the machine. This can't be undone.",
      icon: "🗑️",
      tone: "danger",
      actions: [{ id: "delete", label: "Delete", tone: "danger" }],
    });
    if (action === "delete") await act(() => deleteSnapshot(client(), props.id, s.id), "Snapshot deleted.");
  };

  const rename = (s: Snapshot) =>
    prompt.set({
      title: "Name this snapshot",
      icon: "🏷️",
      value: s.name ?? "",
      placeholder: "e.g. Before the 1.21 update",
      confirm: "Save",
      onSubmit: async (name) => {
        if (name.trim().length > NAME_MAX) return `Keep it to ${NAME_MAX} characters.`;
        await editSnapshot(client(), props.id, s.id, { name, description: s.description, sticky: s.sticky });
        await load();
      },
    });

  const describe = (s: Snapshot) =>
    prompt.set({
      title: "Describe this snapshot",
      icon: "📝",
      value: s.description ?? "",
      placeholder: "What it's for",
      confirm: "Save",
      onSubmit: async (description) => {
        if (description.trim().length > DESCRIPTION_MAX) return `Keep it to ${DESCRIPTION_MAX} characters.`;
        await editSnapshot(client(), props.id, s.id, { name: s.name, description, sticky: s.sticky });
        await load();
      },
    });

  const pin = (s: Snapshot) =>
    act(
      () => editSnapshot(client(), props.id, s.id, { name: s.name, description: s.description, sticky: !s.sticky }),
      s.sticky ? "Unpinned: automatic clean-up may remove it." : "Pinned: automatic clean-up won't remove it.",
    );

  const nodes = () => timeline()?.nodes ?? [];
  const totalMb = () => nodes().reduce((sum, n) => sum + (n.status === Status.Complete ? n.sizeMb : 0), 0);
  const restoringNode = () => {
    const t = timeline();
    return t?.restoringId ? (t.nodes.find((n) => n.id === t.restoringId) ?? null) : null;
  };

  return (
    <AppPage title="Snapshots" subtitle={props.title || server?.name || ""}>
      <Screen refreshing={refreshing()} onRefresh={pullToRefresh}>
        <View class="w-full max-w-3xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <Text class="text-sm text-muted-foreground">
            Backups of this instance. Restoring one puts its files back; AMP saves the current state first, so a restore can be undone.
          </Text>

          <If when={error()}>
            {(message) => (
              <View class="gap-3">
                <ErrorText message={message()} />
                <View class="flex-row">
                  <SecondaryButton title="Try again" onPress={load} />
                </View>
              </View>
            )}
          </If>
          <If when={notice()}>
            {(n) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text class="text-sm text-success">{n()}</Text>
              </View>
            )}
          </If>

          <If when={timeline()?.restoringId}>
            <RestoreBanner timeline={timeline()!} node={restoringNode()} />
          </If>

          <If when={timeline()}>
            <TakeCard
              canPartial={nodes().some((n) => n.status === Status.Complete)}
              busy={busy() || !!timeline()?.restoringId}
              onTake={(s) => act(() => takeSnapshot(client(), props.id, s), "Snapshot started. It carries on if you leave this page.")}
            />
          </If>

          <If when={!error() && timeline() === null}>
            <Text class="text-muted-foreground">Loading snapshots…</Text>
          </If>

          <If when={timeline()}>
            <Section title="Timeline" note={nodes().length ? `${nodes().length} · ${megabytes(totalMb())}` : undefined}>
              <If when={nodes().length === 0}>
                <Text class="text-sm text-muted-foreground">No snapshots yet. Take one above, or add a schedule on the Schedules page.</Text>
              </If>
              <Each of={nodes()} key={(n: Snapshot) => n.id}>
                {(node) => (
                  <SnapshotRow
                    snapshot={node()}
                    onDisk={timeline()?.headId === node().id}
                    restoring={!!timeline()?.restoringId}
                    onRestore={() => restore(node())}
                    onRename={() => rename(node())}
                    onDescribe={() => describe(node())}
                    onPin={() => pin(node())}
                    onDelete={() => remove(node())}
                  />
                )}
              </Each>
            </Section>
          </If>

          <If when={timeline()}>
            <LimitsCard
              timeline={timeline()!}
              busy={busy()}
              onSave={(s) => act(() => saveSnapshotSettings(client(), props.id, s), "Limits saved.")}
            />
          </If>
        </View>
      </Screen>
      <Prompt request={prompt()} onClose={() => prompt.set(null)} />
    </AppPage>
  );
}

function ProgressBar(props: { pct: number | null }) {
  return (
    <View class="h-1.5 overflow-hidden rounded-full bg-white/10">
      <If when={props.pct !== null} else={<View class="h-full w-1/3 rounded-full bg-primary/60" />}>
        <View class="h-full rounded-full bg-primary" style={{ width: `${props.pct ?? 0}%` }} />
      </If>
    </View>
  );
}

function RestoreBanner(props: { timeline: SnapshotTimeline; node: Snapshot | null }) {
  const pct = () => percent(props.timeline.restoreProcessed, props.timeline.restoreTotal);
  return (
    <View testID="restoring" class="gap-2 rounded-(--radius) border border-warning/30 bg-warning/10 p-4">
      <Text class="text-sm font-semibold text-warning">
        {`Restoring${props.node ? ` ${props.node.name || whenOf(props.node.createdAt)}` : ""}…`}
      </Text>
      <Text class="text-xs text-muted-foreground">
        {`${stageLabel(props.timeline.restoreStage)}${
          props.timeline.restoreStage === Stage.Processing && props.timeline.restoreTotal > 0
            ? ` · ${props.timeline.restoreProcessed.toLocaleString()} of ${props.timeline.restoreTotal.toLocaleString()} files`
            : ""
        }`}
      </Text>
      <ProgressBar pct={props.timeline.restoreStage === Stage.Processing ? pct() : null} />
    </View>
  );
}

function Chip(props: { label: string; on: boolean; disabled?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Text
      role="button"
      testID={props.testID}
      onPress={() => !props.disabled && props.onPress()}
      class={`rounded-full border px-3.5 py-2 text-sm font-semibold ${
        props.on ? "border-primary bg-primary text-primary-foreground" : "border-white/10 bg-background/60 text-muted-foreground"
      } ${props.disabled ? "opacity-40" : ""}`}
    >
      {props.label}
    </Text>
  );
}

/** "Take a snapshot": closed to one button until opened. */
function TakeCard(props: {
  canPartial: boolean;
  busy: boolean;
  onTake: (s: { kind: number; content: number; name: string; description: string; sticky: boolean }) => Promise<void>;
}) {
  const open = signal(false);
  const name = signal("");
  const description = signal("");
  const partial = signal(true);
  const content = signal<number>(Content.GameState);
  const sticky = signal(false);
  const problem = signal<string | null>(null);

  const kind = () => (partial() && props.canPartial ? Kind.Partial : Kind.Full);
  const toggle = (flag: number) => content.set(content() ^ flag);

  const take = async () => {
    if (content() === 0) return problem.set("Choose at least one thing to include.");
    if (name().trim().length > NAME_MAX) return problem.set(`Keep the name to ${NAME_MAX} characters.`);
    if (description().trim().length > DESCRIPTION_MAX) return problem.set(`Keep the description to ${DESCRIPTION_MAX} characters.`);
    problem.set(null);
    await props.onTake({ kind: kind(), content: content(), name: name(), description: description(), sticky: sticky() });
    open.set(false);
    name.set("");
    description.set("");
    sticky.set(false);
  };

  return (
    <If
      when={open()}
      else={<PrimaryButton title="Take a snapshot" icon="📸" disabled={props.busy} onPress={() => open.set(true)} />}
    >
      <Section title="Take a snapshot">
        <Field label="Name (optional)" value={name()} onChange={(v) => name.set(v)} placeholder="e.g. Before the 1.21 update" testID="snapshot-name" />
        <Field label="Description (optional)" value={description()} onChange={(v) => description.set(v)} placeholder="What it's for" />

        <View class="gap-1.5">
          <Text class="text-sm font-semibold text-foreground">Type</Text>
          <View class="flex-row flex-wrap gap-2">
            <Chip label="Partial" testID="kind-partial" on={kind() === Kind.Partial} disabled={!props.canPartial} onPress={() => partial.set(true)} />
            <Chip label="Full" testID="kind-full" on={kind() === Kind.Full} onPress={() => partial.set(false)} />
          </View>
          <Text class="text-xs text-muted-foreground">
            {props.canPartial
              ? kind() === Kind.Partial
                ? "Only what changed since the last snapshot: quicker and smaller."
                : "Everything, on its own: larger, and doesn't depend on earlier snapshots."
              : "The first snapshot is always full; later ones can be partial."}
          </Text>
        </View>

        <View class="gap-1.5">
          <Text class="text-sm font-semibold text-foreground">Include</Text>
          <Checkbox label="Game data (worlds, saves, configs)" testID="include-game" checked={!!(content() & Content.GameState)} onChange={() => toggle(Content.GameState)} />
          <Checkbox label="Base install (can be downloaded again)" testID="include-base" checked={!!(content() & Content.BaseData)} onChange={() => toggle(Content.BaseData)} />
          <Checkbox label="AMP settings for this instance" testID="include-amp" checked={!!(content() & Content.AmpConfig)} onChange={() => toggle(Content.AmpConfig)} />
        </View>

        <Checkbox label="Pin it (automatic clean-up never removes it)" testID="snapshot-pin" checked={sticky()} onChange={(v) => sticky.set(v)} />

        <If when={problem()}>{(p) => <ErrorText message={p()} />}</If>

        <View class="flex-row gap-3">
          <SecondaryButton title="Cancel" onPress={() => open.set(false)} />
          <SecondaryButton title={props.busy ? "Working…" : "Take it"} tone="success" testID="snapshot-take" disabled={props.busy} onPress={take} />
        </View>
      </Section>
    </If>
  );
}

function SnapshotRow(props: {
  snapshot: Snapshot;
  onDisk: boolean;
  restoring: boolean;
  onRestore: () => void;
  onRename: () => void;
  onDescribe: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const open = signal(false);
  const s = () => props.snapshot;
  const complete = () => s().status === Status.Complete;
  const pct = () => (s().stage === Stage.Processing ? percent(s().processedFiles, s().totalFiles) : null);

  const items = () => [
    ...(complete() && !s().archiveMissing && !props.restoring
      ? [{ id: "restore", label: "Restore", icon: "⏪", hint: "Put the instance back to this point", tone: "danger" as const, onSelect: props.onRestore }]
      : []),
    { id: "rename", label: "Rename", icon: "🏷️", onSelect: props.onRename },
    { id: "describe", label: "Edit description", icon: "📝", onSelect: props.onDescribe },
    {
      id: "pin",
      label: s().sticky ? "Unpin" : "Pin",
      icon: "📌",
      hint: s().sticky ? "Automatic clean-up may remove it" : "Automatic clean-up won't remove it",
      onSelect: props.onPin,
    },
    // Nothing is deleted mid-capture or while a restore runs (it may be the one being restored).
    ...(isBusy(s()) || props.restoring ? [] : [{ id: "delete", label: "Delete", icon: "🗑️", tone: "danger" as const, onSelect: props.onDelete }]),
  ];

  return (
    <View testID={`snapshot-${s().id}`} class="gap-1.5 border-b border-white/5 pb-3">
      <View class="flex-row items-start gap-2">
        <View
          class={`mt-1.5 h-2.5 w-2.5 rounded-full ${
            s().status === Status.Failed ? "bg-destructive" : !complete() ? "bg-warning" : s().kind === Kind.Full ? "bg-primary" : "bg-sky-400"
          }`}
        />
        <View class="flex-1 gap-1">
          <Text class="text-base font-semibold text-card-foreground">{s().name || whenOf(s().createdAt) || "Snapshot"}</Text>
          <View class="flex-row flex-wrap gap-1.5">
            <Pill label={s().kind === Kind.Full ? "Full" : "Partial"} tone="muted" />
            <If when={props.onDisk}>
              <Pill label="On disk now" tone="success" />
            </If>
            <If when={s().sticky}>
              <Pill label="📌 Pinned" tone="muted" />
            </If>
            <If when={s().status === Status.Failed}>
              <Pill label="Failed" tone="danger" />
            </If>
            <If when={isBusy(s())}>
              <Pill label={s().status === Status.Pending ? "Waiting" : "Taking…"} tone="warning" />
            </If>
            <If when={s().archiveMissing}>
              <Pill label="File missing" tone="danger" />
            </If>
          </View>
          <Text class="text-xs text-muted-foreground">
            {[s().name ? whenOf(s().createdAt) : "", triggerLabel(s()), complete() ? megabytes(s().sizeMb) : "", complete() ? `${s().fileCount.toLocaleString()} files` : ""]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text class="text-xs text-muted-foreground">{contentLabel(s().content)}</Text>
          <If when={s().description}>{(d) => <Text class="text-sm text-card-foreground">{d()}</Text>}</If>
          <If when={isBusy(s())}>
            <View class="gap-1">
              <Text class="text-xs text-warning">
                {`${stageLabel(s().stage)}${pct() !== null ? ` · ${s().processedFiles.toLocaleString()} of ${s().totalFiles.toLocaleString()} files` : ""}`}
              </Text>
              <ProgressBar pct={pct()} />
            </View>
          </If>
          <If when={s().status === Status.Failed && s().failureReason}>{(r) => <Text class="text-xs text-destructive">{r()}</Text>}</If>
          <If when={s().archiveMissing}>
            <Text class="text-xs text-destructive">Its file isn't where AMP keeps it, so it can't be restored.</Text>
          </If>
          <If when={s().skippedCount > 0}>
            <Text class="text-xs text-warning">
              {`${s().skippedCount.toLocaleString()} file${s().skippedCount === 1 ? "" : "s"} couldn't be read and ${s().skippedCount === 1 ? "isn't" : "aren't"} in it${
                s().skippedFiles[0] ? ` (e.g. ${s().skippedFiles[0].relPath})` : ""
              }.`}
            </Text>
          </If>
        </View>
        <Dropdown
          open={open()}
          onOpenChange={(o) => open.set(o)}
          title={s().name || whenOf(s().createdAt) || "Snapshot"}
          items={items()}
          trigger={<MoreButton testID={`snapshot-more-${s().id}`} class="bg-transparent" />}
        />
      </View>
    </View>
  );
}

/** Size limits and how to capture a game that can't pause its saving. */
function LimitsCard(props: {
  timeline: SnapshotTimeline;
  busy: boolean;
  onSave: (s: { maxBackupSizeMb: number; maxTotalStorageMb: number; stopWhenNoQuiesce: boolean }) => Promise<void>;
}) {
  const editing = signal(false);
  const perSnapshot = signal("");
  const total = signal("");
  const stop = signal(false);
  const problem = signal<string | null>(null);
  const settings = () => props.timeline.settings ?? { maxBackupSizeMb: 0, maxTotalStorageMb: 0, stopWhenNoQuiesce: false };
  const limit = (mb: number) => (mb > 0 ? megabytes(mb) : "No limit");

  const start = () => {
    perSnapshot.set(String(settings().maxBackupSizeMb || ""));
    total.set(String(settings().maxTotalStorageMb || ""));
    stop.set(settings().stopWhenNoQuiesce);
    problem.set(null);
    editing.set(true);
  };

  const parse = (v: string): number | null => {
    const t = v.trim();
    if (!t) return 0;
    if (!/^\d{1,9}$/.test(t)) return null;
    return Number(t);
  };

  const save = async () => {
    const a = parse(perSnapshot());
    const b = parse(total());
    if (a === null || b === null) return problem.set("Use whole megabytes, or leave it empty for no limit.");
    problem.set(null);
    await props.onSave({ maxBackupSizeMb: a, maxTotalStorageMb: b, stopWhenNoQuiesce: stop() });
    editing.set(false);
  };

  return (
    <Section title="Limits">
      <If
        when={editing()}
        else={
          <View class="gap-2">
            <Row label="Largest snapshot" value={limit(settings().maxBackupSizeMb)} />
            <Row label="All snapshots together" value={limit(settings().maxTotalStorageMb)} />
            <Row label="Stop the game if it can't pause saving" value={settings().stopWhenNoQuiesce ? "Yes" : "No"} />
            <View class="flex-row pt-1">
              <SecondaryButton title="Change limits" testID="limits-edit" onPress={start} />
            </View>
          </View>
        }
      >
        <Field label="Largest snapshot (MB)" value={perSnapshot()} onChange={(v) => perSnapshot.set(v)} placeholder="No limit" hint="Before compression. Empty for no limit." testID="limit-each" />
        <Field label="All snapshots together (MB)" value={total()} onChange={(v) => total.set(v)} placeholder="No limit" hint="Empty for no limit." testID="limit-total" />
        <Checkbox label="Stop the game while capturing if it can't pause its saving" checked={stop()} onChange={(v) => stop.set(v)} />
        <Text class="text-xs text-muted-foreground">Safer copies of games with no save-pause command, at the cost of a short stop.</Text>
        <If when={problem()}>{(p) => <ErrorText message={p()} />}</If>
        <View class="flex-row gap-3">
          <SecondaryButton title="Cancel" onPress={() => editing.set(false)} />
          <SecondaryButton title="Save" tone="success" testID="limits-save" disabled={props.busy} onPress={save} />
        </View>
      </If>
    </Section>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <View class="flex-row items-baseline justify-between gap-3">
      <Text class="flex-1 text-sm text-muted-foreground">{props.label}</Text>
      <Text class="text-sm font-semibold text-card-foreground">{props.value}</Text>
    </View>
  );
}
