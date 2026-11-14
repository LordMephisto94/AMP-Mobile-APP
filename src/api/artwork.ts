/**
 * Turns a template's `displayImageSource` into an image URL, the way the AMP 3 web
 * panel does: `url:<url>` as is, `steam:<appid>` from Steam's CDN, `internal:<name>`
 * from the panel's own `/assets/app-icons/`.
 */
export type ArtworkKind = "banner" | "hero" | "icon";

export function artworkUrl(source: string | null | undefined, serverUrl: string, kind: ArtworkKind = "banner"): string | null {
  if (!source) return null;
  if (source.startsWith("url:")) return source.slice(4);
  if (source.startsWith("steam:")) {
    const appId = encodeURIComponent(source.slice(6));
    switch (kind) {
      case "hero":
        return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`;
      case "icon":
        return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_sm_120.jpg`;
      default:
        return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
    }
  }
  if (source.startsWith("internal:")) {
    return `${serverUrl}/assets/app-icons/${encodeURIComponent(source.slice(9))}.jpg`;
  }
  return null;
}
