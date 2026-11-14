import type { ShardPowerAction } from "../api/shards";
import { ApplicationState, type ShardState, stateTone } from "../api/types";
import { confirm } from "./Confirm";
import type { DropdownItem } from "./Dropdown";

/**
 * An instance's controls as dropdown items, enabled by its state as the panel would:
 * Start when stopped or failed; Restart and Stop while it runs (asking first, since
 * players get disconnected); Sleep while running, Wake while asleep; Update any time it
 * isn't mid-task (asking first).
 */
export function powerItems(options: {
  title: string;
  state: ShardState | null;
  busy: boolean;
  run: (action: ShardPowerAction) => void;
}): DropdownItem[] {
  const { title, state, busy, run } = options;
  const tone = stateTone(state);
  const known = state !== null && !busy;
  const players = state?.metrics?.activeConnections ?? 0;
  const running = tone === "running" || tone === "busy" || tone === "attention";
  const sleeping = state?.status === ApplicationState.Sleeping;
  const playersNote = players > 0 ? ` ${players} player${players === 1 ? " is" : "s are"} connected and will be disconnected.` : "";

  const ask = async (action: ShardPowerAction, verb: string, message: string, icon: string, danger: boolean) => {
    const choice = await confirm({
      title: `${verb} ${title}?`,
      message,
      icon,
      tone: danger ? "danger" : "default",
      actions: [{ id: action, label: verb, tone: danger ? "danger" : "primary" }],
    });
    if (choice === action) run(action);
  };

  const items: DropdownItem[] = [
    {
      id: "start",
      label: "Start",
      icon: "▶️",
      disabled: !known || !(tone === "stopped" || tone === "error") || sleeping,
      hint: running ? "Already running" : sleeping ? "Asleep: use Wake" : undefined,
      onSelect: () => run("start"),
    },
    {
      id: "restart",
      label: "Restart",
      icon: "🔄",
      disabled: !known || !running,
      onSelect: () => ask("restart", "Restart", `It stops and starts again.${playersNote}`, "🔄", false),
    },
  ];

  if (sleeping) {
    items.push({ id: "wake", label: "Wake", icon: "☀️", disabled: !known, onSelect: () => run("wake") });
  } else {
    items.push({
      id: "sleep",
      label: "Sleep",
      icon: "🌙",
      hint: "Stops until someone connects",
      disabled: !known || state?.status !== ApplicationState.RunningReady,
      onSelect: () => run("sleep"),
    });
  }

  items.push(
    {
      id: "update",
      label: "Update",
      icon: "⬆️",
      hint: "Runs the game's update",
      disabled: !known || tone === "busy" || !!state?.activeTaskId,
      onSelect: () =>
        ask(
          "update",
          "Update",
          `AMP runs the game's update task${running ? ", which may stop it while it updates" : ""}.${playersNote}`,
          "⬆️",
          false,
        ),
    },
    {
      id: "stop",
      label: "Stop",
      icon: "⏹️",
      tone: "danger",
      disabled: !known || !running,
      onSelect: () => ask("stop", "Stop", `The game server shuts down.${playersNote}`, "⏹️", true),
    },
  );
  return items;
}
