import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { AmpError } from "../api/client";
import { readText, writeText } from "../api/files";
import { Backdrop } from "../components/backdrop";
import { confirm } from "../components/Confirm";
import { AppPage, ErrorText } from "../components/ui";
import { nav } from "../state/nav";
import { clientFor, serverById } from "../state/servers";
import { sessionRejected } from "../lib/session";

/** Files larger than this open read-only: a phone's text field isn't a place for them. */
const MAX_EDIT_CHARS = 1_000_000;

/**
 * Edits a text file. AMP-managed files are flagged: `generated` ones are rewritten on every
 * start, so they open read-only; in `merged` ones AMP owns some values.
 */
/**
 * Unsaved edits, by file, in memory only (never on disk): the lock clears the app's pages,
 * and this brings the edit back when the file is opened again after unlocking.
 */
const drafts = new Map<string, string>();

export function FileEditScreen(props: { serverId: string; id: string; path: string; managed?: string | null }) {
  // By account too: someone else signing in to the same server mustn't get this edit back.
  const draftKey = `${props.serverId}\n${serverById(props.serverId)?.username ?? ""}\n${props.id}\n${props.path}`;
  const restored = signal(false);
  const original = signal<string | null>(null);
  const text = signal("");
  const error = signal<string | null>(null);
  const saving = signal(false);
  const saved = signal(false);
  const name = props.path.split("/").at(-1) ?? props.path;

  const fail = async (e: unknown) => {
    if (e instanceof AmpError && e.isUnauthorized) {
      await sessionRejected(props.serverId);
    } else if (e instanceof AmpError && e.status === 403) {
      error.set("Your account isn't allowed to open or change this file.");
    } else {
      error.set((e as Error).message);
    }
  };

  (async () => {
    try {
      const content = await readText(clientFor(props.serverId), props.id, props.path);
      original.set(content);
      const draft = drafts.get(draftKey);
      if (draft !== undefined && draft !== content) {
        text.set(draft);
        restored.set(true);
      } else {
        drafts.delete(draftKey);
        text.set(content);
      }
    } catch (e) {
      await fail(e);
    }
  })();

  const tooBig = () => (original()?.length ?? 0) > MAX_EDIT_CHARS;
  const readOnly = () => props.managed === "generated" || tooBig() || original() === null;
  const dirty = () => original() !== null && text() !== original();

  const save = async () => {
    if (!dirty() || saving() || readOnly()) return;
    saving.set(true);
    error.set(null);
    // What was sent is what's saved: typing during the save stays unsaved.
    const sent = text();
    try {
      await writeText(clientFor(props.serverId), props.id, props.path, sent);
      original.set(sent);
      if (text() === sent) drafts.delete(draftKey);
      saved.set(true);
    } catch (e) {
      await fail(e);
    } finally {
      saving.set(false);
    }
  };

  const leave = async () => {
    if (!dirty()) return true;
    const action = await confirm({
      title: "Discard your changes?",
      message: `${name} has unsaved changes.`,
      icon: "note",
      tone: "danger",
      cancelLabel: "Keep editing",
      actions: [{ id: "discard", label: "Discard", tone: "danger" }],
    });
    return action === "discard";
  };

  const SaveButton = () => (
    <Text
      role="button"
      testID="save-file"
      onPress={save}
      class={`text-base font-semibold ${dirty() && !saving() ? "text-primary" : "text-muted-foreground"}`}
    >
      {saving() ? "Saving…" : "Save"}
    </Text>
  );

  return (
    <AppPage
      title={name}
      subtitle={`/${props.path}`}
      right={<SaveButton />}
      popOnBack={!dirty()}
      onBack={async () => {
        // leave() is true straight away when nothing is unsaved.
        if (await leave()) {
          drafts.delete(draftKey);
          original.set(text());
          nav.pop();
        }
      }}
    >
      <View class="flex-1 bg-background">
        <Backdrop dim="strong" />
        <If when={error()}>
          {(m) => (
            <View class="px-4 pt-3">
              <ErrorText message={m()} />
            </View>
          )}
        </If>
        <If when={props.managed === "generated"}>
          <Text class="px-4 pt-3 text-xs text-warning">AMP rewrites this file from the instance's settings on every start, so it's read-only here. Change the settings instead.</Text>
        </If>
        <If when={props.managed === "merged"}>
          <Text class="px-4 pt-3 text-xs text-warning">AMP writes some values in this file from the instance's settings; edits to those may be replaced.</Text>
        </If>
        <If when={tooBig()}>
          <Text class="px-4 pt-3 text-xs text-warning">This file is too large to edit on a phone; it's shown read-only.</Text>
        </If>
        <If when={restored() && dirty()}>
          <Text testID="draft-restored" class="px-4 pt-3 text-xs text-warning">Your unsaved changes were kept while the app was locked. Save or go back to discard them.</Text>
        </If>
        <If when={saved() && !dirty()}>
          <Text class="px-4 pt-3 text-xs text-success">Saved.</Text>
        </If>
        <If
          when={original() !== null}
          else={
            <If when={!error()}>
              <Text class="p-4 text-sm text-muted-foreground">Loading…</Text>
            </If>
          }
        >
          <View class="flex-1 pb-[env(safe-area-inset-bottom)]">
            <View class="flex-1 px-3 pt-3 pb-[calc(env(keyboard-inset-height)+12px)]">
              <View class="flex-1 rounded-lg border border-input bg-black/50 p-3">
                <Input
                  testID="file-content"
                  multiline
                  value={text()}
                  onChange={({ value }) => {
                    saved.set(false);
                    text.set(value);
                    if (original() !== null && value !== original()) drafts.set(draftKey, value);
                    else drafts.delete(draftKey);
                  }}
                  readonly={readOnly()}
                  autoCapitalize="none"
                  autoCorrect={false}
                  class="p-0 flex-1 font-mono text-xs leading-5 text-foreground"
                />
              </View>
            </View>
          </View>
        </If>
      </View>
    </AppPage>
  );
}
