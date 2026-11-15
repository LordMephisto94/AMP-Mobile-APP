import { shownAddress } from "../state/prefs";
import { signal, Text, View } from "nsh";
import { Screen } from "../components/backdrop";
import { changeExpiredPassword, login, passwordRules } from "../api/auth";
import { AmpClient, type HostKind, hostKind, normalizeServerUrl } from "../api/client";
import { AppPage, Checkbox, ErrorText, Field, PrimaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { addServer, serverById, setServerSession } from "../state/servers";

const SCHEMES = [
  { id: "https", label: "https (encrypted)" },
  { id: "http", label: "http (not encrypted)" },
] as const;

/** What plain http exposes, by where the address sits. */
const HTTP_WARNING: Record<HostKind | "unknown", string> = {
  tailscale:
    "This looks like a Tailscale address. Tailscale encrypts the connection, so plain http is reasonable here. For a certificate, run tailscale serve on the AMP machine and use its https address ending in .ts.net.",
  private: "This is a private network address. Anyone on that network can read your password and session.",
  public: "This address is on the public internet. Anyone between you and the server can read your password and session. Use https unless you control the whole path.",
  unknown: "Plain http sends your password and session without encryption.",
};

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
  /** The account must set a new password before it can sign in (AMP's hold). */
  const mustChange = signal<{ reason?: string; rules: string | null } | null>(null);
  const newPassword = signal("");
  const repeatPassword = signal("");
  const error = signal<string | null>(null);
  /** The scheme a bare address gets. A typed `http://` or `https://` wins and moves this to match. */
  const scheme = signal<"https" | "http">(existing?.serverUrl.startsWith("http://") ? "http" : "https");
  /** The user confirmed they want to connect without encryption (asked for every new http server). */
  const accepted = signal(false);
  const plainHttp = () => adding && scheme() === "http";

  const setScheme = (id: "https" | "http") => {
    scheme.set(id);
    accepted.set(false);
    // An address that already carries a scheme follows the choice, so the two never disagree.
    server.set(server().replace(/^https?:\/\//i, `${id}://`));
  };
  const typeAddress = (v: string) => {
    server.set(v);
    const typed = /^(https?):\/\//i.exec(v.trim())?.[1].toLowerCase();
    if (typed && typed !== scheme()) {
      scheme.set(typed as "https" | "http");
      accepted.set(false);
    }
  };
  const kind = (): HostKind | null => {
    try {
      return hostKind(normalizeServerUrl(server(), "http"));
    } catch {
      return null;
    }
  };

  const submit = async () => {
    error.set(null);
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(server(), scheme());
    } catch (e) {
      error.set((e as Error).message);
      return;
    }
    if (adding && serverUrl.startsWith("http://") && !accepted()) {
      error.set("Tick the box to confirm you want to connect without encryption.");
      return;
    }
    const user = username().trim();
    if (!user || !password()) {
      error.set("Enter your username and password");
      return;
    }

    busy.set(true);
    try {
      const client = new AmpClient(serverUrl);
      let outcome;
      if (mustChange()) {
        if (!newPassword()) {
          error.set("Enter a new password");
          return;
        }
        if (newPassword() !== repeatPassword()) {
          error.set("The new passwords don't match");
          return;
        }
        if (newPassword() === password()) {
          error.set("Choose a password different from the current one");
          return;
        }
        outcome = await changeExpiredPassword(client, {
          username: user,
          currentPassword: password(),
          newPassword: newPassword(),
          rememberMe: rememberMe(),
        });
      } else {
        outcome = await login(client, { username: user, password: password(), rememberMe: rememberMe() });
      }
      if (outcome.kind === "signedIn") {
        newPassword.set("");
        repeatPassword.set("");
        mustChange.set(null);
        password.set("");
        let id: string;
        if (existing) {
          id = existing.id;
          await setServerSession(id, user, outcome.auth, rememberMe());
        } else {
          id = await addServer({ name: name(), serverUrl, username: user, auth: outcome.auth, rememberMe: rememberMe() });
        }
        // Only if this form is still showing: going back mid-sign-in must not replace the home screen.
        const top = nav.routes().at(-1);
        if (top?.name === "addServer" || top?.name === "signIn") nav.replace({ name: "shards", serverId: id });
      } else if (outcome.kind === "passwordChangeRequired") {
        // AMP holds this account until it sets a new password: ask for one here.
        mustChange.set({ reason: outcome.reason, rules: await passwordRules(client) });
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
                : `Your session on ${shownAddress(existing!.serverUrl.replace(/^https?:\/\//, ""))} has ended. Sign in again.`}
            </Text>
          </View>

          <View class="gap-4 rounded-(--radius) border border-border bg-card p-4">
            <If when={adding}>
              <Field
                testID="name"
                label="Name"
                value={name()}
                onChange={(v) => name.set(v)}
                placeholder="My game server"
                hint="Optional. Defaults to the server's address."
              />
              <View class="gap-1.5">
                <Text class="text-sm font-semibold text-foreground">Connection</Text>
                <View class="flex-row flex-wrap gap-2">
                  <Each of={SCHEMES}>
                    {(o) => (
                      <Text
                        role="button"
                        testID={`scheme-${o().id}`}
                        accessibilityLabel={`${o().label}${scheme() === o().id ? ", selected" : ""}`}
                        onPress={() => setScheme(o().id)}
                        class={`rounded-(--radius) border px-3.5 py-2 text-sm font-semibold ${
                          scheme() === o().id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/60 text-muted-foreground"
                        }`}
                      >
                        {o().label}
                      </Text>
                    )}
                  </Each>
                </View>
              </View>
              <Field
                testID="server"
                label="Server address"
                value={server()}
                onChange={typeAddress}
                placeholder="panel.example.com"
                keyboardType="url"
                hint={`${scheme()}:// is added if you leave it out.`}
              />
            </If>
            <Field testID="username" label="Username" value={username()} onChange={(v) => username.set(v)} />
            <Field testID="password" label="Password" value={password()} onChange={(v) => password.set(v)} masked />
            <Checkbox label="Stay signed in" checked={rememberMe()} onChange={(v) => rememberMe.set(v)} />
          </View>

          <If when={plainHttp()}>
            <View class="gap-3 rounded-(--radius) border border-warning/40 bg-warning/10 p-4">
              <Text class="text-base font-semibold text-warning">This connection is not encrypted</Text>
              <Text testID="http-warning" class="text-sm text-muted-foreground">
                {HTTP_WARNING[kind() ?? "unknown"]}
              </Text>
              <Checkbox testID="accept-http" label="I understand and want to connect without encryption" checked={accepted()} onChange={(v) => accepted.set(v)} />
            </View>
          </If>

          <If when={mustChange()}>
            {(m) => (
              <View class="gap-4 rounded-(--radius) border border-warning/40 bg-warning/10 p-4">
                <View class="gap-1">
                  <Text class="text-base font-semibold text-warning">Set a new password</Text>
                  <Text class="text-sm text-muted-foreground">
                    {`AMP needs this account to change its password before signing in${m().reason ? ` (${m().reason})` : ""}. The password above is your current one.`}
                  </Text>
                </View>
                <Field
                  testID="new-password"
                  label="New password"
                  value={newPassword()}
                  onChange={(v) => newPassword.set(v)}
                  masked
                  hint={m().rules ?? undefined}
                />
                <Field testID="repeat-password" label="New password again" value={repeatPassword()} onChange={(v) => repeatPassword.set(v)} masked />
              </View>
            )}
          </If>

          <If when={error()}>{(message) => <ErrorText message={message()} />}</If>

          <PrimaryButton
            title={busy() ? "Connecting…" : mustChange() ? "Change password and sign in" : adding ? "Add Server" : "Sign in"}
            onPress={submit}
            disabled={busy()}
          />
        </View>
      </Screen>
    </AppPage>
  );
}
