import { cleanup, effect, lifecycle } from "nsh";

/**
 * Runs `load` now and every `intervalMs` while the app is in the foreground and
 * `visible()` holds (the page is on top of its stack). Stops when the component goes.
 * Coming back to the page or the app loads at once.
 *
 * AMP 3 documents no rate limit on reads (only on failed sign-ins), and an agent reports
 * metrics every ~5 s, so 30 s on a detail page and 60 s on a list keep the data fresh
 * without hammering the panel.
 */
export function poll(load: () => void | Promise<void>, intervalMs: number, visible: () => boolean = () => true): void {
  effect(() => {
    if (lifecycle() !== "active" || !visible()) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await load();
      } finally {
        running = false;
      }
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    cleanup(() => clearInterval(timer));
  });
}
