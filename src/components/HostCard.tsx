import { type JSX, Text, View } from "nsh";
import type { SpireDefinition, SpireState } from "../api/manage";
import { ago } from "./analyticsUi";

export const num = (v: number | string | null | undefined) => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** KB/s (as AMP reports, ×1000) as the panel writes it: "82 KiB/s", "1.4 MiB/s". */
export function rate(kbps: number | string): string {
  const bytes = num(kbps) * 1000;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB/s`;
  return `${Math.round(bytes / 1024)} KiB/s`;
}

export function size(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** A machine, as the panel's host card: online, shard count, CPU and RAM, network and free disk. */
export function HostCard(props: {
  spire: SpireDefinition;
  state?: SpireState;
  onPress?: () => void;
  /** A line under the figures (the AMP version, say). */
  footer?: JSX.Element;
}) {
  const s = () => props.state;
  const online = () => s()?.online ?? false;
  const cpu = () => num(s()?.cpuUsagePercent);
  const used = () => num(s()?.memoryUsedMb);
  const total = () => num(s()?.memoryTotalMb);
  const ram = () => (total() > 0 ? (used() / total()) * 100 : 0);
  const free = () => num(s()?.platform?.freeDiskMb);
  return (
    <View
      role={props.onPress ? "button" : undefined}
      onPress={props.onPress}
      testID={`host-${props.spire.displayName ?? props.spire.id}`}
      class={`overflow-hidden rounded-(--radius) border border-white/10 bg-card/85 shadow-lg ${props.onPress ? "active:opacity-85" : ""}`}
    >
      <View class="flex-row items-center gap-2.5 bg-linear-to-r from-hero-from/60 to-hero-to/40 px-4 py-3">
        <View class={`h-6 w-6 items-center justify-center rounded-full border-2 ${online() ? "border-success" : "border-destructive"}`}>
          <Text class={`text-xs font-bold ${online() ? "text-success" : "text-destructive"}`}>{online() ? "✓" : "!"}</Text>
        </View>
        <Text class="line-clamp-1 flex-1 text-base font-semibold text-white">{props.spire.displayName || props.spire.id}</Text>
        <Text class="text-xs text-white/75">{s() ? `${s()!.shardCount} shard${s()!.shardCount === 1 ? "" : "s"}` : ""}</Text>
        <If when={props.onPress}>
          <Text class="text-lg text-white/70">›</Text>
        </If>
      </View>
      <View class="gap-2.5 p-4">
        <If when={s()} else={<Text class="text-sm text-muted-foreground">{online() ? "Loading…" : "No report yet"}</Text>}>
          <Bar label="CPU" percent={cpu()} value={`${cpu().toFixed(0)}%`} barClass="bg-sky-400" />
          <Bar
            label="RAM"
            percent={ram()}
            value={total() > 0 ? `${size(used())} / ${size(total())}` : "–"}
            barClass="bg-violet-400"
          />
          <View class="flex-row flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <Text class="text-sm text-card-foreground tabular-nums">{`↓ ${rate(s()!.networkInKBps)}`}</Text>
            <Text class="text-sm text-card-foreground tabular-nums">{`↑ ${rate(s()!.networkOutKBps)}`}</Text>
            <If when={free() > 0}>
              <Text class="text-sm text-card-foreground tabular-nums">
                <Text class="text-xs text-muted-foreground">Free </Text>
                {size(free())}
              </Text>
            </If>
          </View>
          {props.footer}
          <If when={!online()}>
            <Text class="text-xs text-destructive">{`Offline${s()!.lastHeartbeat ? ` · last seen ${ago(s()!.lastHeartbeat)}` : ""}`}</Text>
          </If>
        </If>
      </View>
    </View>
  );
}

export function Bar(props: { label: string; percent: number; value: string; barClass: string }) {
  const width = (): `${number}%` => `${Math.max(2, Math.min(100, props.percent))}%`;
  return (
    <View class="flex-row items-center gap-3">
      <Text class="w-9 text-xs font-semibold text-muted-foreground">{props.label}</Text>
      <View class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <View class={`h-full rounded-full ${props.barClass}`} style={{ width: width() }} />
      </View>
      <Text class="text-right text-xs text-card-foreground tabular-nums">{props.value}</Text>
    </View>
  );
}
