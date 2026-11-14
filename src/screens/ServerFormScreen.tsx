import { signal, Text, View } from "nsh";
import { Screen } from "../components/backdrop";
import { login } from "../api/auth";
import { AmpClient, normalizeServerUrl } from "../api/client";
import { AppPage, Checkbox, ErrorText, Field, PrimaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { addServer, serverById, setServerSession } from "../state/servers";

/**
 * Adds a server (no `serverId`), or signs in again to a saved one. Either way the
 * credentials are checked against the server before anything is saved.
 */
export function ServerFormScreen(props: { serverId?: string }) {
  const existing = props.serverId ? serverById(props.serverId) : undefined;
  const adding = !existing;

  const name = signal(existing?.name ?? "");
  const server = signal(existing?.serverUrl ?? "");
  const username = signal(existing?.username ?? "");
  const password = signal("");
  const rememberMe = signal(existing?.rememberMe ?? true);
  const busy = signal(false);
  const error = signal<string | null>(null);

  const submit = async () => {
    error.set(null);
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(server());
    } catch (e) {
      error.set((e as Error).message);
      return;
    }
    const user = username().trim();
    if (!user || !password()) {
      error.set("Enter your username and password");
      return;
    }

    busy.set(true);
    try {
      const outcome = await login(new AmpClient(serverUrl), { username: user, password: password(), rememberMe: rememberMe() });
      if (outcome.kind === "signedIn") {
        password.set("");
        let id: string;
        if (existing) {
          id = existing.id;
          await setServerSession(id, user, outcome.auth, rememberMe());
        } else {
          id = await addServer({ name: name(), serverUrl, username: user, auth: outcome.auth, rememberMe: rememberMe() });
        }
        nav.replace({ name: "shards", serverId: id });
      } else if (outcome.kind === "passwordChangeRequired") {
        // TODO: forced password change flow (POST /api/Auth/change-expired-password).
        error.set(`Your password must be changed first${outcome.reason ? ` (${outcome.reason})` : ""}. Use the web panel for now.`);
      } else {
        // TODO: passkey sign-in (POST /api/auth/passkey/begin + complete).
        error.set("This account signs in with a passkey, which the app doesn't support yet.");
      }
    } catch (e) {
      error.set((e as Error).message);
    } finally {
      busy.set(false);
    }
  };

  const title = adding ? "Add Server" : `Sign in to ${existing!.name}`;

  return (
    <AppPage title={title}>
      <Screen>
        <View class="w-full max-w-2xl gap-5 self-center px-5 pt-8 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <View class="gap-1">
            <Text class="text-2xl font-bold text-foreground">{adding ? "Connect a server" : existing!.name}</Text>
            <Text class="text-sm text-muted-foreground">
              {adding
                ? "Your AMP 3 panel must be reachable from this device. Your password is only sent to the server, never stored."
                : `Your session on ${existing!.serverUrl.replace(/^https?:\/\//, "")} has ended. Sign in again.`}
            </Text>
          </View>

          <View class="gap-4 rounded-(--radius) border border-white/10 bg-card/85 p-4 shadow-lg">
            <If when={adding}>
              <Field
                testID="name"
                label="Name"
                value={name()}
                onChange={(v) => name.set(v)}
                placeholder="My game server"
                hint="Optional. Defaults to the server's address."
              />
              <Field
                testID="server"
                label="Server address"
                value={server()}
                onChange={(v) => server.set(v)}
                placeholder="panel.example.com"
                keyboardType="url"
                hint="https:// is added if you leave it out."
              />
            </If>
            <Field testID="username" label="Username" value={username()} onChange={(v) => username.set(v)} />
            <Field testID="password" label="Password" value={password()} onChange={(v) => password.set(v)} masked />
            <Checkbox label="Stay signed in" checked={rememberMe()} onChange={(v) => rememberMe.set(v)} />
          </View>

          <If when={error()}>{(message) => <ErrorText message={message()} />}</If>

          <PrimaryButton
            title={busy() ? "Connecting…" : adding ? "Add Server" : "Sign in"}
            onPress={submit}
            disabled={busy()}
          />
        </View>
      </Screen>
    </AppPage>
  );
}
