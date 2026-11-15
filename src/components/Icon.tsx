import { Image, token } from "nsh";
import checkIcon from "../../assets/icons/check.svg";
import xIcon from "../../assets/icons/x.svg";
import plusIcon from "../../assets/icons/plus.svg";
import circleIcon from "../../assets/icons/circle.svg";
import dotIcon from "../../assets/icons/dot.svg";
import exclaimIcon from "../../assets/icons/exclaim.svg";
import infoIcon from "../../assets/icons/info.svg";
import warningIcon from "../../assets/icons/warning.svg";
import banIcon from "../../assets/icons/ban.svg";
import chevronDownIcon from "../../assets/icons/chevron-down.svg";
import chevronUpIcon from "../../assets/icons/chevron-up.svg";
import chevronRightIcon from "../../assets/icons/chevron-right.svg";
import chevronLeftIcon from "../../assets/icons/chevron-left.svg";
import moreIcon from "../../assets/icons/more.svg";
import arrowRightIcon from "../../assets/icons/arrow-right.svg";
import arrowUpIcon from "../../assets/icons/arrow-up.svg";
import arrowDownIcon from "../../assets/icons/arrow-down.svg";
import swapIcon from "../../assets/icons/swap.svg";
import cornerDownRightIcon from "../../assets/icons/corner-down-right.svg";
import caretUpIcon from "../../assets/icons/caret-up.svg";
import caretDownIcon from "../../assets/icons/caret-down.svg";
import backspaceIcon from "../../assets/icons/backspace.svg";
import searchIcon from "../../assets/icons/search.svg";
import trashIcon from "../../assets/icons/trash.svg";
import pencilIcon from "../../assets/icons/pencil.svg";
import noteIcon from "../../assets/icons/note.svg";
import fileIcon from "../../assets/icons/file.svg";
import fileTextIcon from "../../assets/icons/file-text.svg";
import folderIcon from "../../assets/icons/folder.svg";
import folderOpenIcon from "../../assets/icons/folder-open.svg";
import packageIcon from "../../assets/icons/package.svg";
import archiveIcon from "../../assets/icons/archive.svg";
import tagIcon from "../../assets/icons/tag.svg";
import copyIcon from "../../assets/icons/copy.svg";
import downloadIcon from "../../assets/icons/download.svg";
import uploadIcon from "../../assets/icons/upload.svg";
import saveIcon from "../../assets/icons/save.svg";
import userIcon from "../../assets/icons/user.svg";
import usersIcon from "../../assets/icons/users.svg";
import maskIcon from "../../assets/icons/mask.svg";
import mailIcon from "../../assets/icons/mail.svg";
import linkIcon from "../../assets/icons/link.svg";
import signOutIcon from "../../assets/icons/sign-out.svg";
import keyIcon from "../../assets/icons/key.svg";
import lockIcon from "../../assets/icons/lock.svg";
import bellIcon from "../../assets/icons/bell.svg";
import unlockIcon from "../../assets/icons/unlock.svg";
import fingerprintIcon from "../../assets/icons/fingerprint.svg";
import shieldIcon from "../../assets/icons/shield.svg";
import playIcon from "../../assets/icons/play.svg";
import pauseIcon from "../../assets/icons/pause.svg";
import stopIcon from "../../assets/icons/stop.svg";
import restartIcon from "../../assets/icons/restart.svg";
import powerIcon from "../../assets/icons/power.svg";
import updateIcon from "../../assets/icons/update.svg";
import sunIcon from "../../assets/icons/sun.svg";
import moonIcon from "../../assets/icons/moon.svg";
import gearIcon from "../../assets/icons/gear.svg";
import globeIcon from "../../assets/icons/globe.svg";
import plugIcon from "../../assets/icons/plug.svg";
import layersIcon from "../../assets/icons/layers.svg";
import cameraIcon from "../../assets/icons/camera.svg";
import restoreIcon from "../../assets/icons/restore.svg";
import undoIcon from "../../assets/icons/undo.svg";
import flameIcon from "../../assets/icons/flame.svg";
import pinIcon from "../../assets/icons/pin.svg";
import clockIcon from "../../assets/icons/clock.svg";
import timerIcon from "../../assets/icons/timer.svg";
import receiptIcon from "../../assets/icons/receipt.svg";
import chartIcon from "../../assets/icons/chart.svg";
import ramIcon from "../../assets/icons/ram.svg";
import chipIcon from "../../assets/icons/chip.svg";
import terminalIcon from "../../assets/icons/terminal.svg";
import monitorIcon from "../../assets/icons/monitor.svg";
import databaseIcon from "../../assets/icons/database.svg";
import routerIcon from "../../assets/icons/router.svg";
import signalIcon from "../../assets/icons/signal.svg";
import chatIcon from "../../assets/icons/chat.svg";
import codeIcon from "../../assets/icons/code.svg";
import cloudIcon from "../../assets/icons/cloud.svg";
import boltIcon from "../../assets/icons/bolt.svg";
import slidersIcon from "../../assets/icons/sliders.svg";
import wrenchIcon from "../../assets/icons/wrench.svg";
import hammerIcon from "../../assets/icons/hammer.svg";
import puzzleIcon from "../../assets/icons/puzzle.svg";
import mapIcon from "../../assets/icons/map.svg";
import mountainIcon from "../../assets/icons/mountain.svg";
import starIcon from "../../assets/icons/star.svg";
import trophyIcon from "../../assets/icons/trophy.svg";
import pawIcon from "../../assets/icons/paw.svg";
import sproutIcon from "../../assets/icons/sprout.svg";
import rocketIcon from "../../assets/icons/rocket.svg";
import paletteIcon from "../../assets/icons/palette.svg";
import speakerIcon from "../../assets/icons/speaker.svg";
import eyeIcon from "../../assets/icons/eye.svg";
import gamepadIcon from "../../assets/icons/gamepad.svg";
import joystickIcon from "../../assets/icons/joystick.svg";
import flaskIcon from "../../assets/icons/flask.svg";

/**
 * The app's own icons, in place of emoji: 24-point white line art in assets/icons (made by
 * scripts/make-icons.py), tinted to the text they sit with. One style everywhere, the same on every phone.
 */
const ICONS = {
  "check": checkIcon, // Done, selected, succeeded
  "x": xIcon, // Failed, closed
  "plus": plusIcon, // Add, new
  "circle": circleIcon, // Off, idle
  "dot": dotIcon, // A point in a list
  "exclaim": exclaimIcon, // Needs attention
  "info": infoIcon, // About, information
  "warning": warningIcon, // Warning, careful
  "ban": banIcon, // Revoke, blocked, suspended
  "chevron-down": chevronDownIcon, // Open (collapsed)
  "chevron-up": chevronUpIcon, // Close (expanded)
  "chevron-right": chevronRightIcon, // Go into
  "chevron-left": chevronLeftIcon, // Back
  "more": moreIcon, // More actions
  "arrow-right": arrowRightIcon, // Leads to
  "arrow-up": arrowUpIcon, // Up, sent
  "arrow-down": arrowDownIcon, // Down, received
  "swap": swapIcon, // Both ways (a tunnel)
  "corner-down-right": cornerDownRightIcon, // A step under another
  "caret-up": caretUpIcon, // Went up
  "caret-down": caretDownIcon, // Went down
  "backspace": backspaceIcon, // Delete a digit
  "search": searchIcon, // Search
  "trash": trashIcon, // Delete
  "pencil": pencilIcon, // Edit
  "note": noteIcon, // Edit a description, unsaved text
  "file": fileIcon, // A file
  "file-text": fileTextIcon, // A text file, a document
  "folder": folderIcon, // A folder
  "folder-open": folderOpenIcon, // Open a folder
  "package": packageIcon, // Any other file
  "archive": archiveIcon, // Zip, extract
  "tag": tagIcon, // Rename, label
  "copy": copyIcon, // Copy
  "download": downloadIcon, // Download
  "upload": uploadIcon, // Upload
  "save": saveIcon, // Save, backup
  "user": userIcon, // A person
  "users": usersIcon, // People, players
  "mask": maskIcon, // Acting as someone else
  "mail": mailIcon, // Invite
  "link": linkIcon, // A link
  "sign-out": signOutIcon, // Sign out
  "key": keyIcon, // Sign in, password
  "lock": lockIcon, // Locked, private, security
  "bell": bellIcon, // Notifications, crash alerts
  "unlock": unlockIcon, // Remove the lock
  "fingerprint": fingerprintIcon, // Fingerprint unlock
  "shield": shieldIcon, // Security, admin
  "play": playIcon, // Start, run, resume
  "pause": pauseIcon, // Pause
  "stop": stopIcon, // Stop
  "restart": restartIcon, // Restart, sync
  "power": powerIcon, // Power controls
  "update": updateIcon, // Update
  "sun": sunIcon, // Wake
  "moon": moonIcon, // Sleep
  "gear": gearIcon, // Settings, the system
  "globe": globeIcon, // An address on the internet, public
  "plug": plugIcon, // Publish, connect
  "layers": layersIcon, // Snapshots
  "camera": cameraIcon, // Take a snapshot
  "restore": restoreIcon, // Restore a snapshot
  "undo": undoIcon, // Bring back from deleted
  "flame": flameIcon, // Delete forever
  "pin": pinIcon, // Pinned
  "clock": clockIcon, // Schedules, scheduled
  "timer": timerIcon, // A timer
  "receipt": receiptIcon, // Run history
  "chart": chartIcon, // Charts, analytics
  "ram": ramIcon, // Memory in use
  "chip": chipIcon, // Memory, processor
  "terminal": terminalIcon, // Console
  "monitor": monitorIcon, // A server, a machine
  "database": databaseIcon, // Storage
  "router": routerIcon, // A router
  "signal": signalIcon, // Network signal
  "chat": chatIcon, // Chat
  "code": codeIcon, // Code
  "cloud": cloudIcon, // Cloud
  "bolt": boltIcon, // Speed, power
  "sliders": slidersIcon, // Tuning
  "wrench": wrenchIcon, // Build
  "hammer": hammerIcon, // Construction
  "puzzle": puzzleIcon, // Extensions, mods
  "map": mapIcon, // Map, world
  "mountain": mountainIcon, // Terrain
  "star": starIcon, // Featured
  "trophy": trophyIcon, // Events, rewards
  "paw": pawIcon, // Animals, pets
  "sprout": sproutIcon, // Farming
  "rocket": rocketIcon, // Launch
  "palette": paletteIcon, // Appearance
  "speaker": speakerIcon, // Sound
  "eye": eyeIcon, // Visibility
  "gamepad": gamepadIcon, // Games, instances
  "joystick": joystickIcon, // Play time
  "flask": flaskIcon, // Demo data
} as const;

export type IconName = keyof typeof ICONS;

/** Theme colours an icon can take, as the text classes of the same names. */
export type IconTone = "foreground" | "muted" | "primary" | "destructive" | "success" | "warning" | "white" | "on-primary";

const TONES: Record<Exclude<IconTone, "white">, Parameters<typeof token>[0]> = {
  foreground: "foreground",
  muted: "muted-foreground",
  primary: "primary",
  destructive: "destructive",
  success: "success",
  warning: "warning",
  "on-primary": "primary-foreground",
};

export function iconColor(tone: IconTone = "foreground"): string {
  return tone === "white" ? "#ffffff" : String(token(TONES[tone]));
}

/** An icon, `size` points square, tinted with a theme tone (or any `color`). */
export function Icon(props: { name: IconName; size?: number; tone?: IconTone; color?: string; label?: string; testID?: string }) {
  const size = () => props.size ?? 18;
  return (
    <Image
      src={ICONS[props.name]}
      testID={props.testID}
      accessibilityLabel={props.label}
      style={{ width: size(), height: size(), tintColor: props.color ?? iconColor(props.tone) }}
    />
  );
}

/** Whether a string names an icon (for values that come from data, such as a settings group's icon). */
export function isIconName(name: string | null | undefined): name is IconName {
  return !!name && Object.prototype.hasOwnProperty.call(ICONS, name);
}
