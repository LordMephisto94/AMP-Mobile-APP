import type { AmpClient } from "./client";
import type { DeployedShard } from "./types";

// ---- Templates (the app catalogue) ---------------------------------------------------

/** The parts of `AppSpec.metadata` (`SpecMetadata`) the app shows. */
export interface SpecMetadata {
  displayName?: string;
  description?: string;
  displayImageSource?: string;
  author?: string;
  url?: string;
  deprecatedReason?: string;
  noCommercialUsage?: boolean;
  dockerRequired?: boolean;
  eulaLocation?: string;
  extraSetupStepsURI?: string;
}

/** The parts of an `AppSpec` (a template) the app uses. */
export interface AppSpec {
  id?: string;
  templateSlug: string;
  metadata?: SpecMetadata;
}

/**
 * `GET /api/Templates`: the merged app catalogue. Each entry is a whole template (settings,
 * stages, ...), so this is a large response: fetch it once per screen. 409 with an
 * `ApiError` when no template source has synced yet.
 */
export function listTemplates(client: AmpClient): Promise<AppSpec[]> {
  return client.request<AppSpec[]>("/api/Templates", { timeoutMs: 60_000 });
}

// ---- Spires (machines) -----------------------------------------------------------------

/** The parts of `SpireDefinition` the app uses. */
export interface SpireDefinition {
  id: string;
  displayName?: string;
  description?: string;
  isLocal?: boolean;
  canHostShards?: boolean;
  acceptsNewShards?: boolean;
  isPublicEntryNode?: boolean;
}

/** `GET /api/Spires`: the machines the caller can see. */
export function listSpires(client: AmpClient): Promise<SpireDefinition[]> {
  return client.request<SpireDefinition[]>("/api/Spires");
}

/** Machines a new instance may be placed on. */
export function placeableSpires(spires: SpireDefinition[]): SpireDefinition[] {
  return spires.filter((s) => s.acceptsNewShards !== false && s.canHostShards !== false && !s.isPublicEntryNode);
}

// ---- Creating ----------------------------------------------------------------------------

/** `CreateShardBody`. */
export interface CreateShardBody {
  templateSlug: string;
  displayName: string;
  description: string;
  /** null: the tenant's default local spire. */
  spireId: string | null;
  /** Run the first update now and start once it succeeds. */
  startNow: boolean;
  startOnBoot: boolean;
  credentialId?: string | null;
}

/** The parts of `CreateShardResult` the app uses. */
export interface CreateShardResult {
  shard?: DeployedShard;
  overLicenceLimit?: boolean;
}

/** `POST /api/Shards`: needs `shards.create` on the target spire. */
export function createShard(client: AmpClient, body: CreateShardBody): Promise<CreateShardResult> {
  return client.request<CreateShardResult>("/api/Shards", { method: "POST", body, timeoutMs: 60_000 });
}

// ---- Editing -----------------------------------------------------------------------------

/** `PATCH /api/Shards/{id}`: the instance's own labels; omitted fields stay. Needs `infra.write`. */
export function patchShard(
  client: AmpClient,
  id: string,
  body: { displayName?: string | null; description?: string | null; tags?: string[] | null },
): Promise<DeployedShard> {
  return client.request<DeployedShard>(`/api/Shards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { displayName: null, description: null, tags: null, ...body },
  });
}

/** `GET /api/Shards/{id}`. */
export function getShard(client: AmpClient, id: string): Promise<DeployedShard> {
  return client.request<DeployedShard>(`/api/Shards/${encodeURIComponent(id)}`);
}

/** `SettingSpec`: how a template setting is shown and checked. */
export interface SettingSpec {
  fieldName: string;
  displayName?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  inputType?: string;
  placeholder?: string;
  suffix?: string;
  order?: number;
  required?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
  isSecret?: boolean;
  conditionSetting?: string;
  conditionValue?: string;
  defaultValue?: string | null;
  /** Stored value → display label. */
  enumValues?: Record<string, string> | null;
  minValue?: number | string | null;
  maxValue?: number | string | null;
  isHostCap?: boolean;
  maxLength?: number;
  keywords?: string;
}

/** `EffectiveSetting`: a setting and its current value (passwords masked). */
export interface EffectiveSetting {
  spec: SettingSpec;
  value: string;
}

/** `GET /api/Shards/{id}/settings`: hidden settings are left out. Needs `settings.read`. */
export function getShardSettings(client: AmpClient, id: string): Promise<EffectiveSetting[]> {
  return client.request<EffectiveSetting[]>(`/api/Shards/${encodeURIComponent(id)}/settings`);
}

/**
 * `PATCH /api/Shards/{id}/settings`: field name → new value, changed keys only. The whole
 * patch is refused (403) if any key is not writable, and 400 on a value out of bounds.
 */
export async function patchShardSettings(client: AmpClient, id: string, values: Record<string, string>): Promise<void> {
  await client.request<void>(`/api/Shards/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: values });
}

/**
 * `GET /api/Shards/{id}/settings/locale`: the template's own translations, keyed by
 * language. Setting names and descriptions may be keys into it.
 */
export function getSettingsLocale(client: AmpClient, id: string): Promise<Record<string, unknown>> {
  return client.request<Record<string, unknown>>(`/api/Shards/${encodeURIComponent(id)}/settings/locale`);
}

/** Resolves a template string that may be a key into its locale table (dotted or flat). */
export function localize(locale: Record<string, unknown> | null, text: string | undefined): string {
  if (!text) return "";
  const table = (locale?.en ?? locale?.["en-US"] ?? null) as Record<string, unknown> | null;
  if (!table) return text;
  if (typeof table[text] === "string") return table[text] as string;
  let node: unknown = table;
  for (const part of text.split(".")) {
    if (!node || typeof node !== "object") return text;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : text;
}

/** How the panel classifies a setting's input type. */
export type SettingKind =
  | "text"
  | "password"
  | "number"
  | "checkbox"
  | "select"
  | "combo"
  | "quantity"
  | "ipbinding"
  | "multiline"
  | "list"
  | "credential";

export function settingKind(inputType: string | undefined): SettingKind {
  const type = (inputType ?? "").toLowerCase();
  if (type.startsWith("credential:")) return "credential";
  switch (type) {
    case "password":
      return "password";
    case "number":
    case "slider":
      return "number";
    case "checkbox":
      return "checkbox";
    case "select":
    case "enum":
      return "select";
    case "combo":
      return "combo";
    case "quantity":
      return "quantity";
    case "ipbinding":
      return "ipbinding";
    case "multiline":
    case "textarea":
      return "multiline";
    case "list":
      return "list";
    default:
      return "text";
  }
}

/** A checkbox is on when its value is the template's `True` value, else the text `true`. */
export function isChecked(spec: SettingSpec, value: string): boolean {
  const values = spec.enumValues;
  return values && "True" in values ? value === values.True : value.toLowerCase() === "true";
}

export function checkboxValue(spec: SettingSpec, on: boolean): string {
  const values = spec.enumValues;
  if (values && "True" in values && "False" in values) return on ? values.True : values.False;
  return on ? "True" : "False";
}

/** A list setting's value is a JSON array of strings. */
export function listItems(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value ? [value] : [];
  }
}

/** Why a value is not allowed, or null. */
export function validateSetting(spec: SettingSpec, value: string): string | null {
  const kind = settingKind(spec.inputType);
  if (spec.required && !value.trim()) return "Required";
  if ((kind === "number" || kind === "quantity") && value.trim()) {
    const n = Number(value);
    if (Number.isNaN(n)) return "Must be a number";
    if (spec.minValue != null && n < Number(spec.minValue)) return `At least ${spec.minValue}`;
    if (spec.maxValue != null && n > Number(spec.maxValue)) {
      return spec.isHostCap ? `Capped at ${spec.maxValue} by the host` : `At most ${spec.maxValue}`;
    }
  }
  if (spec.maxLength != null && spec.maxLength >= 0 && value.length > spec.maxLength) return `At most ${spec.maxLength} characters`;
  return null;
}
