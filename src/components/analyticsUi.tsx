import { type JSX, Text, View } from "nsh";
import { type Decimal, num } from "../api/analytics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const PERIODS = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7d", hours: 24 * 7 },
  { id: "30d", label: "30d", hours: 24 * 30 },
  { id: "90d", label: "90d", hours: 24 * 90 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

export function periodOf(id: PeriodId) {
  const hours = PERIODS.find((p) => p.id === id)!.hours;
  const to = new Date();
  return { from: new Date(to.getTime() - hours * 3_600_000), to };
}

const two = (n: number) => String(n).padStart(2, "0");
export const clockOf = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dayOf = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
/** "Sat 15 Nov, 20:00". */
export const momentOf = (d: Date) => `${DAYS[d.getDay()]} ${dayOf(d)}, ${clockOf(d)}`;

/** When something last happened, roughly: "just now", "5 min ago", "3 h ago", "12 Nov". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "–";
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return dayOf(new Date(t));
}

/** The period chips: 24h, 7d, 30d, 90d. */
export function PeriodPicker(props: { value: PeriodId; onChange: (id: PeriodId) => void }) {
  return (
    <View class="flex-row gap-1 self-start rounded-lg bg-card/85 p-1">
      <Each of={[...PERIODS]}>
        {(p) => (
          <Text
            role="button"
            testID={`period-${p().id}`}
            onPress={() => props.onChange(p().id)}
            class={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              props.value === p().id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {p().label}
          </Text>
        )}
      </Each>
    </View>
  );
}

/**
 * One headline figure with its change against the previous period. `goodWhenUp: false`
 * for figures where less is better (the bounce rate).
 */
export function StatTile(props: { label: string; value: string; change?: Decimal; goodWhenUp?: boolean; accent: string }) {
  const change = () => (props.change == null ? null : num(props.change));
  const good = () => (change() ?? 0) === 0 || (change()! > 0) === (props.goodWhenUp ?? true);
  return (
    <View class="w-[48%] gap-1 rounded-(--radius) border border-white/10 bg-card/85 p-3.5 shadow-lg md:w-[23.5%]">
      <Text class={`text-[11px] font-semibold tracking-wider ${props.accent}`}>{props.label.toUpperCase()}</Text>
      <Text class="text-2xl font-bold text-card-foreground tabular-nums">{props.value}</Text>
      <If
        when={change() != null}
        else={<Text class="text-xs text-muted-foreground">{props.change === null ? "no earlier data" : " "}</Text>}
      >
        <Text class={`text-xs font-semibold tabular-nums ${good() ? "text-success" : "text-destructive"}`}>
          {`${change()! > 0 ? "▲" : change()! < 0 ? "▼" : "•"} ${Math.abs(change()!).toFixed(Math.abs(change()!) < 10 ? 1 : 0)}%`}
        </Text>
      </If>
    </View>
  );
}

/** A titled card holding a list or a breakdown. */
export function Section(props: { title: string; note?: string; children?: JSX.Element }) {
  return (
    <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
      <View class="flex-row items-baseline justify-between gap-3">
        <Text class="text-xs font-semibold tracking-widest text-muted-foreground">{props.title.toUpperCase()}</Text>
        <If when={props.note}>{(n) => <Text class="text-xs text-muted-foreground">{n()}</Text>}</If>
      </View>
      {props.children}
    </View>
  );
}

/** A row of a breakdown: an icon, a label, a share bar and a figure. */
export function ShareRow(props: {
  icon: string;
  label: string;
  detail?: string;
  value: string;
  percent: Decimal;
  barClass: string;
  onPress?: () => void;
  testID?: string;
}) {
  const width = (): `${number}%` => `${Math.max(2, Math.min(100, num(props.percent)))}%`;
  return (
    <View
      role={props.onPress ? "button" : undefined}
      testID={props.testID}
      onPress={props.onPress}
      class={`gap-1.5 rounded-lg py-1 ${props.onPress ? "active:bg-accent" : ""}`}
    >
      <View class="flex-row items-center gap-2.5">
        <Text class="text-lg">{props.icon}</Text>
        <View class="flex-1">
          <Text class="line-clamp-1 text-sm font-semibold text-card-foreground">{props.label}</Text>
          <If when={props.detail}>{(d) => <Text class="line-clamp-1 text-xs text-muted-foreground">{d()}</Text>}</If>
        </View>
        <Text class="text-sm text-card-foreground tabular-nums">{props.value}</Text>
        <If when={props.onPress}>
          <Text class="text-lg text-muted-foreground">›</Text>
        </If>
      </View>
      <View class="h-1.5 overflow-hidden rounded-full bg-white/10">
        <View class={`h-full rounded-full ${props.barClass}`} style={{ width: width() }} />
      </View>
    </View>
  );
}

/** The warning shown when AMP answered with invented numbers. */
export function DemoNotice() {
  return (
    <View class="flex-row gap-3 rounded-(--radius) border border-warning/40 bg-warning/10 p-3.5">
      <Text class="text-lg">🧪</Text>
      <View class="flex-1 gap-0.5">
        <Text class="text-sm font-semibold text-warning">Demo numbers</Text>
        <Text class="text-xs text-muted-foreground">
          This panel's licence doesn't include analytics, so AMP sent made-up figures. Nothing here was recorded.
        </Text>
      </View>
    </View>
  );
}
