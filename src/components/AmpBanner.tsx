import { Canvas, type CanvasRenderingContext2D, type JSX, Text, View } from "nsh";
import type { StateTone } from "../api/types";
import { PrivText } from "../lib/privacy";
import { Icon } from "./Icon";

/** Colours of the AMP 3 panel's header: purple to magenta, with a status triangle. */
const BASE_STOPS = ["#5a3a8e", "#6a2a8c", "#7e2483", "#8d2a7f"];
const ACCENTS = {
  online: ["#2fa37a", "#1f7a4f"],
  offline: ["#6b6b80", "#45455a"],
  warning: ["#e8873a", "#b4561c"],
  danger: ["#e24a68", "#a8243f"],
} as const;

export type BannerStatus = keyof typeof ACCENTS;

/** A shard's state tone as a banner/badge status. */
export function toneStatus(tone: StateTone): BannerStatus {
  return ({ running: "online", stopped: "offline", busy: "warning", attention: "warning", error: "danger" } as const)[tone];
}

/**
 * Draws the panel-style header: tall alternating triangles in faint light and dark
 * over a purple gradient, one coloured triangle near the left showing the status,
 * and a shade toward the bottom so text sits on it cleanly.
 */
function drawTriangles(cx: CanvasRenderingContext2D, width: number, height: number, status: BannerStatus) {
  // A canvas not laid out yet (or measured off screen) can report 0, NaN or Infinity:
  // drawing then would loop without end.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 20_000) return;
  const base = cx.createLinearGradient(0, 0, width, 0);
  BASE_STOPS.forEach((color, i) => base.addColorStop(i / (BASE_STOPS.length - 1), color));
  cx.fillStyle = base;
  cx.fillRect(0, 0, width, height);

  // Triangles as wide as the banner is tall (at least 80 pt), half a width apart,
  // pointing up and down in turn.
  const w = Math.max(80, height * 1.35);
  const step = w / 2;
  const count = Math.ceil(width / step) + 2;
  for (let i = -1; i < count; i++) {
    const x = i * step;
    const up = i % 2 === 0;
    // A fixed pattern of shades, so the banner looks the same every time.
    const shade = [0.07, -0.1, 0.04, -0.06, 0.1, -0.04, 0.05, -0.12][(i + 8) % 8];
    cx.globalAlpha = Math.abs(shade);
    cx.fillStyle = shade > 0 ? "#ffffff" : "#12001f";
    cx.beginPath();
    if (up) {
      cx.moveTo(x, height);
      cx.lineTo(x + w / 2, 0);
      cx.lineTo(x + w, height);
    } else {
      cx.moveTo(x, 0);
      cx.lineTo(x + w, 0);
      cx.lineTo(x + w / 2, height);
    }
    cx.closePath();
    cx.fill();
  }

  // The status triangle, near the left as in the panel.
  const [from, to] = ACCENTS[status];
  const ax = Math.min(width * 0.08, 60);
  const accent = cx.createLinearGradient(ax, 0, ax + w / 2, height);
  accent.addColorStop(0, from);
  accent.addColorStop(1, to);
  cx.globalAlpha = 0.85;
  cx.fillStyle = accent;
  cx.beginPath();
  cx.moveTo(ax, height);
  cx.lineTo(ax + w / 2, 0);
  cx.lineTo(ax + w, height);
  cx.closePath();
  cx.fill();

  // Shade toward the bottom.
  const shade = cx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(10,0,20,0)");
  shade.addColorStop(1, "rgba(10,0,20,0.45)");
  cx.globalAlpha = 1;
  cx.fillStyle = shade;
  cx.fillRect(0, 0, width, height);
}

/** The status badge on the banner: a tinted box with an icon. */
export function StatusBadge(props: { label: string; status: BannerStatus; testID?: string }) {
  const style = () =>
    ({
      online: ["bg-emerald-900/70 border-emerald-400/40", "text-emerald-300", "check", "#6ee7b7"],
      offline: ["bg-black/40 border-white/20", "text-white/70", "circle", "#ffffffb3"],
      warning: ["bg-orange-950/70 border-orange-400/40", "text-orange-300", "exclaim", "#fdba74"],
      danger: ["bg-rose-950/70 border-rose-400/40", "text-rose-300", "x", "#fda4af"],
    } as const)[props.status];
  return (
    <View testID={props.testID} accessibilityLabel={props.label} class={`flex-row items-center gap-1.5 rounded-md border px-2 py-1 ${style()[0]}`}>
      <Icon name={style()[2]} size={13} color={style()[3]} />
      <Text class={`text-xs font-semibold ${style()[1]}`}>{props.label}</Text>
    </View>
  );
}

/**
 * The AMP panel's header banner: a title with a status badge and a subtitle over
 * the triangle pattern.
 */
export function AmpBanner(props: {
  title: string;
  subtitle?: string;
  status: BannerStatus;
  statusLabel: string;
  /** A second badge after the first (the home page's "Online"). */
  extraBadge?: { label: string; status: BannerStatus; testID?: string } | { label: string; status: BannerStatus; testID?: string }[];
  class?: string;
  children?: JSX.Element;
}) {
  return (
    <View class={`overflow-hidden ${props.class ?? ""}`}>
      <Canvas class="absolute inset-0" draw={(cx, { width, height }) => drawTriangles(cx, width, height, props.status)} />
      <View class="gap-1.5 px-5 py-5">
        <If
          when={props.extraBadge ? [props.extraBadge].flat() : null}
          else={
            <View class="flex-row flex-wrap items-center gap-2.5">
              <Text class="text-2xl font-light text-white">{props.title}</Text>
              <StatusBadge label={props.statusLabel} status={props.status} />
            </View>
          }
        >
          {(b) => (
            <>
              {/* Two badges: the name gets its own line (clear of a corner button), the badges the next. */}
              <Text class="line-clamp-1 pr-10 text-2xl font-light text-white">
                {props.title}
              </Text>
              <View class="flex-row flex-wrap items-center gap-2">
                <StatusBadge label={props.statusLabel} status={props.status} />
                <Each of={b()}>{(x) => <StatusBadge label={x().label} status={x().status} testID={x().testID} />}</Each>
              </View>
            </>
          )}
        </If>
        <If when={props.subtitle}>{(s) => <PrivText class="text-sm text-white/75" text={s()} />}</If>
        {props.children}
      </View>
    </View>
  );
}
