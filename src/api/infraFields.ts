import { containerModes, type SettingSpec, type ShardInfraContext, type ShardInfraSettings } from "./manage";

/**
 * The infrastructure settings the app edits, described as `SettingSpec`s so the same
 * controls draw them as the template's app settings. Values travel as strings in the
 * form and are converted back to their types when saved.
 *
 * Left to the web panel: extra environment variables, the container image override,
 * swap, and analytics retention time.
 */
type FieldType = "bool" | "int" | "number" | "text" | "select" | "countries";

interface InfraField {
  key: keyof ShardInfraSettings;
  type: FieldType;
  group: string;
  label: string;
  description?: string;
  suffix?: string;
  min?: number;
  max?: (c: ShardInfraContext) => number | undefined;
  show?: (c: ShardInfraContext, value: (key: keyof ShardInfraSettings) => string) => boolean;
}

const STARTUP = "Startup";
const ADDRESS = "Connection address";
const RESOURCES = "Container and limits";
const ANALYTICS = "Analytics";
const GEO = "Geo-filtering";

const containerised = (value: (key: keyof ShardInfraSettings) => string) => value("containerMode") !== "Native";

export const INFRA_FIELDS: InfraField[] = [
  { key: "startOnBoot", type: "bool", group: STARTUP, label: "Start when the machine boots" },
  {
    key: "autoRestartOnCrash",
    type: "bool",
    group: STARTUP,
    label: "Restart after a crash",
    description: "If it exits unexpectedly after running for at least 5 minutes, start it again.",
  },
  {
    key: "startupOrder",
    type: "int",
    group: STARTUP,
    label: "Startup order",
    description: "Lower numbers start first on boot, one at a time. Default 100.",
    min: 0,
  },
  {
    key: "sleepMode",
    type: "bool",
    group: STARTUP,
    label: "Sleep while empty",
    description: "Stop while nobody is connected, keep the ports, and wake when someone connects.",
    show: (c) => c.supportsSleep,
  },
  {
    key: "advertisedAddress",
    type: "text",
    group: ADDRESS,
    label: "Advertised address",
    description: "What players are told to connect to, e.g. play.example.com. Empty: AMP works it out.",
  },
  {
    key: "advertisedAddressIncludesPort",
    type: "bool",
    group: ADDRESS,
    label: "Add the port to the address",
    description: "Turn off when an SRV record or a proxy routes players to the port.",
    show: (_, v) => v("advertisedAddress").trim() !== "",
  },
  { key: "containerMode", type: "select", group: RESOURCES, label: "Run as" },
  {
    key: "memoryLimitMb",
    type: "int",
    group: RESOURCES,
    label: "Memory limit",
    description: "0 = unlimited.",
    suffix: "MB",
    min: 0,
    show: (_, v) => containerised(v),
  },
  {
    key: "memoryReservationMb",
    type: "int",
    group: RESOURCES,
    label: "Memory reservation",
    description: "A soft limit, no more than the memory limit. 0 = none.",
    suffix: "MB",
    min: 0,
    show: (_, v) => containerised(v),
  },
  {
    key: "cpuLimit",
    type: "number",
    group: RESOURCES,
    label: "CPU limit",
    description: "In cores, fractions allowed. 0 = unlimited.",
    suffix: "cores",
    min: 0,
    max: (c) => (c.logicalCores > 0 ? c.logicalCores : undefined),
    show: (_, v) => containerised(v),
  },
  {
    key: "diskLimitMb",
    type: "int",
    group: RESOURCES,
    label: "Disk budget",
    description: "For the instance's files. 0 = no limit.",
    suffix: "MB",
    min: 0,
  },
  {
    key: "maxUsersCap",
    type: "int",
    group: RESOURCES,
    label: "Player cap",
    description: "A hard ceiling AMP enforces whatever the game's own setting says. 0 = none.",
    min: 0,
  },
  {
    key: "importConfigFilesFromSftp",
    type: "bool",
    group: RESOURCES,
    label: "Read config files changed over SFTP back into settings",
  },
  {
    key: "enableAnalytics",
    type: "bool",
    group: ANALYTICS,
    label: "Enable analytics",
    description: "Collect data about players who join.",
    show: (c) => c.tracksUsers,
  },
  {
    key: "userSpecificData",
    type: "bool",
    group: ANALYTICS,
    label: "Store per-player data",
    description: "Lets you see individual players' time on the server. You may need to tell players you collect it.",
    show: (c, v) => c.tracksUsers && v("enableAnalytics") === "true",
  },
  {
    key: "enableGeoFiltering",
    type: "bool",
    group: GEO,
    label: "Enable geo-filtering",
    description: "Disconnect players from countries this instance doesn't accept.",
    show: (c) => c.reportsAddresses,
  },
  {
    key: "blockedCountries",
    type: "countries",
    group: GEO,
    label: "Blocked countries",
    description: "Two-letter codes, separated by commas (e.g. CN, RU).",
    show: (c, v) => c.reportsAddresses && v("enableGeoFiltering") === "true",
  },
  {
    key: "allowedCountries",
    type: "countries",
    group: GEO,
    label: "Allowed countries",
    description: "Empty allows every country not blocked.",
    show: (c, v) => c.reportsAddresses && v("enableGeoFiltering") === "true",
  },
  {
    key: "blockUnknownCountries",
    type: "bool",
    group: GEO,
    label: "Also block unknown countries",
    show: (c, v) => c.reportsAddresses && v("enableGeoFiltering") === "true",
  },
  {
    key: "geoFilterKickMessage",
    type: "text",
    group: GEO,
    label: "Filtering message",
    description: "{CountryCode} and {CountryName} are filled in.",
    show: (c, v) => c.reportsAddresses && v("enableGeoFiltering") === "true",
  },
  {
    key: "geoFilterKickCommand",
    type: "text",
    group: GEO,
    label: "Kick command",
    description: "The console command that disconnects a player: {UserName}, {UserID} and {Reason} are filled in.",
    show: (c, v) => c.reportsAddresses && v("enableGeoFiltering") === "true",
  },
];

const BOOL_VALUES = { True: "true", False: "false" };

/** The field as a `SettingSpec`, for the setting controls. */
export function infraSpec(field: InfraField, context: ShardInfraContext): SettingSpec {
  const base: SettingSpec = {
    fieldName: `infra.${field.key}`,
    displayName: field.label,
    description: field.description,
    suffix: field.suffix,
    minValue: field.min ?? null,
    maxValue: field.max?.(context) ?? null,
  };
  switch (field.type) {
    case "bool":
      return { ...base, inputType: "checkbox", enumValues: BOOL_VALUES };
    case "int":
    case "number":
      return { ...base, inputType: "number" };
    case "select":
      return {
        ...base,
        inputType: "enum",
        enumValues: Object.fromEntries(containerModes(context).map((m) => [m.value, m.label])),
      };
    default:
      return { ...base, inputType: "text" };
  }
}

/** A stored value as the form's string. */
export function infraToString(field: InfraField, settings: ShardInfraSettings): string {
  const value = settings[field.key];
  if (field.type === "bool") return value ? "true" : "false";
  if (field.type === "countries") return Array.isArray(value) ? value.join(", ") : "";
  return value == null ? "" : String(value);
}

/** The form's string as the value `PATCH /infra` takes. */
export function infraFromString(field: InfraField, text: string): unknown {
  switch (field.type) {
    case "bool":
      return text === "true";
    case "int":
      return Math.round(Number(text || 0));
    case "number":
      return Number(text || 0);
    case "countries":
      return text
        .split(/[\s,]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c));
    default:
      return text;
  }
}

/** Checks a field beyond its min/max; null when fine. */
export function infraProblem(field: InfraField, text: string, value: (key: keyof ShardInfraSettings) => string): string | null {
  if (field.type === "countries") {
    const bad = text.split(/[\s,]+/).filter((c) => c.trim() && !/^[A-Za-z]{2}$/.test(c.trim()));
    if (bad.length) return `Not a two-letter country code: ${bad.join(", ")}`;
  }
  if (field.key === "memoryReservationMb") {
    const limit = Number(value("memoryLimitMb") || 0);
    if (limit > 0 && Number(text || 0) > limit) return "Can't be more than the memory limit";
  }
  if (field.type === "int" && text.trim() && !/^-?\d+$/.test(text.trim())) return "Must be a whole number";
  return null;
}

export type { InfraField };
