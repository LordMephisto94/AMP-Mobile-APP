import { Image, type JSX, Text, View } from "nsh";
import mark from "../../assets/amp-mark.png";
import { Button, Input } from "nsh/base";
import { nav } from "../state/nav";

/** The app's main call to action: a violet-to-pink gradient button. */
export function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean; icon?: string }) {
  return (
    <Button
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={`flex-row items-center justify-center gap-2 rounded-(--radius) px-5 py-3.5 ${
        props.disabled ? "bg-muted" : "bg-linear-to-r from-hero-from to-hero-to shadow-md active:opacity-85"
      }`}
    >
      <If when={props.icon}>
        {(icon) => <Text class={`text-lg ${props.disabled ? "text-muted-foreground" : "text-white"}`}>{icon()}</Text>}
      </If>
      <Text class={`text-base font-semibold ${props.disabled ? "text-muted-foreground" : "text-white"}`}>
        {props.title}
      </Text>
    </Button>
  );
}

/** A quieter button for secondary actions. */
export function SecondaryButton(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "success" | "warning" | "danger";
  testID?: string;
}) {
  const tone = () =>
    ({
      default: ["bg-secondary", "text-secondary-foreground"],
      success: ["bg-success/15", "text-success"],
      warning: ["bg-warning/15", "text-warning"],
      danger: ["bg-destructive/15", "text-destructive"],
    })[props.tone ?? "default"];
  return (
    <Button
      testID={props.testID}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={`flex-1 items-center rounded-(--radius) px-4 py-3 active:opacity-70 ${props.disabled ? "opacity-50" : ""} ${tone()[0]}`}
    >
      <Text class={`text-base font-semibold ${tone()[1]}`}>{props.title}</Text>
    </Button>
  );
}

/** A labelled single-line text field. */
export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  masked?: boolean;
  keyboardType?: "default" | "url" | "email-address";
  testID?: string;
}) {
  return (
    <View class="gap-1.5">
      <Text class="text-sm font-semibold text-foreground">{props.label}</Text>
      <Input
        testID={props.testID}
        value={props.value}
        onChange={({ value }) => props.onChange(value)}
        placeholder={props.placeholder}
        masked={props.masked}
        keyboardType={props.keyboardType ?? "default"}
        autoCapitalize="none"
        class="rounded-(--radius) border border-input bg-card px-3.5 py-3 text-base text-foreground placeholder:text-muted-foreground"
      />
      <If when={props.hint}>{(hint) => <Text class="text-xs text-muted-foreground">{hint()}</Text>}</If>
    </View>
  );
}

/** A tappable checkbox with a label. */
export function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <View role="checkbox" onPress={() => props.onChange(!props.checked)} class="flex-row items-center gap-3 py-1">
      <View
        class={`h-6 w-6 items-center justify-center rounded-md border-2 ${props.checked ? "border-primary bg-primary" : "border-input bg-card"}`}
      >
        <If when={props.checked}>
          <Text class="text-sm font-bold text-primary-foreground">✓</Text>
        </If>
      </View>
      <Text class="text-base text-foreground">{props.label}</Text>
    </View>
  );
}

/** An error message in a tinted box. */
export function ErrorText(props: { message: string }) {
  return (
    <View class="rounded-(--radius) border border-destructive/30 bg-destructive/10 px-3.5 py-3">
      <Text class="text-sm text-destructive">{props.message}</Text>
    </View>
  );
}

/** A small coloured status pill. */
export function Pill(props: { label: string; tone: "success" | "muted" | "warning" | "danger" }) {
  const classes = () =>
    ({
      success: ["bg-success/15", "text-success"],
      muted: ["bg-muted", "text-muted-foreground"],
      warning: ["bg-warning/15", "text-warning"],
      danger: ["bg-destructive/15", "text-destructive"],
    })[props.tone];
  return (
    <View class={`self-start rounded-full px-2.5 py-1 ${classes()[0]}`}>
      <Text class={`text-xs font-semibold ${classes()[1]}`}>{props.label}</Text>
    </View>
  );
}

/**
 * The header the desktops and the web show above a page (phones use the system
 * header instead), with a back button when there is a page to go back to.
 */
export function PageHeader(props: { title: string; subtitle?: string; right?: JSX.Element }) {
  return (
    <View class="flex-row items-center gap-3 border-b border-white/10 bg-card/90 px-4 py-3">
      <If when={nav.routes().length > 1}>
        <Text onPress={() => nav.pop()} class="text-base font-semibold text-primary">
          ‹ Back
        </Text>
      </If>
      <Image src={mark} accessibilityLabel="AMP" class="h-6 w-6 object-contain" />
      <View class="flex-1">
        <Text class="text-lg font-semibold text-foreground">{props.title}</Text>
        <If when={props.subtitle}>{(s) => <Text class="text-xs text-muted-foreground">{s()}</Text>}</If>
      </View>
      {props.right}
    </View>
  );
}
