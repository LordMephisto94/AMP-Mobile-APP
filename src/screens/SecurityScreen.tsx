import { effect, lifecycle, Scroll, signal, Text, View } from "nsh";
import { confirm } from "../components/Confirm";
import { FullScreen, PinPad, PinSetup } from "../components/Lock";
import { AppPage, ChoiceChip, Pill, SecondaryButton } from "../components/ui";
import { hideDetails, setHideDetails } from "../lib/privacy";
import {
  autoLockSeconds,
  biometricChoice,
  biometricOn,
  bound,
  changePin,
  eraseVault,
  hasPin,
  lockNow,
  servers,
  setAutoLock,
  setBiometricUnlock,
  setupPin,
} from "../state/servers";
import { Icon } from "../components/Icon";
import { CrashAlertsCard } from "../components/CrashAlertsCard";

// Non-breaking spaces: a chip mustn't wrap its label onto a line it then cuts off.
const AUTO_LOCK = [
  { seconds: 0, label: "Immediately" },
  { seconds: 30, label: "30\u00a0s" },
  { seconds: 60, label: "1\u00a0min" },
  { seconds: 300, label: "5\u00a0min" },
];

/** The app's own lock: the PIN that seals saved sign-ins, and when the app locks. */
export function SecurityScreen() {
  /** Which PIN flow is showing: setting the first, or changing (old PIN, then new). */
  const flow = signal<null | "setup" | "old" | "new">(null);
  const oldPin = signal("");
  const typed = signal("");
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const kept = () => servers().filter((s) => s.rememberMe).length;
  /** What the phone offers for fingerprint unlock; asked again on return (one may have been set up meanwhile). */
  const bio = signal<"ready" | "notEnrolled" | "unavailable" | "notBound" | null>(null);
  const bioBusy = signal(false);
  const bioError = signal<string | null>(null);
  effect(() => {
    if (lifecycle() !== "active" || !hasPin()) return;
    bound();
    biometricChoice()
      .then((c) => bio.set(c))
      .catch(() => bio.set("unavailable"));
  });

  const toggleBiometric = async () => {
    if (bioBusy()) return;
    bioBusy.set(true);
    bioError.set(null);
    try {
      const turnOn = !biometricOn();
      await setBiometricUnlock(turnOn);
      notice.set(turnOn ? "Fingerprint unlock is on." : "Fingerprint unlock is off.");
    } catch (e) {
      bioError.set((e as Error).message);
    } finally {
      bioBusy.set(false);
    }
  };

  const erase = async () => {
    const choice = await confirm({
      title: "Remove the PIN?",
      message: "Every saved sign-in is erased with it. Your servers stay in the list, signed out.",
      icon: "unlock",
      tone: "danger",
      actions: [{ id: "erase", label: "Remove PIN", tone: "danger" }],
    });
    if (choice === "erase") {
      await eraseVault();
      notice.set("PIN removed and saved sign-ins erased.");
    }
  };

  return (
    <AppPage title="Security" subtitle="This app on this device">
      {/* Scrolls: with all its cards it's taller than a phone. */}
      <Scroll class="flex-1 bg-background">
        <View class="w-full max-w-2xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+32px)]">
          <If when={notice()}>
            {(m) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text class="text-sm text-success">{m()}</Text>
              </View>
            )}
          </If>

          <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
            <View class="flex-row flex-wrap items-center gap-2">
              <Text class="text-base font-semibold text-card-foreground">App PIN</Text>
              <Pill label={hasPin() ? "On" : "Off"} tone={hasPin() ? "success" : "muted"} />
            </View>
            <Text class="text-sm text-muted-foreground">
              {hasPin()
                ? bound()
                  ? `Saved sign-ins (${kept()}) are encrypted with AES-256 and locked to this phone's secure hardware: they need your PIN, ${
                      biometricOn() ? "or your fingerprint or face" : "or a phone unlock in the last minute"
                    }, and can't be opened on any other device. Ten wrong PINs erase them.`
                  : `Saved sign-ins (${kept()}) are encrypted with AES-256 under a key made from your PIN. The PIN itself is never stored. Ten wrong PINs erase them.`
                : "Without a PIN, nothing is kept: you sign in again each time the app starts. Set one to stay signed in."}
            </Text>
            <If
              when={hasPin()}
              else={
                <View class="flex-row">
                  <SecondaryButton testID="set-pin" title="Set a PIN" onPress={() => flow.set("setup")} />
                </View>
              }
            >
              <View class="flex-row gap-2">
                <SecondaryButton testID="lock-now" title="Lock now" onPress={() => lockNow(true)} />
                <SecondaryButton testID="change-pin" title="Change PIN" onPress={() => (oldPin.set(""), typed.set(""), error.set(null), flow.set("old"))} />
              </View>
              <View class="flex-row">
                <SecondaryButton testID="remove-pin" title="Remove PIN" tone="danger" onPress={erase} />
              </View>
            </If>
          </View>

          <If when={hasPin() && (biometricOn() || (bio() !== null && bio() !== "unavailable"))}>
            <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
              <View class="flex-row items-center gap-3">
                <View class="flex-1 gap-1">
                  <Text class="text-base font-semibold text-card-foreground">Fingerprint unlock</Text>
                  <Text class="text-sm text-muted-foreground">
                    {biometricOn()
                      ? "The app asks for your fingerprint or face when it opens. The PIN always works too."
                      : bio() === "notEnrolled"
                        ? "Add a fingerprint or face in your phone's settings first."
                        : bio() === "notBound"
                          ? "Unlock the app with your PIN once more first, so the saved sign-ins move to this phone's secure hardware."
                          : "Open the app with your fingerprint or face instead of the PIN. Without it, the app opens by itself for a minute after you unlock your phone."}
                  </Text>
                </View>
                <View
                  role="switch"
                  testID="biometric-toggle"
                  accessibilityLabel="Fingerprint unlock"
                  onPress={() => (biometricOn() || bio() === "ready") && toggleBiometric()}
                  class={`h-7 w-12 justify-center rounded-full px-0.5 ${biometricOn() ? "items-end bg-primary" : "items-start bg-white/15"} ${
                    bioBusy() || (!biometricOn() && bio() !== "ready") ? "opacity-50" : ""
                  }`}
                >
                  <View class="h-6 w-6 rounded-full bg-white" />
                </View>
              </View>
              <If when={bioError()}>{(m) => <Text testID="biometric-error" class="text-sm text-destructive">{m()}</Text>}</If>
            </View>
          </If>

          <If when={hasPin()}>
            <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
              <Text class="text-base font-semibold text-card-foreground">Lock after leaving the app</Text>
              <View class="flex-row flex-wrap gap-2">
                <Each of={AUTO_LOCK}>
                  {(o) => (
                    <ChoiceChip testID={`autolock-${o().seconds}`} label={o().label} on={autoLockSeconds() === o().seconds} onPress={() => setAutoLock(o().seconds)} />
                  )}
                </Each>
              </View>
              <Text class="text-xs text-muted-foreground">While the app is in the background its screen is covered, so the app switcher doesn't show your servers.</Text>
            </View>
          </If>

          <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
            <View class="flex-row items-center gap-3">
              <View class="flex-1 gap-1">
                <Text class="text-base font-semibold text-card-foreground">Hide personal details</Text>
                <Text class="text-sm text-muted-foreground">
                  {hideDetails()
                    ? "Addresses, IPs, account and player names, emails and invite links are blurred everywhere, console lines included. Copy buttons still copy the real value."
                    : "Blur addresses, IPs, account and player names and emails across the app, for screenshots, screen sharing and streams. Turn it on and off whenever you like."}
                </Text>
              </View>
              <View
                role="switch"
                testID="hide-details-toggle"
                accessibilityLabel="Hide personal details"
                onPress={() => setHideDetails(!hideDetails()).catch(() => {})}
                class={`h-7 w-12 justify-center rounded-full px-0.5 ${hideDetails() ? "items-end bg-primary" : "items-start bg-white/15"}`}
              >
                <View class="h-6 w-6 rounded-full bg-white" />
              </View>
            </View>
          </View>

          <CrashAlertsCard />
        </View>
      </Scroll>

      <If when={flow() === "setup"}>
        <PinSetup
          title="Set a PIN"
          message="Saved sign-ins are encrypted with it, and the app asks for it when it opens."
          onDone={async (p) => {
            await setupPin(p);
            flow.set(null);
            notice.set("PIN set.");
          }}
          onCancel={() => flow.set(null)}
        />
      </If>
      <If when={flow() === "old"}>
        <FullScreen>
          <View class="w-full max-w-sm gap-7">
            <View class="items-center gap-3">
              <View class="self-center"><Icon name="lock" size={40} tone="primary" /></View>
              <Text class="text-center text-2xl font-bold text-foreground">Enter your current PIN</Text>
            </View>
            <If when={error()}>{(m) => <Text class="text-center text-sm text-destructive">{m()}</Text>}</If>
            <PinPad
              value={typed()}
              onChange={(v) => typed.set(v)}
              onDone={() => {
                oldPin.set(typed());
                typed.set("");
                flow.set("new");
              }}
            />
            <Text role="button" testID="pin-cancel" onPress={() => flow.set(null)} class="text-center text-sm font-semibold text-muted-foreground">
              Cancel
            </Text>
          </View>
        </FullScreen>
      </If>
      <If when={flow() === "new"}>
        <PinSetup
          title="Choose a new PIN"
          message="6 to 12 digits."
          onDone={async (p) => {
            if (await changePin(oldPin(), p)) {
              flow.set(null);
              notice.set("PIN changed.");
            } else {
              error.set("That isn't your current PIN.");
              flow.set("old");
            }
            oldPin.set("");
          }}
          onCancel={() => (oldPin.set(""), flow.set(null))}
        />
      </If>
    </AppPage>
  );
}
