import { Clipboard, type JSX, Scroll, signal, Text, View } from "nsh";
import { confirm } from "../components/Confirm";
import { Icon, type IconName } from "../components/Icon";
import { AppPage, ChoiceChip, ErrorText, SecondaryButton } from "../components/ui";
import { formatBytes, formatRate } from "../lib/units";
import { setSizeUnits, setSpeedUnits, sizeUnits, speedUnits } from "../state/prefs";
import { addServersFromList, parseServerList, serverListText, servers } from "../state/servers";

function Card(props: { title: string; icon: IconName; children?: JSX.Element }) {
  return (
    <View class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
      <View class="flex-row items-center gap-2">
        <Icon name={props.icon} size={18} tone="primary" />
        <Text class="text-base font-semibold text-card-foreground">{props.title}</Text>
      </View>
      {props.children}
    </View>
  );
}

/** The app's own settings: how sizes and speeds read, and the server list carried to another phone. */
export function AppSettingsScreen() {
  const notice = signal<string | null>(null);
  const error = signal<string | null>(null);

  const copyList = async () => {
    notice.set(null);
    error.set(null);
    try {
      await Clipboard.writeText(serverListText());
      const n = servers().length;
      notice.set(`Copied ${n} server${n === 1 ? "" : "s"}. Passwords and sign-ins aren't included.`);
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
      message: `They're added signed out, and you sign in to each.${plain ? ` ${plain} use plain HTTP, which isn't encrypted.` : ""}`,
      icon: "plus",
      actions: [{ id: "add", label: "Add", tone: "primary" }],
    });
    if (choice !== "add") return;
    const result = await addServersFromList(parsed.entries);
    notice.set(`Added ${result.added}.${result.skipped ? ` ${result.skipped} already saved.` : ""}`);
  };

  return (
    <AppPage title="Settings" subtitle="This app on this device">
      <Scroll class="flex-1 bg-background">
        <View class="w-full max-w-2xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+32px)]">
          <If when={notice()}>
            {(m) => (
              <View class="rounded-(--radius) border border-success/30 bg-success/10 px-3.5 py-3">
                <Text testID="settings-notice" class="text-sm text-success">{m()}</Text>
              </View>
            )}
          </If>
          <If when={error()}>{(m) => <ErrorText message={m()} />}</If>

          <Card title="Units" icon="sliders">
            <View class="gap-2">
              <Text class="text-sm font-semibold text-card-foreground">Sizes</Text>
              <Text class="text-xs text-muted-foreground">Counted in 1024s as AMP does (KB, MB, GB), or in 1000s as disk makers do (kB, MB, GB).</Text>
              <View class="flex-row flex-wrap gap-2">
                <ChoiceChip testID="size-binary" label="1024s, as AMP" on={sizeUnits() === "binary"} onPress={() => setSizeUnits("binary")} />
                <ChoiceChip testID="size-decimal" label="1000s" on={sizeUnits() === "decimal"} onPress={() => setSizeUnits("decimal")} />
              </View>
            </View>
            <View class="gap-2 border-t border-white/5 pt-3">
              <Text class="text-sm font-semibold text-card-foreground">Network speed</Text>
              <Text class="text-xs text-muted-foreground">Bytes match file sizes. Bits match how internet plans are sold.</Text>
              <View class="flex-row flex-wrap gap-2">
                <ChoiceChip testID="speed-bytes" label="Bytes per second" on={speedUnits() === "bytes"} onPress={() => setSpeedUnits("bytes")} />
                <ChoiceChip testID="speed-bits" label="Bits per second" on={speedUnits() === "bits"} onPress={() => setSpeedUnits("bits")} />
              </View>
            </View>
            <Text testID="units-example" class="text-xs text-muted-foreground">
              {`Example: ${formatBytes(1.5 * 1024 ** 3)} of memory, ${formatRate(1250)} of traffic`}
            </Text>
          </Card>

          <Card title="Server list" icon="copy">
            <Text class="text-sm text-muted-foreground">
              Carry your servers to another phone as text: names, addresses and user names. Passwords and sign-ins are never included.
            </Text>
            <View class="flex-row flex-wrap gap-2">
              <SecondaryButton testID="copy-servers" title="Copy list" onPress={copyList} disabled={servers().length === 0} />
              <SecondaryButton testID="add-from-clipboard" title="Add from clipboard" onPress={addFromClipboard} />
            </View>
          </Card>
        </View>
      </Scroll>
    </AppPage>
  );
}
