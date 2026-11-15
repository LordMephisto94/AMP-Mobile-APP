import { clearRevealed } from "../state/prefs";
import { cleanup, effect, Image, type JSX, lifecycle, Overlay, signal, Text, View, windowSize } from "nsh";
import { inkTint } from "./Icon";
import mark from "../../assets/amp-mark.png";
import {
  autoLockSeconds,
  autoUnlockAllowed,
  biometricNotice,
  biometricUnlock,
  canBiometricUnlock,
  canQuickUnlock,
  declinePin,
  eraseVault,
  hasPin,
  leftApp,
  lockNow,
  lockoutRemaining,
  locked,
  MAX_PIN_TRIES,
  pinSetupNeeded,
  quickUnlock,
  setupPin,
  unlock,
  validatePin,
  vaultNotice,
} from "../state/servers";
import { cancelConfirm, confirm } from "./Confirm";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/** Dots for the digits typed so far, and a number pad. */
export function PinPad(props: { value: string; onChange: (v: string) => void; onDone: () => void; disabled?: boolean; max?: number }) {
  const press = (k: string) => {
    if (props.disabled) return;
    if (k === "⌫") props.onChange(props.value.slice(0, -1));
    else if (k && props.value.length < (props.max ?? 12)) props.onChange(props.value + k);
  };
  return (
    <View class="w-full max-w-xs gap-6 self-center">
      <View class="h-4 flex-row items-center justify-center gap-3" accessibilityLabel={`${props.value.length} digits entered`}>
        <Each of={Array.from({ length: Math.max(6, props.value.length) }, (_, i) => i)}>
          {(i) => <View class={`h-3.5 w-3.5 rounded-full ${i() < props.value.length ? "bg-primary" : "border border-input"}`} />}
        </Each>
      </View>
      <View class="flex-row flex-wrap justify-between gap-y-3">
        <Each of={KEYS}>
          {(k) => (
            <View
              role={k() ? "button" : undefined}
              testID={k() ? `pin-${k() === "⌫" ? "back" : k()}` : undefined}
              accessibilityLabel={k() === "⌫" ? "Delete" : k()}
              onPress={() => press(k())}
              class={`h-16 w-[31%] items-center justify-center rounded-2xl focus-visible:ring-2 focus-visible:ring-ring ${k() ? "border border-border bg-secondary active:bg-accent" : ""} ${props.disabled ? "opacity-40" : ""}`}
            >
              <Text class="text-2xl font-semibold text-foreground">{k()}</Text>
            </View>
          )}
        </Each>
      </View>
      <View
        role="button"
        testID="pin-done"
        onPress={() => !props.disabled && props.value.length >= 6 && props.onDone()}
        class={`items-center rounded-(--radius) py-3.5 ${props.value.length >= 6 && !props.disabled ? "bg-primary" : "bg-muted"}`}
      >
        <Text class={`text-base font-semibold ${props.value.length >= 6 && !props.disabled ? "text-primary-foreground" : "text-muted-foreground"}`}>OK</Text>
      </View>
    </View>
  );
}

export function FullScreen(props: { children: JSX.Element }) {
  const size = () => ({ width: windowSize().width, height: windowSize().height });
  return (
    <Overlay>
      <View style={size()} class="absolute top-0 left-0 items-center justify-center bg-background px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {props.children}
      </View>
    </Overlay>
  );
}

/** Covers the app until the PIN opens the vault. */
function LockScreen() {
  const pin = signal("");
  const message = signal<string | null>(null);
  const wait = signal(0);
  const busy = signal(false);

  const tick = async () => wait.set(await lockoutRemaining());

  const useBiometric = async () => {
    if (busy()) return;
    busy.set(true);
    try {
      const outcome = await biometricUnlock();
      if (outcome.result === "failed") message.set(outcome.message ?? null);
      else if (outcome.result === "ok") message.set(null);
    } catch {
      message.set("Fingerprint unlock didn't work. Enter your PIN.");
    } finally {
      busy.set(false);
    }
  };
  // With fingerprint unlock on, the prompt opens by itself once each time the lock shows or
  // the app comes back from the background. Not again after "Use PIN" (the prompt makes the
  // app briefly inactive, which mustn't count), and not straight after "Lock now".
  let asked = false;
  effect(() => {
    const state = lifecycle();
    if (state === "background") asked = false;
    if (state !== "active" || asked || !canBiometricUnlock() || !autoUnlockAllowed()) return;
    asked = true;
    useBiometric();
  });
  // Straight in when the phone was unlocked within the last minute (fingerprint, face or
  // its own PIN): tried when the lock shows and whenever the app comes back to the front.
  effect(() => {
    if (lifecycle() !== "active" || !canQuickUnlock()) return;
    quickUnlock().catch(() => {});
  });
  effect(() => {
    tick();
    const t = setInterval(() => wait() > 0 && wait.set(wait() - 1), 1000);
    cleanup(() => clearInterval(t));
  });

  const submit = async () => {
    if (busy() || wait() > 0) return;
    busy.set(true);
    const entered = pin();
    pin.set("");
    try {
      const result = await unlock(entered);
      if (result.ok) {
        message.set(null);
        return;
      }
      if (result.erased) {
        // The app is unlocked, with the saved sign-ins gone.
        if (result.deviceLost) {
          await confirm({
            title: "Saved sign-ins cleared",
            message: "They were locked to a phone key that's no longer here (a reset, or a copy from another phone). Sign in to your servers again.",
            cancelLabel: null,
            actions: [{ id: "ok", label: "OK", tone: "primary" }],
          });
        }
        return;
      }
      wait.set(result.waitSeconds);
      message.set(
        result.wrong
          ? `Wrong PIN. ${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left before your saved sign-ins are erased.`
          : "Too many wrong PINs.",
      );
    } catch (e) {
      message.set((e as Error).message);
    } finally {
      busy.set(false);
    }
  };

  const forgot = async () => {
    const choice = await confirm({
      title: "Forgot your PIN?",
      message: "The PIN can't be recovered. Erasing it signs you out of every saved server; the servers stay, and you sign in again.",
      tone: "danger",
      actions: [{ id: "erase", label: "Erase and sign out", tone: "danger" }],
    });
    if (choice === "erase") await eraseVault();
  };

  return (
    <FullScreen>
      <View class="w-full max-w-sm gap-8">
        <View class="items-center gap-3">
          <Image src={mark} accessibilityLabel="AMP" style={inkTint()} class="h-14 w-14 object-contain" />
          <Text class="text-2xl font-bold text-foreground">AMP Mobile is locked</Text>
          <Text class="text-center text-sm text-muted-foreground">
            {canBiometricUnlock()
              ? "Use your fingerprint or face, or enter your PIN."
              : canQuickUnlock()
                ? "Enter your PIN, or unlock your phone and come straight back."
                : "Enter your PIN to open your saved servers."}
          </Text>
        </View>
        <If when={message() ?? biometricNotice()}>{(m) => <Text testID="lock-message" class="text-center text-sm text-destructive">{m()}</Text>}</If>
        <If when={wait() > 0}>
          <Text class="text-center text-sm text-warning">{`Try again in ${wait()} s`}</Text>
        </If>
        <PinPad value={pin()} onChange={(v) => pin.set(v)} onDone={submit} disabled={busy() || wait() > 0} />
        <If when={canBiometricUnlock()}>
          <View
            role="button"
            testID="lock-biometric"
            onPress={useBiometric}
            class={`flex-row items-center justify-center gap-2 self-center rounded-full border border-border bg-secondary px-5 py-2.5 active:bg-accent ${busy() ? "opacity-50" : ""}`}
          >
            <Text class="text-sm font-semibold text-foreground">Use fingerprint</Text>
          </View>
        </If>
        <Text role="button" testID="forgot-pin" onPress={forgot} class="text-center text-sm font-semibold text-info">
          Forgot PIN?
        </Text>
      </View>
    </FullScreen>
  );
}

/** Asks for a PIN, twice, so sessions the user asked to keep can be sealed. */
export function PinSetup(props: { title: string; message: string; onDone: (pin: string) => Promise<void> | void; onCancel?: () => void; cancelLabel?: string }) {
  const first = signal<string | null>(null);
  const pin = signal("");
  const error = signal<string | null>(null);

  const done = async () => {
    error.set(null);
    if (first() === null) {
      try {
        validatePin(pin());
      } catch (e) {
        error.set((e as Error).message);
        pin.set("");
        return;
      }
      first.set(pin());
      pin.set("");
      return;
    }
    if (pin() !== first()) {
      error.set("The PINs don't match. Start again.");
      first.set(null);
      pin.set("");
      return;
    }
    try {
      await props.onDone(pin());
    } catch (e) {
      error.set((e as Error).message);
      first.set(null);
      pin.set("");
    }
  };

  return (
    <FullScreen>
      <View class="w-full max-w-sm gap-7">
        <View class="items-center gap-3">
          <Text class="text-center text-2xl font-bold text-foreground">{first() === null ? props.title : "Enter it again"}</Text>
          <Text class="text-center text-sm text-muted-foreground">{first() === null ? props.message : "To make sure it's the one you meant."}</Text>
        </View>
        <If when={error()}>{(m) => <Text testID="pin-error" class="text-center text-sm text-destructive">{m()}</Text>}</If>
        <PinPad value={pin()} onChange={(v) => pin.set(v)} onDone={done} />
        <If when={props.onCancel}>
          <Text role="button" testID="pin-cancel" onPress={props.onCancel} class="text-center text-sm font-semibold text-muted-foreground">
            {props.cancelLabel ?? "Cancel"}
          </Text>
        </If>
      </View>
    </FullScreen>
  );
}

/**
 * The app's lock: the lock screen while locked, the PIN setup when a kept sign-in waits
 * for one, and locking after `autoLockSeconds` in the background. While the app isn't in
 * front, a plain cover hides it from the app switcher's snapshot.
 */
export function LockHost() {
  let leftAt = 0;
  let lockTimer: ReturnType<typeof setTimeout> | undefined;
  // Locking cancels any dialog left open, so nothing is answered from behind the lock.
  let wasLocked = locked();
  effect(() => {
    const now = locked();
    if (now && !wasLocked) {
      cancelConfirm();
      clearRevealed();
    }
    wasLocked = now;
  });
  // The vault opened with the right PIN but its sessions couldn't be read (the file was changed): say so once.
  effect(() => {
    const note = vaultNotice();
    if (!note || locked()) return;
    vaultNotice.set(null);
    confirm({ title: "Saved sign-ins couldn't be read", message: note, cancelLabel: null, actions: [{ id: "ok", label: "OK", tone: "primary" }] });
  });
  effect(() => {
    const state = lifecycle();
    // Turning the screen off may only make the app inactive, so any step away counts.
    if (state !== "active") leftApp();
    if (state === "active") clearTimeout(lockTimer);
    if (state === "background") {
      leftAt = Date.now();
      clearTimeout(lockTimer);
      // A timer as well as the check on return, so the sessions leave memory on time even if the app stays in the background.
      if (autoLockSeconds() === 0) lockNow();
      else lockTimer = setTimeout(() => lockNow(), autoLockSeconds() * 1000);
    } else if (state === "active" && leftAt) {
      const away = Date.now() - leftAt;
      // A clock set back while away (a negative time) locks too, rather than never.
      if (away < 0 || away >= autoLockSeconds() * 1000) lockNow();
      leftAt = 0;
    }
  });

  return (
    <>
      <If when={pinSetupNeeded() && !locked()}>
        <PinSetup
          title="Set a PIN to stay signed in"
          message={`Saved sign-ins are encrypted with it, and the app asks for it when it opens. ${MAX_PIN_TRIES} wrong tries erase them.`}
          onDone={(p) => setupPin(p)}
          onCancel={() => declinePin()}
          cancelLabel="Not now: sign in again next time"
        />
      </If>
      <If when={locked() && hasPin()}>
        <LockScreen />
      </If>
      <If when={lifecycle() === "background" && !locked()}>
        <FullScreen>
          <Image src={mark} accessibilityLabel="AMP" style={inkTint()} class="h-16 w-16 object-contain" />
        </FullScreen>
      </If>
    </>
  );
}
