import { cleanup, effect, Overlay, signal, Text, View, windowSize } from "nsh";
import { BackHandler } from "nsh/mobile";
import { PrivText } from "../lib/privacy";
import { Icon, type IconName } from "./Icon";

export interface ConfirmAction {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "default";
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** An emoji shown in a tinted circle above the title. */
  icon?: IconName;
  /** Buttons, left to right / top to bottom. A "Cancel" is added first unless `cancelLabel` is null. */
  actions: ConfirmAction[];
  cancelLabel?: string | null;
  tone?: "default" | "danger";
}

interface Pending extends ConfirmOptions {
  resolve: (id: string | null) => void;
}

const pending = signal<Pending | null>(null);

/**
 * Asks the user with the app's own dialog (in place of the system alert). Resolves with
 * the chosen action's id, or null when cancelled (Cancel, the backdrop, Android back).
 */
export function confirm(options: ConfirmOptions): Promise<string | null> {
  pending()?.resolve(null);
  return new Promise((resolve) => pending.set({ ...options, resolve }));
}

/** Closes any open dialog as cancelled (the app locked: nothing may be answered behind the lock). */
export function cancelConfirm(): void {
  const p = pending();
  if (!p) return;
  pending.set(null);
  p.resolve(null);
}

/** Mount once at the app's root: draws the dialog `confirm` asks for, over everything. */
export function ConfirmHost() {
  const shown = signal(false);

  const finish = (id: string | null) => {
    const p = pending();
    if (!p) return;
    shown.set(false);
    // Let the fade-out run before the dialog goes.
    setTimeout(() => {
      if (pending() === p) pending.set(null);
      p.resolve(id);
    }, 140);
  };

  effect(() => {
    if (!pending()) return;
    // Next frame: from the starting look to the shown one, so the transition plays.
    const frame = setTimeout(() => shown.set(true), 16);
    // Android's back button cancels it (the module is a no-op elsewhere; guard anyway).
    let stopBack = () => {};
    try {
      stopBack = BackHandler.on("press", () => {
        finish(null);
        return true;
      });
    } catch {
      // no back button on this platform
    }
    cleanup(() => {
      clearTimeout(frame);
      stopBack();
    });
  });

  // An overlay has no size of its own to fill (`inset-0` gives nothing): size to the window.
  const screen = () => ({ width: windowSize().width, height: windowSize().height });

  const buttons = (p: Pending): ConfirmAction[] =>
    p.cancelLabel === null ? p.actions : [{ id: "__cancel", label: p.cancelLabel ?? "Cancel" }, ...p.actions];

  return (
    <If when={pending()}>
      {(p) => (
        <Overlay>
          {/* The backdrop is a layer of its own behind the card, so the card needs no press
              handler (a pressable view would group its text for screen readers). */}
          <View
            testID="confirm-backdrop"
            onPress={() => finish(null)}
            style={screen()}
            class={`absolute top-0 left-0 bg-black/65 transition-opacity duration-150 ${shown() ? "opacity-100" : "opacity-0"}`}
          />
          <View style={{ ...screen(), pointerEvents: "box-none" }} class="absolute top-0 left-0 items-center justify-center px-7">
            <View
              testID="confirm"
              class={`w-full max-w-sm gap-4 rounded-3xl border border-white/10 bg-popover p-6 shadow-2xl transition-all duration-150 ease-out ${
                shown() ? "scale-100 opacity-100" : "scale-95 opacity-0"
              }`}
            >
              <If when={p().icon}>
                {(icon) => (
                  <View
                    class={`h-12 w-12 items-center justify-center self-center rounded-full ${
                      p().tone === "danger" ? "bg-destructive/15" : "bg-primary/15"
                    }`}
                  >
                    <Icon name={icon()} size={26} tone={p().tone === "danger" ? "destructive" : "primary"} />
                  </View>
                )}
              </If>
              <View class="gap-1.5">
                <PrivText box="justify-center" class="text-center text-lg font-semibold text-popover-foreground" text={p().title} />
                <If when={p().message}>{(m) => <PrivText box="justify-center" class="text-center text-sm leading-5 text-muted-foreground" text={m()} />}</If>
              </View>
              <View class={`gap-2.5 ${buttons(p()).length <= 2 ? "flex-row" : ""}`}>
                <Each of={buttons(p())} key={(a: ConfirmAction) => a.id}>
                  {(a) => (
                    <View
                      role="button"
                      testID={`confirm-${a().id === "__cancel" ? "cancel" : a().id}`}
                      onPress={() => finish(a().id === "__cancel" ? null : a().id)}
                      class={`flex-1 items-center rounded-xl px-4 py-3 active:opacity-80 ${
                        a().tone === "danger"
                          ? "bg-destructive"
                          : a().tone === "primary"
                            ? "bg-linear-to-r from-hero-from to-hero-to"
                            : "bg-secondary"
                      }`}
                    >
                      <Text
                        class={`text-[15px] font-semibold ${
                          a().tone === "danger" || a().tone === "primary" ? "text-white" : "text-secondary-foreground"
                        }`}
                      >
                        {a().label}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </View>
          </View>
        </Overlay>
      )}
    </If>
  );
}
