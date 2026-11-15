import { sizeUnits, speedUnits } from "../state/prefs";

const BINARY = ["B", "KB", "MB", "GB", "TB"] as const;
const DECIMAL = ["B", "kB", "MB", "GB", "TB"] as const;

/** Bytes as "1.5 GB" in the size units the user chose (1024s by default, as AMP counts). */
export function formatBytes(bytes: number | string | undefined): string {
  let n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  const decimal = sizeUnits() === "decimal";
  const step = decimal ? 1000 : 1024;
  const units = decimal ? DECIMAL : BINARY;
  let u = 0;
  while (n >= step && u < units.length - 1) {
    n /= step;
    u++;
  }
  return `${n < 10 && u > 0 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

/** A size AMP reports in MB (counted in 1024s), in the chosen units. */
export function formatMb(mb: number): string {
  return formatBytes((Number.isFinite(mb) ? Math.max(0, mb) : 0) * 1024 * 1024);
}

/** A rate AMP reports in KB/s (counted in 1000s), in bytes or bits per second as chosen. */
export function formatRate(kbps: number): string {
  const bytesPerSecond = (Number.isFinite(kbps) ? Math.max(0, kbps) : 0) * 1000;
  if (speedUnits() === "bits") {
    const bits = bytesPerSecond * 8;
    if (bits >= 1e9) return `${(bits / 1e9).toFixed(1)} Gbit/s`;
    if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbit/s`;
    return `${Math.round(bits / 1e3)} kbit/s`;
  }
  if (sizeUnits() === "decimal") {
    if (bytesPerSecond >= 1e6) return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`;
    return `${Math.round(bytesPerSecond / 1e3)} kB/s`;
  }
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MiB/s`;
  return `${Math.round(bytesPerSecond / 1024)} KiB/s`;
}
