import { cleanup, effect, signal, Text, View } from "nsh";
import { AmpError } from "../api/client";
import { panelText } from "../api/panelText";
import {
  type Catalog,
  createSchedule,
  DESCRIPTION_MAX,
  defaultForm,
  deleteSchedule,
  eventDescription,
  eventName,
  formOf,
  getCatalog,
  getSchedule,
  isStraight,
  listSchedules,
  MODES,
  type Mode,
  NAME_MAX,
  newTask,
  outline,
  paramLabel,
  previewFirings,
  type Run,
  runSchedule,
  type Schedule,
  scheduleHistory,
  setScheduleEnabled,
  statusLabel,
  statusTone,
  type TaskStep,
  taskCategory,
  taskName,
  taskNote,
  took,
  type TriggerForm,
  triggerOf,
  updateSchedule,
  WEEKDAYS,
  whenLabel,
} from "../api/schedules";
import { ago, momentOf, Section } from "../components/analyticsUi";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { Dropdown, MoreButton, Select } from "../components/Dropdown";
import { AppPage, Checkbox, ErrorText, Field, Pill, PrimaryButton, SecondaryButton } from "../components/ui";
import { poll } from "../lib/poll";
import { sessionRejected } from "../lib/session";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";

/** The list is checked this often while a run is under way, and this often otherwise. */
const BUSY_MS = 4_000;
const IDLE_MS = 30_000;

const whenOf = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : momentOf(d);
};

/** Bumped by the editor on each save, so the list reloads when it's back on top. */
const savedCount = signal(0);

/** Shared error handling: a 401 goes to the session handler, a 403 says so plainly. */
function failer(serverId: string, error: (m: string) => void) {
  return async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(serverId);
    } else if (e instanceof AmpError && e.status === 403) {
      error(e.message && !e.message.startsWith("You don't") ? e.message : "Your AMP account isn't allowed to do that on this instance.");
    } else {
      error((e as Error).message);
    }
  };
}

function Notice(props: { text: string }) {
  return (
    <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
      <Text class="text-sm text-success">{props.text}</Text>
    </View>
  );
}

/** An instance's schedules: on or off, when they run next, how the last run went. */
export function SchedulesScreen(props: { serverId: string; id: string; title: string }) {
  const server = serverById(props.serverId);
  const schedules = signal<Schedule[] | null>(null);
  const text = signal<Record<string, string>>({});
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const refreshing = signal(false);
  const busy = signal(false);
  let loadedAt = 0;
  let loadId = 0;

  const client = () => clientFor(props.serverId);
  const fail = failer(props.serverId, (m) => error.set(m));
  panelText(client()).then((t) => text.set(t));

  const load = async () => {
    const mine = ++loadId;
    try {
      const list = await listSchedules(client(), props.id);
      if (mine !== loadId) return;
      schedules.set(list);
      loadedAt = Date.now();
      error.set(null);
    } catch (e) {
      if (mine === loadId) await fail(e);
    }
  };

  const running = () => (schedules() ?? []).some((s) => s.lastRunStatus === "Running" || s.lastRunStatus === "Queued");
  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "schedules" && top.id === props.id && top.serverId === props.serverId;
  };
  let seenSaves = savedCount();
  poll(
    async () => {
      // Back from the editor after a save: load at once rather than at the quiet pace.
      const saved = savedCount() !== seenSaves;
      seenSaves = savedCount();
      if (saved || running() || Date.now() - loadedAt >= IDLE_MS - 500) await load();
    },
    BUSY_MS,
    onTop,
  );

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

  const remove = async (s: Schedule) => {
    const action = await confirm({
      title: `Delete ${s.name}?`,
      message: "It won't run again. Its run history goes with it. This can't be undone.",
      icon: "🗑️",
      tone: "danger",
      actions: [{ id: "delete", label: "Delete", tone: "danger" }],
    });
    if (action === "delete") await act(() => deleteSchedule(client(), props.id, s.id), "Schedule deleted.");
  };

  const runNow = async (s: Schedule) => {
    const action = await confirm({
      title: `Run ${s.name} now?`,
      message: "Its steps run straight away, as if it had fired. Its usual times stay as they are.",
      icon: "▶️",
      actions: [{ id: "run", label: "Run now" }],
    });
    if (action === "run") await act(() => runSchedule(client(), props.id, s.id), "Started. Its result shows here and in its run history.");
  };

  const edit = (s?: Schedule) => nav.push({ name: "scheduleEdit", serverId: props.serverId, id: props.id, title: props.title, scheduleId: s?.id });

  return (
    <AppPage title="Schedules" subtitle={props.title || server?.name || ""}>
      <Screen
        refreshing={refreshing()}
        onRefresh={async () => {
          refreshing.set(true);
          await load();
          refreshing.set(false);
        }}
      >
        <View class="w-full max-w-3xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <Text class="text-sm text-muted-foreground">
            Things AMP does on its own at set times or when something happens: restarts, backups, console commands and more.
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
          <If when={notice()}>{(n) => <Notice text={n()} />}</If>

          <If when={schedules()}>
            <PrimaryButton title="New schedule" icon="➕" onPress={() => edit()} />
          </If>

          <If when={!error() && schedules() === null}>
            <Text class="text-muted-foreground">Loading schedules…</Text>
          </If>

          <If when={schedules()?.length === 0}>
            <Text class="text-sm text-muted-foreground">No schedules yet. Add one to restart nightly, take backups or send announcements.</Text>
          </If>

          <Each of={schedules() ?? []} key={(s: Schedule) => s.id}>
            {(s) => (
              <ScheduleCard
                schedule={s()}
                text={text()}
                busy={busy()}
                onToggle={() =>
                  act(() => setScheduleEnabled(client(), props.id, s().id, !s().enabled), s().enabled ? `${s().name} is off.` : `${s().name} is on.`)
                }
                onRun={() => runNow(s())}
                onEdit={() => edit(s())}
                onHistory={() => nav.push({ name: "scheduleRuns", serverId: props.serverId, id: props.id, scheduleId: s().id, scheduleName: s().name })}
                onDelete={() => remove(s())}
              />
            )}
          </Each>
        </View>
      </Screen>
    </AppPage>
  );
}

function ScheduleCard(props: {
  schedule: Schedule;
  text: Record<string, string>;
  busy: boolean;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const open = signal(false);
  const s = () => props.schedule;
  const steps = () => outline(s().steps, props.text).filter((l) => l.depth === 0);

  const items = () => [
    { id: "run", label: "Run now", icon: "▶️", onSelect: props.onRun },
    { id: "edit", label: "Edit", icon: "✏️", onSelect: props.onEdit },
    { id: "history", label: "Run history", icon: "🧾", onSelect: props.onHistory },
    { id: "delete", label: "Delete", icon: "🗑️", tone: "danger" as const, onSelect: props.onDelete },
  ];

  return (
    <View testID={`schedule-${s().id}`} class="gap-2 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
      <View class="flex-row items-start gap-3">
        <View class="flex-1 gap-1" role="button" onPress={props.onEdit}>
          <Text class="text-base font-semibold text-card-foreground">{s().name || "Untitled"}</Text>
          <Text class="text-sm text-muted-foreground">{whenLabel(s().trigger, props.text)}</Text>
        </View>
        <View
          role="switch"
          testID={`schedule-toggle-${s().id}`}
          onPress={() => !props.busy && props.onToggle()}
          class={`mt-0.5 h-7 w-12 justify-center rounded-full px-0.5 ${s().enabled ? "items-end bg-primary" : "items-start bg-white/15"} ${props.busy ? "opacity-50" : ""}`}
        >
          <View class="h-6 w-6 rounded-full bg-white" />
        </View>
        <Dropdown
          open={open()}
          onOpenChange={(o) => open.set(o)}
          title={s().name || "Schedule"}
          items={items()}
          trigger={<MoreButton testID={`schedule-more-${s().id}`} class="bg-transparent" />}
        />
      </View>

      <View class="flex-row flex-wrap gap-1.5">
        <Pill label={s().enabled ? "On" : "Off"} tone={s().enabled ? "success" : "muted"} />
        <Pill label={statusLabel(s().lastRunStatus)} tone={statusTone(s().lastRunStatus)} />
        <If when={s().consecutiveFailures > 1}>
          <Pill label={`Failed ${s().consecutiveFailures} times in a row`} tone="danger" />
        </If>
      </View>

      <Text class="text-xs text-muted-foreground">
        {[
          s().enabled && s().nextFireTime ? `Next: ${whenOf(s().nextFireTime)}` : s().trigger.type === "event" && s().enabled ? "Runs when it happens" : "",
          s().lastRunAt ? `Last ran ${ago(s().lastRunAt)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>

      <If when={s().description}>{(d) => <Text class="text-sm text-card-foreground">{d()}</Text>}</If>

      <If when={steps().length > 0}>
        <View class="gap-0.5">
          <Each of={steps()} key={(_l, i) => i}>
            {(l) => <Text class="text-xs text-muted-foreground">{`• ${l().label}`}</Text>}
          </Each>
        </View>
      </If>

      <If when={s().lastRunStatus !== "Succeeded" && s().lastError}>{(e) => <Text class="text-xs text-destructive">{e()}</Text>}</If>
      <If when={s().turnedOff}>
        {(n) => <Text class="text-xs text-warning">{n().message || "AMP turned this schedule off. Turn it back on once the cause is fixed."}</Text>}
      </If>
      <If when={s().refusal}>{(n) => <Text class="text-xs text-warning">{n().message || "AMP skipped a step on the last run."}</Text>}</If>
    </View>
  );
}

/** Adding or changing a schedule: its name, when it runs, and (for a straight list of tasks) what it does. */
export function ScheduleEditScreen(props: { serverId: string; id: string; title: string; scheduleId?: string }) {
  const client = () => clientFor(props.serverId);
  const text = signal<Record<string, string>>({});
  const catalog = signal<Catalog | null>(null);
  const original = signal<Schedule | null>(null);
  const loaded = signal(false);
  const error = signal<string | null>(null);
  const saving = signal(false);

  const name = signal("");
  const description = signal("");
  const enabled = signal(true);
  const form = signal<TriggerForm>(defaultForm());
  const tasks = signal<TaskStep[]>([]);
  const preview = signal<string[] | null>(null);

  const fail = failer(props.serverId, (m) => error.set(m));
  panelText(client()).then((t) => text.set(t));

  (async () => {
    try {
      const [cat, existing] = await Promise.all([
        getCatalog(client(), props.id),
        props.scheduleId ? getSchedule(client(), props.id, props.scheduleId) : Promise.resolve(null),
      ]);
      catalog.set(cat);
      const firstEvent = cat.triggers[0]?.id ?? "";
      if (existing) {
        original.set(existing);
        name.set(existing.name);
        description.set(existing.description);
        enabled.set(existing.enabled);
        form.set(formOf(existing.trigger, firstEvent));
        if (isStraight(existing.steps)) tasks.set(existing.steps.map((t) => ({ ...t, parameters: { ...t.parameters } })));
      } else {
        form.set(defaultForm(firstEvent));
        tasks.set([newTask(cat.tasks[0])]);
      }
      loaded.set(true);
    } catch (e) {
      await fail(e);
    }
  })();

  /** A schedule with branches keeps its steps exactly as they came. */
  const straight = () => !original() || isStraight(original()!.steps);
  const patch = (p: Partial<TriggerForm>) => form.set({ ...form(), ...p });

  // When it would fire next, a moment after the trigger stops changing.
  effect(() => {
    if (!loaded()) return;
    const built = triggerOf(form());
    if ("error" in built || built.trigger.type === "event") return preview.set(null);
    const trigger = built.trigger;
    const t = setTimeout(() => {
      previewFirings(client(), props.id, trigger)
        .then((times) => preview.set(times))
        .catch(() => preview.set(null));
    }, 400);
    cleanup(() => clearTimeout(t));
  });

  const setTask = (i: number, next: TaskStep) => tasks.set(tasks().map((t, j) => (j === i ? next : t)));
  const move = (i: number, by: number) => {
    const list = [...tasks()];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    tasks.set(list);
  };

  const save = async () => {
    if (saving()) return;
    if (!name().trim()) return error.set("Give it a name.");
    if (name().trim().length > NAME_MAX) return error.set(`Keep the name to ${NAME_MAX} characters.`);
    if (description().trim().length > DESCRIPTION_MAX) return error.set(`Keep the description to ${DESCRIPTION_MAX} characters.`);
    const built = triggerOf(form());
    if ("error" in built) return error.set(built.error);
    const cat = catalog();
    if (straight()) {
      if (tasks().length === 0) return error.set("Add at least one action.");
      for (const t of tasks()) {
        const d = cat?.tasks.find((x) => x.id === t.taskType);
        const missing = d?.parameters.find((p) => p.required && !(t.parameters[p.name] ?? "").trim());
        if (missing) return error.set(`${taskName(t.taskType, text())}: fill in ${paramLabel(missing.name, text()).toLowerCase()}.`);
        const bad = d?.parameters.find((p) => p.inputType === "number" && (t.parameters[p.name] ?? "").trim() && !/^\d+$/.test(t.parameters[p.name].trim()));
        if (bad) return error.set(`${taskName(t.taskType, text())}: ${paramLabel(bad.name, text()).toLowerCase()} is a whole number.`);
      }
    }
    error.set(null);
    saving.set(true);
    try {
      const body = {
        name: name(),
        description: description(),
        trigger: built.trigger,
        steps: straight() ? tasks() : original()!.steps,
        timeout: original()?.timeout ?? null,
        enabled: enabled(),
      };
      if (props.scheduleId) await updateSchedule(client(), props.id, props.scheduleId, body);
      else await createSchedule(client(), props.id, body);
      savedCount.set(savedCount() + 1);
      nav.pop();
    } catch (e) {
      await fail(e);
    } finally {
      saving.set(false);
    }
  };

  const taskOptions = () =>
    (catalog()?.tasks ?? []).map((t) => ({ value: t.id, label: `${taskCategory(t.category, text())} · ${taskName(t.id, text())}` }));
  const eventOptions = () =>
    (catalog()?.triggers ?? []).map((t) => ({ value: t.id, label: eventName(t.id, text()), hint: eventDescription(t.id, text()) || undefined }));

  return (
    <AppPage title={props.scheduleId ? "Edit schedule" : "New schedule"} subtitle={props.title}>
      <Screen>
        <View class="w-full max-w-3xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If when={!loaded() && !error()}>
            <Text class="text-muted-foreground">Loading…</Text>
          </If>

          <If when={loaded()}>
            <Section title="About">
              <Field label="Name" value={name()} onChange={(v) => name.set(v)} placeholder="e.g. Nightly restart" testID="schedule-name" />
              <Field label="Description (optional)" value={description()} onChange={(v) => description.set(v)} placeholder="What it's for" />
              <Checkbox label="On (it runs when due)" testID="schedule-enabled" checked={enabled()} onChange={(v) => enabled.set(v)} />
            </Section>

            <Section title="When">
              <Select title="Runs" value={form().mode} options={MODES} onChange={(v) => patch({ mode: v as Mode })} testID="schedule-mode" />
              <If when={form().mode === "interval"}>
                <Field label="Every how many minutes" value={form().minutes} onChange={(v) => patch({ minutes: v })} testID="schedule-minutes" />
              </If>
              <If when={form().mode === "everyHours"}>
                <Field label="Every how many hours" value={form().hours} onChange={(v) => patch({ hours: v })} testID="schedule-hours" />
              </If>
              <If when={form().mode === "hourly"}>
                <Field label="At minute" value={form().minute} onChange={(v) => patch({ minute: v })} hint="0 to 59 past each hour." testID="schedule-minute" />
              </If>
              <If when={form().mode === "weekly"}>
                <View class="gap-1.5">
                  <Text class="text-sm font-semibold text-foreground">On</Text>
                  <Select
                    title="Day"
                    value={String(form().weekday)}
                    options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                    onChange={(v) => patch({ weekday: Number(v) })}
                    testID="schedule-weekday"
                  />
                </View>
              </If>
              <If when={form().mode === "daily" || form().mode === "weekly"}>
                <Field label="At (24-hour, HH:MM)" value={form().time} onChange={(v) => patch({ time: v })} placeholder="04:00" testID="schedule-time" />
              </If>
              <If when={form().mode === "cron"}>
                <Field
                  label="Cron expression"
                  value={form().cron}
                  onChange={(v) => patch({ cron: v })}
                  placeholder="0 4 * * MON"
                  hint="Minute, hour, day of month, month, day of week (a 6th field in front adds seconds)."
                  testID="schedule-cron"
                />
              </If>
              <If when={form().mode === "event"}>
                <View class="gap-1.5">
                  <Text class="text-sm font-semibold text-foreground">When</Text>
                  <Select title="Event" value={form().eventType} options={eventOptions()} onChange={(v) => patch({ eventType: v })} testID="schedule-event" />
                  <If when={eventDescription(form().eventType, text())}>{(d) => <Text class="text-xs text-muted-foreground">{d()}</Text>}</If>
                </View>
              </If>
              <If when={form().mode === "hourly" || form().mode === "daily" || form().mode === "weekly" || form().mode === "cron"}>
                <Field
                  label="Time zone"
                  value={form().timeZoneId}
                  onChange={(v) => patch({ timeZoneId: v })}
                  placeholder="UTC"
                  hint="An IANA name such as Australia/Brisbane or Europe/London."
                  testID="schedule-tz"
                />
              </If>
              <If when={form().mode !== "event"}>
                <View testID="schedule-preview" class="gap-0.5">
                  <Text class="text-sm font-semibold text-foreground">Next times</Text>
                  <If
                    when={preview()}
                    else={<Text class="text-xs text-muted-foreground">{"error" in triggerOf(form()) ? (triggerOf(form()) as { error: string }).error : "…"}</Text>}
                  >
                    {(times) => (
                      <If when={times().length > 0} else={<Text class="text-xs text-warning">It would never run. Check the settings above.</Text>}>
                        <Each of={times()} key={(t: string) => t}>
                          {(t) => <Text class="text-xs text-muted-foreground">{whenOf(t())}</Text>}
                        </Each>
                      </If>
                    )}
                  </If>
                </View>
              </If>
            </Section>

            <Section title="Do the following">
              <If
                when={straight()}
                else={
                  <View class="gap-2">
                    <Text class="text-sm text-warning">
                      This schedule has conditions or follow-up steps, which the app shows but doesn't edit. Saving here keeps them exactly as they are; change them in the web panel.
                    </Text>
                    <Each of={outline(original()?.steps ?? [], text())} key={(_l, i) => i}>
                      {(l) => (
                        <Text class="text-sm text-card-foreground" style={{ paddingLeft: l().depth * 14 }}>
                          {`${l().depth ? "↳ " : "• "}${l().label}`}
                        </Text>
                      )}
                    </Each>
                  </View>
                }
              >
                <Text class="text-xs text-muted-foreground">They run in order, top to bottom.</Text>
                <Each of={tasks()} key={(t: TaskStep) => t.id}>
                  {(t, i) => (
                    <TaskEditor
                      step={t()}
                      index={i()}
                      count={tasks().length}
                      catalog={catalog()}
                      options={taskOptions()}
                      text={text()}
                      withheld={(original()?.withheld ?? []).filter((w) => w.stepId === t().id).map((w) => w.parameter)}
                      onChange={(next) => setTask(i(), next)}
                      onMove={(by) => move(i(), by)}
                      onRemove={() => tasks.set(tasks().filter((_x, j) => j !== i()))}
                    />
                  )}
                </Each>
                <View class="flex-row">
                  <SecondaryButton title="Add an action" testID="task-add" onPress={() => tasks.set([...tasks(), newTask(catalog()?.tasks[0])])} />
                </View>
              </If>
            </Section>
          </If>

          <If when={error()}>{(m) => <ErrorText message={m()} />}</If>

          <If when={loaded()}>
            <View class="flex-row gap-3">
              <SecondaryButton title="Cancel" onPress={() => nav.pop()} />
              <SecondaryButton title={saving() ? "Saving…" : "Save"} tone="success" testID="schedule-save" disabled={saving()} onPress={save} />
            </View>
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

function TaskEditor(props: {
  step: TaskStep;
  index: number;
  count: number;
  catalog: Catalog | null;
  options: { value: string; label: string }[];
  text: Record<string, string>;
  withheld: string[];
  onChange: (next: TaskStep) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const d = () => props.catalog?.tasks.find((t) => t.id === props.step.taskType);
  const n = () => props.index + 1;
  const setParam = (name: string, value: string) => props.onChange({ ...props.step, parameters: { ...props.step.parameters, [name]: value } });

  return (
    <View testID={`task-${n()}`} class="gap-2 rounded-lg border border-white/10 bg-background/40 p-3">
      <View class="flex-row items-center gap-2">
        <Text class="text-sm font-semibold text-foreground">{`${n()}.`}</Text>
        <View class="flex-1">
          <Select
            title="Action"
            value={props.step.taskType}
            options={props.options}
            // A different action starts with its own parameters.
            onChange={(v) => v !== props.step.taskType && props.onChange({ ...props.step, taskType: v, parameters: {}, await: true, failureOverride: null })}
            testID={`task-type-${n()}`}
          />
        </View>
      </View>
      <If when={taskNote(props.step.taskType, props.text)}>{(note) => <Text class="text-xs text-muted-foreground">{note()}</Text>}</If>
      <Each of={d()?.parameters.filter((p) => p.inputType.toLowerCase() !== "hidden") ?? []} key={(p) => p.name}>
        {(p) => (
          <Field
            label={`${paramLabel(p().name, props.text)}${p().required ? "" : " (optional)"}`}
            value={props.step.parameters[p().name] ?? ""}
            onChange={(v) => setParam(p().name, v)}
            keyboardType={p().name === "url" ? "url" : "default"}
            hint={props.withheld.includes(p().name) ? "Hidden from your account; left as it is unless you replace it." : undefined}
            testID={`task-${n()}-${p().name}`}
          />
        )}
      </Each>
      <If when={d()?.isAsync}>
        <Checkbox
          label="Wait for it to finish before the next action"
          checked={props.step.await}
          onChange={(v) => props.onChange({ ...props.step, await: v })}
        />
      </If>
      <View class="flex-row flex-wrap gap-2">
        <SmallButton label="↑ Up" disabled={props.index === 0} onPress={() => props.onMove(-1)} />
        <SmallButton label="↓ Down" disabled={props.index === props.count - 1} onPress={() => props.onMove(1)} />
        <SmallButton label="Remove" danger testID={`task-remove-${n()}`} onPress={props.onRemove} />
      </View>
    </View>
  );
}

function SmallButton(props: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; testID?: string }) {
  return (
    <Text
      role="button"
      testID={props.testID}
      onPress={() => !props.disabled && props.onPress()}
      class={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
        props.danger ? "border-destructive/30 text-destructive" : "border-white/10 text-muted-foreground"
      } ${props.disabled ? "opacity-40" : ""}`}
    >
      {props.label}
    </Text>
  );
}

/** A schedule's latest runs, each with what every step did. */
export function ScheduleRunsScreen(props: { serverId: string; id: string; scheduleId: string; scheduleName: string }) {
  const client = () => clientFor(props.serverId);
  const runs = signal<Run[] | null>(null);
  const names = signal<Record<string, string>>({});
  const text = signal<Record<string, string>>({});
  const error = signal<string | null>(null);
  const refreshing = signal(false);
  const fail = failer(props.serverId, (m) => error.set(m));

  const load = async () => {
    try {
      const [list, schedule, t] = await Promise.all([
        scheduleHistory(client(), props.id, props.scheduleId),
        getSchedule(client(), props.id, props.scheduleId).catch(() => null),
        panelText(client()),
      ]);
      text.set(t);
      const map: Record<string, string> = {};
      for (const l of outline(schedule?.steps ?? [], t)) if (l.id) map[l.id] = l.label;
      names.set(map);
      runs.set(list);
      error.set(null);
    } catch (e) {
      await fail(e);
    }
  };

  const onTop = () => {
    const top = nav.routes().at(-1);
    return top?.name === "scheduleRuns" && top.scheduleId === props.scheduleId;
  };
  poll(load, IDLE_MS, onTop);

  return (
    <AppPage title="Run history" subtitle={props.scheduleName}>
      <Screen
        refreshing={refreshing()}
        onRefresh={async () => {
          refreshing.set(true);
          await load();
          refreshing.set(false);
        }}
      >
        <View class="w-full max-w-3xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
          <If when={!error() && runs() === null}>
            <Text class="text-muted-foreground">Loading…</Text>
          </If>
          <If when={runs()?.length === 0}>
            <Text class="text-sm text-muted-foreground">It hasn't run yet.</Text>
          </If>
          <Each of={runs() ?? []} key={(r: Run) => r.id}>
            {(r, i) => <RunCard run={r()} names={names()} text={text()} startOpen={i() === 0} />}
          </Each>
        </View>
      </Screen>
    </AppPage>
  );
}

function RunCard(props: { run: Run; names: Record<string, string>; text: Record<string, string>; startOpen: boolean }) {
  const open = signal(props.startOpen);
  const r = () => props.run;
  return (
    <View testID={`run-${r().id}`} class="gap-2 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
      <View role="button" onPress={() => open.set(!open())} class="flex-row items-center gap-2">
        <View class="flex-1 gap-1">
          <Text class="text-base font-semibold text-card-foreground">{whenOf(r().startedAt ?? r().queuedAt) || "Run"}</Text>
          <Text class="text-xs text-muted-foreground">
            {[took(r()), r().attemptNumber > 1 ? `attempt ${r().attemptNumber}` : ""].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Pill label={statusLabel(r().status)} tone={statusTone(r().status)} />
        <Text class="text-sm text-muted-foreground">{open() ? "▴" : "▾"}</Text>
      </View>
      <If when={r().errorMessage}>{(e) => <Text class="text-xs text-destructive">{e()}</Text>}</If>
      <If when={open()}>
        <If when={r().stepOutcomes.length > 0} else={<Text class="text-xs text-muted-foreground">No step details were recorded for this run.</Text>}>
          <View class="gap-1.5 border-t border-white/5 pt-2">
            <Each of={r().stepOutcomes} key={(_o, i) => i}>
              {(o) => (
                <View class="gap-0.5">
                  <View class="flex-row items-baseline gap-2">
                    <Text
                      class={`text-xs font-semibold ${
                        o().status === "Succeeded" ? "text-success" : o().status === "Failed" ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {o().status === "Succeeded" ? "✓" : o().status === "Failed" ? "✕" : "–"}
                    </Text>
                    <Text class="flex-1 text-sm text-card-foreground">
                      {`${props.names[o().stepId] ?? o().stepId}${o().lane.startsWith("bg:") ? " (background)" : ""}`}
                    </Text>
                    <Text class="text-xs text-muted-foreground">{statusLabel(o().status)}</Text>
                  </View>
                  <If when={o().detail}>{(d) => <Text class="pl-5 text-xs text-muted-foreground">{d()}</Text>}</If>
                </View>
              )}
            </Each>
          </View>
        </If>
      </If>
    </View>
  );
}
