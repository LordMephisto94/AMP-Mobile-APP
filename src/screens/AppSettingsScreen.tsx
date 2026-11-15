import { Icon, type IconName } from "../components/Icon";
import { Clipboard, type JSX, signal, Text, View } from "nsh";
import { Screen } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { AppPage, ErrorText, NavRow, SecondaryButton, Segmented, Switch } from "../components/ui";
import { formatBytes, formatRate } from "../lib/units";
import { nav } from "../state/nav";
import {
  blockCapture,
  hideIps,
  setBlockCapture,
  setHideIps,
  setSizeUnits,
  setSpeedUnits,
  setThemeMode,
  sizeUnits,
  speedUnits,
  themeMode,
} from "../state/prefs";
import { addServersFromList, parseServerList, serverListText, servers } from "../state/servers";
import { showAbout } from "./ServersScreen";

/** A titled card of related settings. */
function Group(props: { title: string; icon: IconName; children?: JSX.Element }) {
  return (
    <View class="gap-4 rounded-(--radius) border border-border bg-card p-4">
      <View class="flex-row items-center gap-2.5">
        <Icon name={props.icon} tone="accent" size={22} />
        <Text class="text-base font-semibold text-card-foreground">{props.title}</Text>
      </View>
      {props.children}
    </View>
  );
}

/** One setting: its name, a line on what it does, and its control. */
function Setting(props: { label: string; hint?: string; children?: JSX.Element }) {
  return (
    <View class="gap-2">
      <View class="gap-0.5">
        <Text class="text-sm font-semibold text-foreground">{props.label}</Text>
        <If when={props.hint}>{(h) => <Text class="text-xs text-muted-foreground">{h()}</Text>}</If>
      </View>
      {props.children}
    </View>
  );
}

/** The app's own settings: theme, units, privacy, and the way to Security and About. */
export function AppSettingsScreen() {
  const notice = signal<string | null>(null);
  const error = signal<string | null>(null);

  const copyList = async () => {
    notice.set(null);
    error.set(null);
    try {
      await Clipboard.writeText(serverListText());
      const n = servers().length;
      notice.set(`Copied ${n} server${n === 1 ? "" : "s"}. Passwords and sign-ins are not included.`);
    } catch {
      error.set("This device can't copy to the clipboard.");
    }
  };

  const addFromClipboard = async () => {
    notice.set(null);
    error.set(null);
    let text: string;
    try {
      text = await Clipboard.readText();
    } catch {
      error.set("This device can't read the clipboard.");
      return;
    }
    const parsed = parseServerList(text);
    if (parsed.error) {
      error.set(parsed.error);
      return;
    }
    const n = parsed.entries.length;
    const plain = parsed.entries.filter((e) => e.serverUrl.startsWith("http://")).length;
    const choice = await confirm({
      title: `Add ${n} server${n === 1 ? "" : "s"}?`,
      message: `They are added signed out, and you sign in to each.${plain ? ` ${plain} use plain http, which is not encrypted.` : ""}`,
      actions: [{ id: "add", label: "Add", tone: "primary" }],
    });
    if (choice !== "add") return;
    const result = await addServersFromList(parsed.entries);
    notice.set(`Added ${result.added}.${result.skipped ? ` ${result.skipped} already saved.` : ""}`);
  };

  return (
    <AppPage title="Settings" subtitle="This app on this device">
      <Screen>
        <View class="w-full max-w-2xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If when={notice()}>
            {(m) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text testID="settings-notice" class="text-sm text-success">{m()}</Text>
              </View>
            )}
          </If>
          <If when={error()}>{(m) => <ErrorText message={m()} />}</If>

          <Group title="Appearance" icon="theme">
            <Setting label="Theme" hint="Dark suits the artwork. System follows your phone.">
              <Segmented
                testID="theme"
                value={themeMode()}
                options={[
                  { id: "dark", label: "Dark" },
                  { id: "light", label: "Light" },
                  { id: "system", label: "System" },
                ]}
                onChange={(v) => setThemeMode(v)}
              />
            </Setting>
          </Group>

          <Group title="Units" icon="ruler">
            <Setting label="Sizes" hint="Binary counts in 1024s (KiB, MiB, GiB). Decimal counts in 1000s (kB, MB, GB).">
              <Segmented
                testID="size"
                value={sizeUnits()}
                options={[
                  { id: "binary", label: "Binary" },
                  { id: "decimal", label: "Decimal" },
                ]}
                onChange={(v) => setSizeUnits(v)}
              />
            </Setting>
            <Setting label="Network speed" hint="Bits suit comparing with a network plan. Bytes match file sizes.">
              <Segmented
                testID="speed"
                value={speedUnits()}
                options={[
                  { id: "bytes", label: "Bytes per second" },
                  { id: "bits", label: "Bits per second" },
                ]}
                onChange={(v) => setSpeedUnits(v)}
              />
            </Setting>
            <Text testID="units-example" class="text-xs text-muted-foreground">
              {`Example: ${formatBytes(1.5 * 1024 ** 3)} of memory, ${formatRate(1250)} of traffic`}
            </Text>
          </Group>

          <Group title="Privacy" icon="eye-off">
            <Setting label="IP addresses and host names" hint="Hides them on server cards, instances, machines and networking. Copying still copies the real address.">
              <Segmented
                testID="hide"
                value={hideIps()}
                options={[
                  { id: "off", label: "Show" },
                  { id: "tap", label: "Hide, tap to show" },
                  { id: "always", label: "Always hide" },
                ]}
                onChange={(v) => setHideIps(v)}
              />
            </Setting>
            <Switch
              testID="block-capture"
              label="Block screenshots and screen recording"
              hint="Android app only. It also keeps the app blank in the recents list."
              value={blockCapture()}
              onChange={(on) => setBlockCapture(on)}
            />
          </Group>

          <Group title="Servers" icon="server">
            <Text class="text-xs text-muted-foreground">Move a server's saved details to another phone as text. Passwords and sign-ins are never included.</Text>
            <View class="flex-row gap-2">
              <SecondaryButton testID="copy-servers" title="Copy list" onPress={copyList} disabled={servers().length === 0} />
              <SecondaryButton testID="add-from-clipboard" title="Add from clipboard" onPress={addFromClipboard} />
            </View>
          </Group>

          <View class="overflow-hidden rounded-(--radius) border border-border bg-card">
            <NavRow testID="open-security" title="Security" icon="shield" hint="App PIN, quick unlock, fingerprint and auto-lock" onPress={() => nav.push({ name: "security" })} />
            <NavRow testID="open-about" title="About" icon="info" hint="What this app is, and that it is unofficial" onPress={showAbout} />
          </View>
        </View>
      </Screen>
    </AppPage>
  );
}
