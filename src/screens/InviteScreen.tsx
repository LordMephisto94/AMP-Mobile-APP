import { signal, Text, View } from "nsh";
import { createInvite, listRoles, type Role } from "../api/access";
import { AmpError } from "../api/client";
import { Screen } from "../components/backdrop";
import { Checkbox, AppPage, ErrorText, Field, PrimaryButton, SecondaryButton } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, clientLater, serverById } from "../state/servers";
import { copySecret } from "../lib/links";

const EXPIRY = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 720, label: "30 days" },
];

/** A one-time invite: the person it's for sets their own password from the link. */
export function InviteScreen(props: { serverId: string }) {
  const server = serverById(props.serverId);
  const roles = signal<Role[] | null>(null);
  const userName = signal("");
  const displayName = signal("");
  const roleIds = signal<string[]>([]);
  const hours = signal(72);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const created = signal<{ userName: string; link: string } | null>(null);

  clientLater(props.serverId)
    .then(listRoles)
    .then((r) => roles.set(r))
    .catch(() => roles.set([]));

  const toggleRole = (id: string) => roleIds.set(roleIds().includes(id) ? roleIds().filter((r) => r !== id) : [...roleIds(), id]);

  const submit = async () => {
    error.set(null);
    if (!userName().trim()) return error.set("Enter the username their account will have.");
    if (roleIds().length === 0) return error.set("Pick at least one role: an account with none can't do anything.");
    busy.set(true);
    try {
      const result = await createInvite(clientFor(props.serverId), {
        userName: userName().trim(),
        displayName: displayName().trim(),
        roleIds: roleIds(),
        expiresInHours: hours(),
      });
      created.set({ userName: result.invite.userName, link: result.link });
    } catch (e) {
      error.set(e instanceof AmpError && e.status === 403 ? "Your AMP account can't send invites (or give those roles)." : (e as Error).message);
    } finally {
      busy.set(false);
    }
  };

  return (
    <AppPage title="New invite" subtitle={server?.name ?? ""}>
      <Screen>
        <View class="w-full max-w-2xl gap-4 self-center p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          <If
            when={created()}
            else={
              <>
                <Text class="text-sm text-muted-foreground">
                  The link lets one person set up the account themselves, with their own password. It works once.
                </Text>
                <If when={error()}>{(m) => <ErrorText message={m()} />}</If>
                <View class="gap-4 rounded-(--radius) border border-border bg-card p-4">
                  <Field testID="invite-username" label="Username" value={userName()} onChange={(v) => userName.set(v)} hint="The account they'll get." />
                  <Field testID="invite-display-name" label="Display name" value={displayName()} onChange={(v) => displayName.set(v)} placeholder="Optional" />
                </View>
                <View class="gap-2 rounded-(--radius) border border-border bg-card p-4">
                  <Text class="text-xs font-semibold tracking-widest text-muted-foreground">ROLES</Text>
                  <If when={roles()?.length === 0}>
                    <Text class="text-sm text-muted-foreground">No roles to give. Create one in the web panel first.</Text>
                  </If>
                  <Each of={roles() ?? []} key={(r: Role) => r.id}>
                    {(r) => (
                      <View>
                        <Checkbox testID={`invite-role-${r().name}`} label={r().name || "Unnamed role"} checked={roleIds().includes(r().id)} onChange={() => toggleRole(r().id)} />
                      </View>
                    )}
                  </Each>
                </View>
                <View class="gap-2 rounded-(--radius) border border-border bg-card p-4">
                  <Text class="text-xs font-semibold tracking-widest text-muted-foreground">LINK EXPIRES AFTER</Text>
                  <View class="flex-row flex-wrap gap-2">
                    <Each of={EXPIRY}>
                      {(e) => (
                        <Text
                          role="button"
                          testID={`expiry-${e().hours}`}
                          onPress={() => hours.set(e().hours)}
                          class={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                            hours() === e().hours ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/60 text-muted-foreground"
                          }`}
                        >
                          {e().label}
                        </Text>
                      )}
                    </Each>
                  </View>
                </View>
                <PrimaryButton title={busy() ? "Creating…" : "Create invite"} onPress={submit} disabled={busy()} />
              </>
            }
          >
            {(c) => <InviteLink userName={c().userName} link={c().link} onDone={() => nav.pop()} />}
          </If>
        </View>
      </Screen>
    </AppPage>
  );
}

/** A just-made invite link, shown once (AMP keeps only a hash of it), with copy. */
export function InviteLink(props: { userName: string; link: string; onDone: () => void }) {
  const copied = signal(false);
  const copy = async () => {
    try {
      // The link is a password in all but name: it leaves the clipboard after a minute.
      await copySecret(props.link);
      copied.set(true);
    } catch {
      // no clipboard here
    }
  };
  return (
    <View class="gap-3 rounded-(--radius) border border-primary/40 bg-primary/10 p-4">
      <Text class="text-base font-semibold text-card-foreground">{`Invite link for ${props.userName}`}</Text>
      <Text class="text-sm text-muted-foreground">Copy it now and send it to them. It can't be shown again, and it's cleared from your clipboard after a minute.</Text>
      <Text testID="invite-link" class="rounded-lg bg-muted p-3 font-mono text-xs text-info">{props.link}</Text>
      <View class="flex-row gap-2">
        <SecondaryButton testID="copy-invite" title={copied() ? "Copied" : "Copy link"} tone={copied() ? "success" : "default"} onPress={copy} />
        <SecondaryButton testID="invite-done" title="Done" onPress={props.onDone} />
      </View>
    </View>
  );
}
