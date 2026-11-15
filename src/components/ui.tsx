import { Image, type JSX, Text, View } from "nsh";
import mark from "../../assets/amp-mark.png";
import { Button, Input, NavPage } from "nsh/base";
import { nav } from "../state/nav";
import { hideDetails, PrivText } from "../lib/privacy";
import { PageDepth, pageDepthHere } from "./backdrop";
import { Icon, type IconName, type IconTone } from "./Icon";

/** The app's main call to action: a violet-to-pink gradient button. */
export function PrimaryButton(props: { title: string; onPress: () => void; disabled?: boolean; icon?: IconName }) {
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
        {(icon) => <Icon name={icon()} size={20} tone={props.disabled ? "muted" : "white"} />}
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
  /** A personal detail (an address, a name, an email): blurred while "Hide personal details" is on. */
  personal?: boolean;
}) {
  return (
    <View class="gap-1.5">
      <Text class="text-sm font-semibold text-foreground">{props.label}</Text>
      {/* Border and padding on a wrapper: Android's text field doesn't inset its text by its own padding. */}
      <View class={`rounded-(--radius) border border-input bg-card px-3.5 py-3 ${props.personal && hideDetails() ? "blur-[3px]" : ""}`}>
        <Input
          testID={props.testID}
          value={props.value}
          onChange={({ value }) => props.onChange(value)}
          placeholder={props.placeholder}
          masked={props.masked}
          keyboardType={props.keyboardType ?? "default"}
          autoCapitalize="none"
          // Addresses, user names and passwords: the keyboard shouldn't correct or learn them.
          autoCorrect={false}
          class="p-0 text-base text-foreground placeholder:text-muted-foreground"
        />
      </View>
      <If when={props.hint}>{(hint) => <Text class="text-xs text-muted-foreground">{hint()}</Text>}</If>
    </View>
  );
}

/** A tappable checkbox with a label. */
export function Checkbox(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; testID?: string }) {
  return (
    <View role="checkbox" testID={props.testID} onPress={() => props.onChange(!props.checked)} class="flex-row items-center gap-3 py-1">
      <View
        class={`h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${props.checked ? "border-primary bg-primary" : "border-input bg-card"}`}
      >
        <If when={props.checked}>
          <Icon name="check" size={15} tone="on-primary" />
        </If>
      </View>
      {/* shrink: a long label wraps inside its card instead of running past it. */}
      <Text class="shrink text-base text-foreground">{props.label}</Text>
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
const PILL_TONES: Record<"success" | "muted" | "warning" | "danger", IconTone> = { success: "success", muted: "muted", warning: "warning", danger: "destructive" };

export function Pill(props: { label: string; tone: "success" | "muted" | "warning" | "danger"; icon?: IconName }) {
  const classes = () =>
    ({
      success: ["bg-success/15", "text-success"],
      muted: ["bg-muted", "text-muted-foreground"],
      warning: ["bg-warning/15", "text-warning"],
      danger: ["bg-destructive/15", "text-destructive"],
    })[props.tone];
  return (
    <View class={`flex-row items-center gap-1 self-start rounded-full px-2.5 py-1 ${classes()[0]}`}>
      <If when={props.icon}>{(i) => <Icon name={i()} size={12} tone={PILL_TONES[props.tone]} />}</If>
      <Text class={`text-xs font-semibold ${classes()[1]}`}>{props.label}</Text>
    </View>
  );
}

/**
 * The app's own top bar, on every platform (the system's is hidden): room for the status
 * bar, a round back button when there's somewhere to go back to, the AMP mark, the title
 * and an optional subtitle, and an optional control on the right.
 */
export function PageHeader(props: { title: string; subtitle?: string; right?: JSX.Element; onBack?: () => void }) {
  return (
    <View class="flex-row items-center gap-3 border-b border-white/10 bg-card/85 px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2.5 shadow-lg">
      <If when={nav.routes().length > 1}>
        <View
          role="button"
          accessibilityLabel="Back"
          testID="back"
          onPress={() => (props.onBack ? props.onBack() : nav.pop())}
          class="h-10 w-10 items-center justify-center rounded-full bg-primary/15 active:bg-primary/30"
        >
          <Icon name="chevron-left" size={22} tone="primary" />
        </View>
      </If>
      <Image src={mark} accessibilityLabel="AMP" class="h-6 w-6 object-contain" />
      <View class="flex-1">
        <PrivText class="line-clamp-1 text-[17px] font-semibold text-foreground" text={props.title} />
        <If when={props.subtitle}>{(s) => <PrivText class="line-clamp-1 text-xs text-muted-foreground" text={s()} />}</If>
      </View>
      {props.right}
    </View>
  );
}

/**
 * A page of the navigation stack with the app's own header instead of the system's bar
 * (which Android and iOS would draw grey). Back gestures and Android's back button still
 * work; `onBack` with `popOnBack={false}` lets a page ask first.
 */
export function AppPage(props: {
  title: string;
  subtitle?: string;
  right?: JSX.Element;
  /** false: the system back (Android's button, iOS swipe) doesn't pop the page; `onBack` decides. */
  popOnBack?: boolean;
  /** Replaces the plain pop for the header's back button, and for the system back while `popOnBack` is false. */
  onBack?: () => void;
  children?: JSX.Element;
}) {
  const depth = pageDepthHere();
  return (
    <NavPage
      title={props.title}
      headerVisible={false}
      popOnBack={props.popOnBack}
      onBackPress={() => {
        if (props.popOnBack === false) props.onBack?.();
      }}
    >
      <PageDepth.Provider value={depth}>
        <View class="flex-1 bg-background">
          <PageHeader title={props.title} subtitle={props.subtitle} right={props.right} onBack={props.onBack} />
          <View class="flex-1">{props.children}</View>
        </View>
      </PageDepth.Provider>
    </NavPage>
  );
}

/**
 * A round choice chip (one of a few options). The padding sits on a view around the label:
 * a padded text alone is measured a letter short and clips its last word.
 */
export function ChoiceChip(props: { label: string; on: boolean; onPress: () => void; disabled?: boolean; testID?: string; large?: boolean; bg?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      onPress={() => !props.disabled && props.onPress()}
      class={`rounded-full border px-3.5 ${props.large ? "py-2" : "py-1.5"} ${props.on ? "border-primary bg-primary" : `border-white/10 ${props.bg ?? "bg-background/60"}`} ${
        props.disabled ? "opacity-40" : ""
      }`}
    >
      <Text class={`${props.large ? "text-sm" : "text-xs"} font-semibold ${props.on ? "text-primary-foreground" : "text-muted-foreground"}`}>{props.label}</Text>
    </View>
  );
}
