import { signal, Text, View } from "nsh";
import { Area, Grid, Line, Plot } from "nsh/base/plot";

export interface MetricPoint {
  /** Milliseconds since the epoch. */
  t: number;
  value: number | null;
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * A titled area chart of one metric over time. Touching or hovering it reads out the
 * value at that moment; otherwise the latest value shows.
 */
export function MetricChart(props: {
  title: string;
  points: MetricPoint[];
  format: (value: number) => string;
  /** Fixed y range; otherwise from 0 to the data's top. */
  domain?: [number, number];
  lineClass: string;
  areaClass: string;
  dotClass: string;
  titleClass: string;
  /** Shown under the value, e.g. "of 8,192 MB". */
  caption?: string;
  /** `stepAfter` for counts that jump between whole numbers. */
  curve?: "linear" | "stepAfter";
  /** How a moment reads under the graph; the time of day by default. */
  formatTime?: (t: number) => string;
}) {
  const time = (t: number) => (props.formatTime ?? clock)(t);
  const hovered = signal<number | null>(null);
  const latest = () => {
    for (let i = props.points.length - 1; i >= 0; i--) if (props.points[i].value != null) return props.points[i];
    return null;
  };
  const shown = () => (hovered() != null ? props.points[hovered()!] : latest());
  const top = () => {
    if (props.domain) return props.domain;
    const max = Math.max(1, ...props.points.map((p) => p.value ?? 0));
    return [0, max * 1.15] as [number, number];
  };

  return (
    <View class="gap-2 rounded-(--radius) border border-border bg-card p-4">
      <View class="flex-row items-end justify-between">
        <View class="gap-0.5">
          <Text class={`text-xs font-semibold tracking-wider ${props.titleClass}`}>{props.title.toUpperCase()}</Text>
          <Text class="text-2xl font-bold text-card-foreground tabular-nums">
            {shown()?.value != null ? props.format(shown()!.value!) : "–"}
          </Text>
        </View>
        <Text class="text-xs text-muted-foreground tabular-nums">
          {hovered() != null && shown() ? time(shown()!.t) : (props.caption ?? "now")}
        </Text>
      </View>
      <If
        when={props.points.length > 1}
        else={
          <View class="h-28 items-center justify-center">
            <Text class="text-sm text-muted-foreground">Not enough data yet</Text>
          </View>
        }
      >
        <Plot
          data={props.points}
          y="value"
          yScale={{ type: "linear", domain: top() }}
          accessibilityLabel={`${props.title} over time`}
          onHoverChange={({ index }) => hovered.set(index)}
          crossLineClass="w-px h-full bg-foreground/30"
          dotClass={props.dotClass}
          class="h-28"
        >
          <Grid ticks={3} class="stroke-foreground/10" />
          <Area class={props.areaClass} curve={props.curve ?? "linear"} />
          <Line class={props.lineClass} curve={props.curve ?? "linear"} />
        </Plot>
        <View class="flex-row justify-between">
          <Text class="text-[10px] text-muted-foreground tabular-nums">{time(props.points[0].t)}</Text>
          <Text class="text-[10px] text-muted-foreground tabular-nums">{time(props.points[props.points.length - 1].t)}</Text>
        </View>
      </If>
    </View>
  );
}
