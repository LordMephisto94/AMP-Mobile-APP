import { effect, lifecycle, signal, Text, View } from "nsh";
import { confirm } from "./Confirm";
import { Icon } from "./Icon";
import {
  crashWatch,
  openAlertSettings,
  refreshCrashWatch,
  requestAlertPermission,
  unwatchServer,
  watchServer,
} from "../lib/crashWatch";
import { type SavedServer, servers, sessionOf } from "../state/servers";

/**
 * Security's crash alerts: one switch per server. Turning one on asks for the notification
 * permission, and says once what it costs: a sign-in kept outside the PIN for the checks.
 */
export function CrashAlertsCard() {
  const busy = signal<string | null>(null);
  const error = signal<string | null>(null);
  // Asked again on return: the permission may have been changed in the phone's settings.
  effect(() => {
    if (lifecycle() === "active") refreshCrashWatch();
  });

  const turnOn = async (server: SavedServer) => {
    const session = sessionOf(server);
    if (!session) return;
    let permission = crashWatch().permission;
    if (permission !== "granted") permission = await requestAlertPermission();
    if (permission !== "granted") {
      const choice = await confirm({
        title: "Notifications are off",
        message: "AMP Mobile isn't allowed to show notifications. Turn them on in the phone's settings, then come back.",
        icon: "bell",
        actions: [{ id: "settings", label: "Open settings", tone: "primary" }],
      });
      if (choice === "settings") await openAlertSettings();
      return;
    }
    if (crashWatch().watched.length === 0) {
      const choice = await confirm({
        title: "Turn on crash alerts?",
        message:
          "To check while the app is closed, this phone keeps a copy of the server's sign-in that works without your PIN, sealed by its secure hardware. It's used only to read instance states and the activity log, about every 15 minutes (longer when the phone is idle). Signing out ends it.",
        icon: "bell",
        actions: [{ id: "on", label: "Turn on", tone: "primary" }],
      });
      if (choice !== "on") return;
    }
    await watchServer(server, session);
  };

  const toggle = async (server: SavedServer) => {
    if (busy()) return;
    busy.set(server.id);
    error.set(null);
    try {
      if (crashWatch().watched.includes(server.id)) await unwatchServer(server.id);
      else await turnOn(server);
    } catch (e) {
      error.set(`Crash alerts couldn't be turned on: ${String((e as Error)?.message ?? e).replace(/^\w+:\s*/, "")}`);
    } finally {
      busy.set(null);
    }
  };

  /** Why a server's switch can't be turned on, or what state its alerts are in. */
  const note = (server: SavedServer): string => {
    const state = crashWatch();
    if (state.paused.includes(server.id)) return "Paused: AMP ended the session. Sign in again to resume.";
    if (state.watched.includes(server.id)) return "On";
    if (!server.rememberMe) return "Needs “Stay signed in” for this server.";
    if (!sessionOf(server)) return "Sign in to turn it on.";
    return "Off";
  };
  const canTurnOn = (server: SavedServer) => crashWatch().watched.includes(server.id) || (server.rememberMe && sessionOf(server) !== null);

  return (
    <If when={crashWatch().available}>
      <View testID="crash-alerts" class="gap-3 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
        <View class="flex-row items-center gap-2">
          <Icon name="bell" size={18} tone="primary" />
          <Text class="text-base font-semibold text-card-foreground">Crash alerts</Text>
        </View>
        <Text class="text-sm text-muted-foreground">
          A notification when an instance stops, fails to start or restarts with no one behind it: no person or schedule acted on it in AMP's
          activity log. Checked about every 15 minutes, while the app is closed too.
        </Text>
        <If when={crashWatch().permission === "denied"}>
          <View class="flex-row items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
            <Icon name="warning" size={16} tone="warning" />
            <Text class="flex-1 text-xs text-warning">Notifications are off for AMP Mobile in the phone's settings.</Text>
            <Text role="button" testID="crash-alerts-settings" onPress={() => openAlertSettings()} class="text-xs font-semibold text-primary">
              Settings
            </Text>
          </View>
        </If>
        <If when={servers().length === 0}>
          <Text class="text-sm text-muted-foreground">Add a server first.</Text>
        </If>
        <Each of={servers()} key={(s: SavedServer) => s.id}>
          {(server) => {
            const on = () => crashWatch().watched.includes(server().id);
            return (
              <View class="flex-row items-center gap-3 border-t border-white/5 pt-3">
                <View class="min-w-0 flex-1 gap-0.5">
                  <Text class="line-clamp-1 text-sm font-semibold text-card-foreground">{server().name}</Text>
                  <Text class={`text-xs ${crashWatch().paused.includes(server().id) ? "text-warning" : "text-muted-foreground"}`}>{note(server())}</Text>
                </View>
                <View
                  role="switch"
                  testID={`crash-alerts-${server().name}`}
                  accessibilityLabel={`Crash alerts for ${server().name}`}
                  onPress={() => canTurnOn(server()) && toggle(server())}
                  class={`h-7 w-12 justify-center rounded-full px-0.5 ${on() ? "items-end bg-primary" : "items-start bg-white/15"} ${
                    busy() === server().id || !canTurnOn(server()) ? "opacity-50" : ""
                  }`}
                >
                  <View class="h-6 w-6 rounded-full bg-white" />
                </View>
              </View>
            );
          }}
        </Each>
        <If when={error()}>{(m) => <Text testID="crash-alerts-error" class="text-sm text-destructive">{m()}</Text>}</If>
      </View>
    </If>
  );
}
