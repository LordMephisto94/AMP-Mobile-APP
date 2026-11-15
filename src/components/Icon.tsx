import { colorScheme, Image } from "nsh";
import analytics from "../../assets/menu/analytics.svg";
import copy from "../../assets/icons/copy.svg";
import eyeOff from "../../assets/icons/eye-off.svg";
import file from "../../assets/icons/file.svg";
import folder from "../../assets/icons/folder.svg";
import importIcon from "../../assets/icons/import.svg";
import info from "../../assets/icons/info.svg";
import lock from "../../assets/icons/lock.svg";
import plus from "../../assets/icons/plus.svg";
import power from "../../assets/icons/power.svg";
import ruler from "../../assets/icons/ruler.svg";
import schedule from "../../assets/icons/schedule.svg";
import server from "../../assets/icons/server.svg";
import shield from "../../assets/icons/shield.svg";
import sliders from "../../assets/icons/sliders.svg";
import snapshot from "../../assets/icons/snapshot.svg";
import terminal from "../../assets/icons/terminal.svg";
import theme from "../../assets/icons/theme.svg";

/**
 * The app's line icons: 24 px art drawn in white, tinted here from the theme so they read in
 * both the dark and the light appearance. Used where an icon names a destination or a kind of
 * thing (a row that opens the console, a folder in a file list), never as decoration.
 */
const ICONS = {
  analytics,
  copy,
  "eye-off": eyeOff,
  file,
  folder,
  import: importIcon,
  info,
  lock,
  plus,
  power,
  ruler,
  schedule,
  server,
  shield,
  sliders,
  snapshot,
  terminal,
  theme,
} as const;

export type IconName = keyof typeof ICONS;
/** `onAccent` is for an icon on a solid accent button. */
export type IconTone = "foreground" | "muted" | "accent" | "onAccent";

const TINT = {
  dark: { foreground: "#eef0ff", muted: "#9a9cc4", accent: "#a78bfa", onAccent: "#140c2e" },
  light: { foreground: "#1e1b4b", muted: "#625f8a", accent: "#7c3aed", onAccent: "#ffffff" },
} as const;

/** Tints a white logo image dark on the light theme; the dark theme shows it as drawn. */
export const inkTint = () => (colorScheme() === "light" ? { tintColor: "#1e1b4b" } : undefined);

export function Icon(props: { name: IconName; size?: number; tone?: IconTone }) {
  const size = () => props.size ?? 20;
  return <Image src={ICONS[props.name]} style={{ width: size(), height: size(), tintColor: TINT[colorScheme()][props.tone ?? "muted"] }} />;
}
