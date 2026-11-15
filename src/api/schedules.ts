import type { AmpClient } from "./client";

/**
 * An instance's schedules (the web panel calls them triggers): WHEN (a cron time, an interval
 * or an event) plus WHAT (a tree of steps: tasks, conditions, switches, stops). AMP runs them
 * itself; each firing leaves a run record with an outcome per step.
 *
 * The app edits the common shape, a straight list of tasks. Anything with branches is shown
 * and can be renamed, retimed, run, turned on or off and deleted, but its steps are sent back
 * exactly as they came, never rebuilt. Wording comes from the panel's own English file.
 * Capabilities: ScheduleRead, ScheduleWrite.
 */

export type Trigger =
  | { type: "cron"; expression: string; timeZoneId?: string }
  | { type: "interval"; interval: string; anchor?: string }
  | { type: "event"; eventType: string };

export interface TaskStep {
  type: "task";
  id: string;
  taskType: string;
  parameters: Record<string, string>;
  await: boolean;
  onSuccess: Step[];
  onFailure: Step[];
  failureOverride: "Continue" | "Abort" | null;
}

/** A step of any kind. Kinds the app doesn't edit are kept whole, as they came. */
export type Step = TaskStep | ({ type: "if" | "switch" | "stop"; id?: string } & Record<string, unknown>);

export interface ScheduleNotice {
  code: string;
  message: string;
}

export interface Schedule {
  id: string;
  name: string;
  description: string;
  trigger: Trigger;
  steps: Step[];
  /** The per-run time budget as AMP stores it ("00:30:00"), kept as it is when saving. */
  timeout: string | null;
  enabled: boolean;
  nextFireTime: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** Why AMP turned it off (it stays off until someone turns it back on). */
  turnedOff: ScheduleNotice | null;
  /** A step AMP refused and skipped last time (a webhook to a private address, say). */
  refusal: ScheduleNotice | null;
  /** Webhook addresses and bodies this account may not read. */
  withheld: { stepId: string; parameter: string }[];
}

export interface TaskParam {
  name: string;
  inputType: string;
  required: boolean;
}

export interface TaskDescriptor {
  id: string;
  category: string;
  isAsync: boolean;
  defaultFailure: string;
  parameters: TaskParam[];
}

export interface TriggerDescriptor {
  id: string;
  category: string;
  /** For an event the template declares: the template's locale key (unreadable here). */
  label: string;
}

export interface Catalog {
  triggers: TriggerDescriptor[];
  tasks: TaskDescriptor[];
}

export interface StepOutcome {
  stepId: string;
  lane: string;
  status: string;
  detail: string | null;
  duration: string | null;
}

export interface Run {
  id: string;
  status: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attemptNumber: number;
  errorMessage: string | null;
  stepOutcomes: StepOutcome[];
  duration: string | null;
}

/** The app's own caps; AMP holds the real limits and says so if one is crossed. */
export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 500;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function tidyNotice(raw: unknown): ScheduleNotice | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const message = str(n.message);
  const code = str(n.code);
  return message || code ? { code, message } : null;
}

function tidyTrigger(raw: unknown): Trigger {
  const t = obj(raw);
  if (t.type === "interval") return { type: "interval", interval: str(t.interval, "01:00:00"), ...(typeof t.anchor === "string" ? { anchor: t.anchor } : {}) };
  if (t.type === "event") return { type: "event", eventType: str(t.eventType) };
  return { type: "cron", expression: str(t.expression, "0 4 * * *"), timeZoneId: str(t.timeZoneId, "UTC") };
}

function tidyTask(s: Record<string, unknown>): TaskStep {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(s.parameters))) if (typeof v === "string") params[k] = v;
  return {
    ...s,
    type: "task",
    id: str(s.id),
    taskType: str(s.taskType),
    parameters: params,
    await: s.await !== false,
    onSuccess: tidySteps(s.onSuccess),
    onFailure: tidySteps(s.onFailure),
    failureOverride: s.failureOverride === "Continue" || s.failureOverride === "Abort" ? s.failureOverride : null,
  };
}

function tidySteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === "object" && typeof (s as { type?: unknown }).type === "string")
    .map((s) => ((s as { type: string }).type === "task" ? tidyTask(s as Record<string, unknown>) : (s as Step)));
}

function tidySchedule(raw: unknown): Schedule | null {
  const r = obj(raw);
  const d = obj(r.definition);
  const st = obj(r.status);
  if (typeof d.id !== "string") return null;
  return {
    id: d.id,
    name: str(d.name),
    description: str(d.description),
    trigger: tidyTrigger(d.trigger),
    steps: tidySteps(d.steps),
    timeout: strOrNull(d.timeout),
    enabled: d.enabled === true,
    nextFireTime: strOrNull(r.nextFireTime),
    lastRunAt: strOrNull(st.lastRunAt),
    lastRunStatus: strOrNull(st.lastRunStatus),
    lastError: strOrNull(st.lastError),
    consecutiveFailures: num(st.consecutiveFailures),
    turnedOff: tidyNotice(st.turnedOff),
    refusal: tidyNotice(obj(st.refusal).notice),
    withheld: Array.isArray(r.withheld)
      ? r.withheld
          .filter((w): w is { stepId: string; parameter: string } => typeof w?.stepId === "string" && typeof w?.parameter === "string")
          .map((w) => ({ stepId: w.stepId, parameter: w.parameter }))
      : [],
  };
}

function tidyRun(raw: unknown): Run | null {
  const r = obj(raw);
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    status: str(r.status),
    queuedAt: str(r.queuedAt),
    startedAt: strOrNull(r.startedAt),
    completedAt: strOrNull(r.completedAt),
    attemptNumber: num(r.attemptNumber),
    errorMessage: strOrNull(r.errorMessage),
    duration: strOrNull(r.duration),
    stepOutcomes: (Array.isArray(r.stepOutcomes) ? r.stepOutcomes : []).map((o) => {
      const x = obj(o);
      return { stepId: str(x.stepId), lane: str(x.lane, "main"), status: str(x.status), detail: strOrNull(x.detail), duration: strOrNull(x.duration) };
    }),
  };
}

const base = (shardId: string) => `/api/shards/${encodeURIComponent(shardId)}/schedules`;
const one = (shardId: string, id: string) => `${base(shardId)}/${encodeURIComponent(id)}`;

export async function listSchedules(c: AmpClient, shardId: string): Promise<Schedule[]> {
  const list = await c.request<unknown>(base(shardId));
  return (Array.isArray(list) ? list : []).map(tidySchedule).filter((s): s is Schedule => !!s);
}

export async function getSchedule(c: AmpClient, shardId: string, id: string): Promise<Schedule | null> {
  return tidySchedule(await c.request<unknown>(one(shardId, id)));
}

export async function getCatalog(c: AmpClient, shardId: string): Promise<Catalog> {
  const g = obj(await c.request<unknown>(`${base(shardId)}/catalog`));
  return {
    triggers: (Array.isArray(g.triggers) ? g.triggers : [])
      .map(obj)
      .filter((t) => typeof t.id === "string")
      .map((t) => ({ id: t.id as string, category: str(t.category), label: str(t.label) })),
    tasks: (Array.isArray(g.tasks) ? g.tasks : [])
      .map(obj)
      .filter((t) => typeof t.id === "string")
      .map((t) => ({
        id: t.id as string,
        category: str(t.category),
        isAsync: t.isAsync === true,
        defaultFailure: str(t.defaultFailure),
        parameters: (Array.isArray(t.parameters) ? t.parameters : [])
          .map(obj)
          .filter((p) => typeof p.name === "string")
          .map((p) => ({ name: p.name as string, inputType: str(p.inputType, "text"), required: p.required === true })),
      })),
  };
}

export interface ScheduleBody {
  name: string;
  description: string;
  trigger: Trigger;
  steps: Step[];
  timeout: string | null;
  enabled: boolean;
}

const bodyOf = (s: ScheduleBody) => ({
  name: s.name.trim(),
  description: s.description.trim() || null,
  trigger: s.trigger,
  steps: s.steps,
  timeout: s.timeout,
  enabled: s.enabled,
});

export async function createSchedule(c: AmpClient, shardId: string, s: ScheduleBody): Promise<Schedule | null> {
  return tidySchedule(await c.request<unknown>(base(shardId), { method: "POST", body: bodyOf(s) }));
}

export async function updateSchedule(c: AmpClient, shardId: string, id: string, s: ScheduleBody): Promise<Schedule | null> {
  return tidySchedule(await c.request<unknown>(one(shardId, id), { method: "PUT", body: bodyOf(s) }));
}

export async function deleteSchedule(c: AmpClient, shardId: string, id: string): Promise<void> {
  await c.request(one(shardId, id), { method: "DELETE" });
}

export async function setScheduleEnabled(c: AmpClient, shardId: string, id: string, enabled: boolean): Promise<void> {
  await c.request(`${one(shardId, id)}/enabled`, { method: "POST", body: { enabled } });
}

export async function runSchedule(c: AmpClient, shardId: string, id: string): Promise<void> {
  await c.request(`${one(shardId, id)}/run`, { method: "POST", body: {} });
}

/** The latest runs, newest first. */
export async function scheduleHistory(c: AmpClient, shardId: string, id: string, limit = 25): Promise<Run[]> {
  const list = await c.request<unknown>(`${one(shardId, id)}/history?limit=${limit}`);
  return (Array.isArray(list) ? list : [])
    .map(tidyRun)
    .filter((r): r is Run => !!r)
    .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : a.queuedAt > b.queuedAt ? -1 : 0));
}

/** When a trigger would fire next (AMP gives five), without saving anything. */
export async function previewFirings(c: AmpClient, shardId: string, trigger: Trigger): Promise<string[]> {
  const list = await c.request<unknown>(`${base(shardId)}/preview-firings`, { method: "POST", body: { trigger } });
  return (Array.isArray(list) ? list : []).filter((t): t is string => typeof t === "string");
}

// The trigger as the editor shows it: the web panel's own presets over cron and intervals.

export type Mode = "interval" | "everyHours" | "hourly" | "daily" | "weekly" | "cron" | "event";

export interface TriggerForm {
  mode: Mode;
  minutes: string;
  hours: string;
  minute: string;
  /** "HH:MM", 24-hour. */
  time: string;
  weekday: number;
  cron: string;
  timeZoneId: string;
  eventType: string;
}

export const MODES: { value: Mode; label: string }[] = [
  { value: "interval", label: "Every few minutes" },
  { value: "everyHours", label: "Every few hours" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "cron", label: "Custom (cron)" },
  { value: "event", label: "When something happens" },
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The phone's time zone, or UTC when it can't be told. */
export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultForm(eventType = ""): TriggerForm {
  return { mode: "daily", minutes: "30", hours: "6", minute: "0", time: "04:00", weekday: 1, cron: "0 4 * * *", timeZoneId: localTimeZone(), eventType };
}

/** "1.02:30:15" → seconds. */
export function secondsOf(span: string): number {
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})/.exec(span);
  if (!m) return 0;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2])) * 60 + Number(m[3])) * 60 + Number(m[4]);
}

/** "1.02:30:00" → minutes, rounded (an interval under a minute counts as one). */
export function minutesOf(span: string): number {
  const secs = secondsOf(span);
  return secs > 0 ? Math.max(1, Math.round(secs / 60)) : 0;
}

/** Minutes → "1.02:30:00". */
export function spanOf(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const hm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  return d > 0 ? `${d}.${hm}` : hm;
}

const pad = (s: string) => s.padStart(2, "0");

export function formOf(t: Trigger, fallbackEvent = ""): TriggerForm {
  const f = defaultForm(fallbackEvent);
  if (t.type === "interval") {
    const secs = secondsOf(t.interval);
    // Seconds the form can't show: kept as a custom interval (the stored value is sent back unchanged).
    if (secs % 60 !== 0) return { ...f, mode: "interval", minutes: String(minutesOf(t.interval) || 1) };
    const mins = secs / 60;
    return mins >= 60 && mins % 60 === 0 ? { ...f, mode: "everyHours", hours: String(mins / 60) } : { ...f, mode: "interval", minutes: String(mins || 30) };
  }
  if (t.type === "event") return { ...f, mode: "event", eventType: t.eventType };
  const tz = t.timeZoneId || "UTC";
  const e = t.expression.trim();
  let m = /^(\d{1,2}) \* \* \* \*$/.exec(e);
  if (m) return { ...f, mode: "hourly", minute: m[1], timeZoneId: tz, cron: e };
  m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(e);
  if (m) return { ...f, mode: "daily", time: `${pad(m[2])}:${pad(m[1])}`, timeZoneId: tz, cron: e };
  m = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/.exec(e);
  if (m) return { ...f, mode: "weekly", time: `${pad(m[2])}:${pad(m[1])}`, weekday: Number(m[3]) % 7, timeZoneId: tz, cron: e };
  return { ...f, mode: "cron", cron: e, timeZoneId: tz };
}

const whole = (v: string, min: number, max: number): number | null => {
  const t = v.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** The trigger a form describes, or what's wrong with it. */
export function triggerOf(f: TriggerForm): { trigger: Trigger } | { error: string } {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(f.time.trim());
  const hm = clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 ? [Number(clock[1]), Number(clock[2])] : null;
  const tz = f.timeZoneId.trim() || "UTC";
  switch (f.mode) {
    case "interval": {
      const n = whole(f.minutes, 1, 100_000);
      return n === null ? { error: "Use a whole number of minutes, 1 or more." } : { trigger: { type: "interval", interval: spanOf(n) } };
    }
    case "everyHours": {
      const n = whole(f.hours, 1, 10_000);
      return n === null ? { error: "Use a whole number of hours, 1 or more." } : { trigger: { type: "interval", interval: spanOf(n * 60) } };
    }
    case "hourly": {
      const n = whole(f.minute, 0, 59);
      return n === null ? { error: "The minute is a number from 0 to 59." } : { trigger: { type: "cron", expression: `${n} * * * *`, timeZoneId: tz } };
    }
    case "daily":
      return hm ? { trigger: { type: "cron", expression: `${hm[1]} ${hm[0]} * * *`, timeZoneId: tz } } : { error: "Write the time as HH:MM, e.g. 04:30." };
    case "weekly":
      return hm
        ? { trigger: { type: "cron", expression: `${hm[1]} ${hm[0]} * * ${f.weekday}`, timeZoneId: tz } }
        : { error: "Write the time as HH:MM, e.g. 04:30." };
    case "cron":
      return f.cron.trim() ? { trigger: { type: "cron", expression: f.cron.trim(), timeZoneId: tz } } : { error: "Enter a cron expression." };
    case "event":
      return f.eventType ? { trigger: { type: "event", eventType: f.eventType } } : { error: "Choose the event." };
  }
}

// Words, from the panel's own English file where it has them.

type Text = Record<string, string>;
const key = (id: string) => id.replace(/\./g, "_");

export function taskName(id: string, text: Text): string {
  return text[`schedule.task.${key(id)}.name`] ?? id;
}

export function taskNote(id: string, text: Text): string | null {
  return text[`schedule.task.${key(id)}.note`] ?? null;
}

export function taskCategory(category: string, text: Text): string {
  return text[`schedule.taskCategory.${category}`] ?? category;
}

export function paramLabel(name: string, text: Text): string {
  return text[`schedule.taskParam.${name}`] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

export function eventName(id: string, text: Text): string {
  const own = text[`schedule.trigger.${key(id)}.name`];
  if (own) return own;
  // A template's own event: its wording lives in the template, so tidy the id instead.
  const last = id.startsWith("template.") ? id.slice("template.".length) : id;
  return last.replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export function eventDescription(id: string, text: Text): string {
  return text[`schedule.trigger.${key(id)}.desc`] ?? "";
}

const STATUS: Record<string, string> = {
  Queued: "Queued",
  Running: "Running",
  Succeeded: "Succeeded",
  CompletedWithErrors: "Completed with errors",
  Failed: "Failed",
  TimedOut: "Timed out",
  Skipped: "Skipped",
  NotReached: "Not reached",
};

export const statusLabel = (s: string | null) => (s ? (Object.prototype.hasOwnProperty.call(STATUS, s) ? STATUS[s] : s) : "Never ran");

export function statusTone(s: string | null): "success" | "warning" | "danger" | "muted" {
  if (s === "Succeeded") return "success";
  if (s === "Failed" || s === "TimedOut") return "danger";
  if (s === "CompletedWithErrors" || s === "Running" || s === "Queued") return "warning";
  return "muted";
}

/** "Every 30 minutes", "Daily at 04:00 (Australia/Brisbane)", "When: A user connects". */
export function whenLabel(t: Trigger, text: Text): string {
  if (t.type === "event") return `When: ${eventName(t.eventType, text)}`;
  if (t.type === "interval" && secondsOf(t.interval) % 60 !== 0) {
    const secs = secondsOf(t.interval);
    return secs < 60 ? `Every ${secs} second${secs === 1 ? "" : "s"}` : `Every ${Math.floor(secs / 60)} min ${secs % 60} s`;
  }
  const f = formOf(t);
  const tz = f.timeZoneId;
  switch (f.mode) {
    case "interval":
      return `Every ${f.minutes} minute${f.minutes === "1" ? "" : "s"}`;
    case "everyHours":
      return `Every ${f.hours} hour${f.hours === "1" ? "" : "s"}`;
    case "hourly":
      return `Hourly at :${pad(f.minute)} (${tz})`;
    case "daily":
      return `Daily at ${f.time} (${tz})`;
    case "weekly":
      return `${WEEKDAYS[f.weekday]}s at ${f.time} (${tz})`;
    default:
      return `Cron ${f.cron} (${tz})`;
  }
}

/** True when the steps are a straight list of tasks with nothing hanging off them: what the app edits. */
export function isStraight(steps: Step[]): steps is TaskStep[] {
  return steps.every((s) => s.type === "task" && (s as TaskStep).onSuccess.length === 0 && (s as TaskStep).onFailure.length === 0);
}

export interface OutlineLine {
  id: string;
  depth: number;
  label: string;
}

/** The step tree as indented lines, for reading (and for naming steps in run history). */
export function outline(steps: Step[], text: Text, depth = 0, out: OutlineLine[] = []): OutlineLine[] {
  const ops = (o: unknown) => text[`schedule.op.${String(o)}`] ?? String(o ?? "");
  for (const s of steps) {
    const id = typeof s.id === "string" ? s.id : "";
    if (s.type === "task") {
      const t = s as TaskStep;
      const detail = Object.values(t.parameters).filter(Boolean).join(", ");
      out.push({ id, depth, label: `${taskName(t.taskType, text)}${detail ? `: ${detail}` : ""}${t.await ? "" : " (in the background)"}` });
      if (t.onSuccess.length) {
        out.push({ id: "", depth: depth + 1, label: "If it succeeds" });
        outline(t.onSuccess, text, depth + 2, out);
      }
      if (t.onFailure.length) {
        out.push({ id: "", depth: depth + 1, label: "If it fails" });
        outline(t.onFailure, text, depth + 2, out);
      }
    } else if (s.type === "if") {
      const conds = (Array.isArray(s.conditions) ? s.conditions : []).map((c) => {
        const x = obj(c);
        return `${str(x.value)} ${ops(x.operator)} ${str(x.comparand)}`.trim();
      });
      out.push({ id, depth, label: `If ${conds.join(s.match === "Any" ? " or " : " and ") || "…"}` });
      outline(tidySteps(s.then), text, depth + 1, out);
      const otherwise = tidySteps(s.else);
      if (otherwise.length) {
        out.push({ id: "", depth, label: "Otherwise" });
        outline(otherwise, text, depth + 1, out);
      }
    } else if (s.type === "switch") {
      out.push({ id, depth, label: `Switch on ${str(s.value) || "a value"}` });
      for (const c of Array.isArray(s.cases) ? s.cases : []) {
        const x = obj(c);
        out.push({ id: "", depth: depth + 1, label: `When it ${ops(x.operator)} ${str(x.comparand)}`.trim() });
        outline(tidySteps(x.steps), text, depth + 2, out);
      }
      const dflt = tidySteps(s.default);
      if (dflt.length) {
        out.push({ id: "", depth: depth + 1, label: "If nothing matched" });
        outline(dflt, text, depth + 2, out);
      }
    } else {
      out.push({ id, depth, label: "Stop" });
    }
  }
  return out;
}

/** A new step id in the web panel's own style. */
export function newStepId(): string {
  const random = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(36).padStart(2, "0")).join("");
  return `s${Date.now().toString(36)}${random}`;
}

export function newTask(task: TaskDescriptor | undefined): TaskStep {
  return { type: "task", id: newStepId(), taskType: task?.id ?? "", parameters: {}, await: true, onSuccess: [], onFailure: [], failureOverride: null };
}

/** "850 ms", "12 s", "3 min 5 s" from a run's start and end. */
export function took(run: Run): string | null {
  if (!run.startedAt || !run.completedAt) return null;
  const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}
