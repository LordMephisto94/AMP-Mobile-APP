import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { PrimaryButton, SecondaryButton } from "./ui";

export interface PromptRequest {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirm: string;
  /** Returns an error to show, or nothing to close. */
  onSubmit: (value: string) => Promise<string | void> | string | void;
}

/**
 * A small text prompt laid over the page (the system's alert has no text field). Show one
 * by setting the `request` signal; it clears it when done.
 */
export function Prompt(props: { request: PromptRequest | null; onClose: () => void }) {
  const value = signal("");
  const error = signal<string | null>(null);
  const busy = signal(false);
  let shownFor: PromptRequest | null = null;

  const sync = () => {
    if (props.request && props.request !== shownFor) {
      shownFor = props.request;
      value.set(props.request.value ?? "");
      error.set(null);
    }
    return props.request;
  };

  const submit = async () => {
    const request = props.request;
    if (!request || busy()) return;
    busy.set(true);
    try {
      const problem = await request.onSubmit(value().trim());
      if (problem) error.set(problem);
      else props.onClose();
    } catch (e) {
      error.set((e as Error).message);
    } finally {
      busy.set(false);
    }
  };

  return (
    <If when={sync()}>
      {(request) => (
        <View class="absolute inset-0 justify-center bg-black/60 px-6 pb-[env(keyboard-inset-height)]">
          <View class="gap-3 rounded-(--radius) border border-white/10 bg-popover p-5 shadow-2xl">
            <Text class="text-lg font-semibold text-popover-foreground">{request().title}</Text>
            <If when={request().message}>{(m) => <Text class="text-sm text-muted-foreground">{m()}</Text>}</If>
            <Input
              testID="prompt-input"
              value={value()}
              onChange={({ value: v }) => value.set(v)}
              onSubmit={submit}
              submitBehavior="submit"
              placeholder={request().placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              class="rounded-lg border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground"
            />
            <If when={error()}>{(m) => <Text class="text-sm text-destructive">{m()}</Text>}</If>
            <View class="flex-row gap-3 pt-1">
              <SecondaryButton title="Cancel" onPress={props.onClose} disabled={busy()} />
              <View class="flex-1">
                <PrimaryButton title={busy() ? "Working…" : request().confirm} onPress={submit} disabled={busy()} />
              </View>
            </View>
          </View>
        </View>
      )}
    </If>
  );
}
