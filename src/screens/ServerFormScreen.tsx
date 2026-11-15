import { signal, Text, View } from "nsh";
import { Screen } from "../components/backdrop";
import { changeExpiredPassword, login, passwordRules } from "../api/auth";
import { AmpClient, isPlainHttp, normalizeServerUrl, plainHttpRisk } from "../api/client";
import { confirm } from "../components/Confirm";
import { AppPage, Checkbox, ErrorText, Field, PrimaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { addServer, serverById, setServerSession } from "../state/servers";
import { PrivText, priv } from "../lib/privacy";

/**
 * Adds a server (no `serverId`), or signs in again to a saved one. Either way the
 * credentials are checked against the server before anything is saved.
 */
export function ServerFormScreen(props: { serverId?: string }) {
  const existing = props.serverId ? serverById(props.serverId) : undefined;
  const adding = !existing;

  const name = signal(existing?.name ?? "");
  const server = signal(existing?.serverUrl ?? "");
  /** The typed (or saved) address, normalized; null while it isn't a valid one. */
  const address = () => {
    try {
      return normalizeServerUrl(server());
    } catch {
      return null;
    }
  };
  /** Plain HTTP inside Tailscale's tunnel: fine, with a word about why. */
  const plainTailscale = () => !!address() && isPlainHttp(address()!) && plainHttpRisk(address()!) === null;
  /** Plain HTTP that crosses a network unencrypted: "local" or "public", for the warning. */
  const risk = () => (address() ? plainHttpRisk(address()!) : null);
  /** The tick for a public plain-HTTP address; any change of address asks again. */
  const understood = signal(false);
  let understoodFor = "";
  const username = signal(existing?.username ?? "");
  const password = signal("");
  const rememberMe = signal(existing?.rememberMe ?? true);
  const busy = signal(false);
  /** The account must set a new password before it can sign in (AMP's hold). */
  const mustChange = signal<{ reason?: string; rules: string | null } | null>(null);
  const newPassword = signal("");
  const repeatPassword = signal("");
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
    // Plain HTTP outside Tailscale: a public address needs the tick, a local one a confirm, every time.
    const exposure = plainHttpRisk(serverUrl);
    if (exposure === "public" && !(understood() && understoodFor === serverUrl)) {
      error.set("Tick the box to confirm you understand your login will travel unencrypted, or use https://.");
      return;
    }
    if (exposure === "local") {
      const choice = await confirm({
        title: "Send your login unencrypted?",
        message:
          "This address uses plain HTTP. Your password and session token will cross your network unencrypted: any device on it (or whoever runs it) could read them and take over your panel. Use https:// when you can.",
        icon: "⚠️",
        tone: "danger",
        cancelLabel: "Cancel",
        actions: [{ id: "send", label: "Sign in anyway", tone: "danger" }],
      });
      if (choice !== "send") return;
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
            <PrivText class="text-sm text-muted-foreground" text={adding
                ? "Your AMP 3 panel must be reachable from this device. Your password is only sent to the server, never stored."
                : `Your session on ${priv(existing!.serverUrl.replace(/^https?:\/\//, ""))} has ended. Sign in again.`} />
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
                testID="server" personal
                label="Server address"
                value={server()}
                onChange={(v) => server.set(v)}
                placeholder="panel.example.com"
                keyboardType="url"
                hint={
                  plainTailscale()
                    ? "Plain HTTP over Tailscale: Tailscale encrypts the connection end to end. Your phone must be on the same tailnet."
                    : "https:// is added if you leave it out."
                }
              />
            </If>
            <Field testID="username" personal label="Username" value={username()} onChange={(v) => username.set(v)} />
            <Field testID="password" label="Password" value={password()} onChange={(v) => password.set(v)} masked />
            <Checkbox label="Stay signed in" checked={rememberMe()} onChange={(v) => rememberMe.set(v)} />
          </View>

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

          <If when={risk()}>
            {(level) => (
              <View testID="plain-http-warning" class="gap-2.5 rounded-(--radius) border border-destructive/50 bg-destructive/10 p-4">
                <Text class="text-base font-semibold text-destructive">⚠️ Not secure: plain HTTP</Text>
                <Text class="text-sm leading-5 text-card-foreground">
                  {level() === "public"
                    ? "This address is on the internet and uses plain HTTP. Your password and session token will travel unencrypted: anyone along the way (a public Wi-Fi, its owner, an internet provider) could read them and take over your panel, which can run commands on your server."
                    : "This address uses plain HTTP on your local network. Your password and session token will cross it unencrypted: any device on the network could read them."}
                </Text>
                <Text class="text-sm leading-5 text-muted-foreground">
                  Turn on HTTPS for the panel when you can (a certificate, a reverse proxy, or Tailscale), then sign in with https://.
                </Text>
                <If when={level() === "public"}>
                  <Checkbox
                    testID="plain-http-understood"
                    label="I understand my login can be stolen on the way"
                    checked={understood() && understoodFor === address()}
                    onChange={(v) => {
                      understoodFor = address() ?? "";
                      understood.set(v);
                    }}
                  />
                </If>
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
