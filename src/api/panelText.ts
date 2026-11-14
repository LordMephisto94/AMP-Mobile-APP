import type { AmpClient } from "./client";

/**
 * The panel's own English wording (`<panel>/assets/i18n/en.json`, the file the web panel
 * loads), flattened to dotted keys such as `audit.action.ShardStopped`. Fetched once per
 * panel per run; an empty table when it can't be had, and callers fall back to their own.
 */
const cache = new Map<string, Promise<Record<string, string>>>();

function flatten(value: unknown, prefix: string, out: Record<string, string>) {
  if (typeof value === "string") {
    out[prefix] = value;
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

export function panelText(client: AmpClient): Promise<Record<string, string>> {
  let promise = cache.get(client.baseUrl);
  if (!promise) {
    promise = client
      .request<unknown>("/assets/i18n/en.json", { anonymous: true, timeoutMs: 20_000 })
      .then((data) => {
        const out: Record<string, string> = {};
        if (data && typeof data === "object") flatten(data, "", out);
        return out;
      })
      .catch(() => {
        cache.delete(client.baseUrl); // try again next time
        return {};
      });
    cache.set(client.baseUrl, promise);
  }
  return promise;
}
