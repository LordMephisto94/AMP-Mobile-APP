import { signal, Text, View } from "nsh";
import { confirm } from "../components/Confirm";
import { FullScreen, PinPad, PinSetup } from "../components/Lock";
import { AppPage, Pill, SecondaryButton } from "../components/ui";
import { autoLockSeconds, bound, changePin, eraseVault, hasPin, lockNow, servers, setAutoLock, setupPin } from "../state/servers";

const AUTO_LOCK = [
  { seconds: 0, label: "Immediately" },
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 300, label: "5 min" },
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

  const erase = async () => {
    const choice = await confirm({
      title: "Remove the PIN?",
      message: "Every saved sign-in is erased with it. Your servers stay in the list, signed out.",
      icon: "🔓",
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
      <View class="flex-1 bg-background">
        <View class="w-full max-w-2xl gap-4 self-center p-4">
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
                  ? `Saved sign-ins (${kept()}) are encrypted with AES-256 and locked to this phone's secure hardware: they need your PIN, or a phone unlock in the last minute, and can't be opened on any other device. Ten wrong PINs erase them.`
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

          <If when={hasPin()}>
            <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
              <Text class="text-base font-semibold text-card-foreground">Lock after leaving the app</Text>
              <View class="flex-row flex-wrap gap-2">
                <Each of={AUTO_LOCK}>
                  {(o) => (
                    <Text
                      role="button"
                      testID={`autolock-${o().seconds}`}
                      onPress={() => setAutoLock(o().seconds)}
                      class={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                        autoLockSeconds() === o().seconds ? "border-primary bg-primary text-primary-foreground" : "border-white/10 bg-background/60 text-muted-foreground"
                      }`}
                    >
                      {o().label}
                    </Text>
                  )}
                </Each>
              </View>
              <Text class="text-xs text-muted-foreground">While the app is in the background its screen is covered, so the app switcher doesn't show your servers.</Text>
            </View>
          </If>
        </View>
      </View>

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
              <Text class="text-4xl">🔐</Text>
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
