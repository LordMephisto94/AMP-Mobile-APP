import { type JSX, Scroll, signal, Text, View } from "nsh";
import { Popover } from "nsh/base";
import { PrivText } from "../lib/privacy";
import { Icon, type IconName } from "./Icon";

export interface DropdownItem {
  id: string;
  label: string;
  /** An icon before the label. */
  icon?: IconName;
  /** `danger` items are red and set apart below a divider. */
  tone?: "default" | "danger";
  hint?: string;
  /** Shown greyed out, not pressable (with `hint` saying why, ideally). */
  disabled?: boolean;
  /** The current choice of a select: ticked and highlighted. */
  selected?: boolean;
  onSelect: () => void;
}

/**
 * The app's own dropdown menu: a glassy card anchored under its trigger, which fades and
 * scales in, instead of the system's action sheet. Pressing outside or Back closes it.
 * Controlled: pass `open` and `onOpenChange` (so a long press elsewhere can open it too).
 */
export function Dropdown(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: JSX.Element;
  items: DropdownItem[];
  title?: string;
  testID?: string;
  /** How the menu lines up with its trigger (default: right edges). */
  align?: "start" | "center" | "end";
  /** Make the menu at least as wide as its trigger (selects). */
  matchWidth?: boolean;
}) {
  const triggerWidth = signal(0);
  // Long lists (a select with many choices) scroll inside the menu.
  const scrolls = () => props.items.length > 8;
  const normal = () => props.items.filter((i) => i.tone !== "danger");
  const danger = () => props.items.filter((i) => i.tone === "danger");

  const pick = (item: DropdownItem) => {
    if (item.disabled) return;
    props.onOpenChange(false);
    item.onSelect();
  };

  return (
    <Popover
      open={props.open}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      placement="bottom"
      align={props.align ?? "end"}
      offset={6}
      margin={12}
      popupStyle={props.matchWidth && triggerWidth() > 0 ? { minWidth: triggerWidth() } : undefined}
      popupClass="min-w-56 overflow-hidden rounded-2xl border border-white/10 bg-popover/95 py-1.5 shadow-2xl backdrop-blur-xl transition-all duration-150 ease-out"
      popupStartingClass="opacity-0 scale-95 -translate-y-1"
      popupEndingClass="opacity-0 scale-95 -translate-y-1"
      trigger={
        <View onLayout={(e) => triggerWidth.set(e.bounds.size.width)}>
          {props.trigger}
        </View>
      }
    >
      <View testID={props.testID} class={scrolls() ? "max-h-80" : ""}>
        <If when={props.title}>
          {(t) => (
            <PrivText box="px-4 pt-1.5 pb-2" class="line-clamp-1 text-xs font-semibold tracking-wider text-muted-foreground" text={t().toUpperCase()} />
          )}
        </If>
        <If
          when={scrolls()}
          else={
            <Each of={normal()} key={(i: DropdownItem) => i.id}>
              {(item) => <DropdownRow item={item()} onPress={() => pick(item())} />}
            </Each>
          }
        >
          <Scroll class="max-h-72">
            <Each of={normal()} key={(i: DropdownItem) => i.id}>
              {(item) => <DropdownRow item={item()} onPress={() => pick(item())} />}
            </Each>
          </Scroll>
        </If>
        <If when={danger().length > 0 && normal().length > 0}>
          <View class="mx-3 my-1.5 h-px bg-white/10" />
        </If>
        <Each of={danger()} key={(i: DropdownItem) => i.id}>
          {(item) => <DropdownRow item={item()} onPress={() => pick(item())} />}
        </Each>
      </View>
    </Popover>
  );
}

function DropdownRow(props: { item: DropdownItem; onPress: () => void }) {
  const danger = () => props.item.tone === "danger";
  return (
    <View
      role="menuitem"
      testID={`menu-${props.item.id}`}
      onPress={props.onPress}
      class={`mx-1.5 flex-row items-center gap-3 rounded-xl px-3 py-2.5 ${
        props.item.disabled ? "opacity-40" : danger() ? "active:bg-destructive/15" : "active:bg-accent"
      } ${props.item.selected ? "bg-primary/15" : ""}`}
    >
      <If when={props.item.icon}>
        {(icon) => <Icon name={icon()} size={20} tone={danger() ? "destructive" : "foreground"} />}
      </If>
      <View class="flex-1">
        <Text class={`text-[15px] font-medium ${danger() ? "text-destructive" : "text-popover-foreground"}`}>{props.item.label}</Text>
        <If when={props.item.hint}>{(h) => <Text class="text-xs text-muted-foreground">{h()}</Text>}</If>
      </View>
      <If when={props.item.selected}>
        <Icon name="check" size={18} tone="primary" />
      </If>
    </View>
  );
}

/** The round "more" button menus open from. */
export function MoreButton(props: { onPress?: () => void; testID?: string; class?: string }) {
  return (
    <View
      role="button"
      accessibilityLabel="More actions"
      testID={props.testID}
      onPress={props.onPress}
      class={`h-9 w-9 items-center justify-center rounded-full bg-black/30 active:bg-black/50 ${props.class ?? ""}`}
    >
      <Icon name="more" size={20} tone="white" />
    </View>
  );
}

/**
 * A choice field drawn as the app's dropdown: a field showing the current choice and a
 * chevron, opening a menu of the options with the current one ticked.
 */
export function Select(props: {
  value: string;
  options: { value: string; label: string; hint?: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Extra classes for the field (its border colour, say). */
  class?: string;
  testID?: string;
  title?: string;
}) {
  const open = signal(false);
  const current = () => props.options.find((o) => o.value === props.value);
  return (
    <Dropdown
      open={open()}
      onOpenChange={(o) => open.set(!props.disabled && o)}
      align="start"
      matchWidth
      title={props.title}
      items={props.options.map((o) => ({
        id: o.value,
        label: o.label || o.value,
        hint: o.hint,
        disabled: o.disabled,
        selected: o.value === props.value,
        onSelect: () => props.onChange(o.value),
      }))}
      trigger={
        <View
          role="button"
          testID={props.testID}
          class={`flex-row items-center gap-2 rounded-lg border px-3.5 py-2.5 ${props.disabled ? "opacity-60" : "active:bg-accent"} ${
            props.class ?? "border-input bg-background/60"
          }`}
        >
          <Text class={`flex-1 text-base ${current() ? "text-foreground" : "text-muted-foreground"}`}>
            {current()?.label || props.value || props.placeholder || "Choose…"}
          </Text>
          <Icon name={open() ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
        </View>
      }
    />
  );
}
