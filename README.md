# AMP Mobile

A mobile app for managing a publicly exposed AMP 3 server, built with [NSH (Native Shell)](https://nsh.dev) in TSX.

## Run

```sh
nsh run                    # GTK window on Linux (phone-sized, 390×844)
nsh run --target android   # needs an Android SDK + a device/emulator (adb devices)
nsh run --target web       # in the browser
```

## Check and test

```sh
nsh check   # TypeScript
nsh test    # headless tests (App.test.tsx), network stubbed
```

## Layout

| Path | What |
|---|---|
| `App.tsx` | Entry: loads saved servers, routes the navigation stack |
| `theme.json` | Colour theme (shadcn `cssVars`), plus `success`, `warning`, `glow`, `hero-from`/`hero-to` tokens. The app is dark-only (`"appearance": "dark"` in `nsh.json`) to suit the artwork |
| `assets/backdrop.webp` | The neon artwork behind every screen (`src/components/backdrop.tsx`) |
| `assets/amp-wordmark.webp`, `assets/amp-mark.png`, `assets/icon.png` | AMP branding: the wordmark on the home screen, the hex mark in the desktop header, and the 1024 px app icon (made from the mark) |
| `src/components/AmpBanner.tsx` | The AMP 3 panel's triangle header, drawn on a Canvas, with a status triangle and badge (online / offline / warning / danger) |
| `src/api/` | AMP 3 REST client (`client.ts`), endpoints (`auth.ts`, `shards.ts`), hand-written types (`types.ts`) |
| `src/state/` | Saved servers and their sessions (`servers.ts`, persisted with NSH `Storage`) and navigation routes |
| `src/screens/` | Servers home, Add Server / sign-in form, instance list, instance detail (graphs), console, new instance, instance settings, file browser, text file editor |
| `src/api/manage.ts` | Templates, spires, creating instances, the three settings surfaces (record, app settings, infrastructure), and delete / restore / permanent delete |
| `src/api/files.ts` | Instance files: list, read/write text, folder, move, copy, delete, zip/extract, download tickets, chunked upload |
| `src/api/infraFields.ts` | Which infrastructure settings the app edits, and how their values convert to and from the form |
| `src/api/hub.ts` | Minimal SignalR client for AMP's live hubs (`/hubs/shard`), used by the console; not in the OpenAPI spec |
| `src/components/` | Shared UI pieces (buttons, fields, pills, desktop page header) |
| `docs/reference/` | AMP 3.0.1 OpenAPI spec and the full NSH docs (`nsh-llms-full.txt`) |

## Notes

- The server address is entered by the user. `https://` is assumed when no scheme is typed. Plain `http://` is blocked
  on Android unless `"android": { "usesCleartextTraffic": true }` is added to `nsh.json`.
- NSH `Storage` is a plain JSON file in the app's private directory, so the app stores only the session token
  ("Stay signed in"), never the password.
- AMP 3 calls instances **shards** and nodes **spires**. The spec mixes `/api/Shards` and `/api/shards`: use paths
  exactly as written.
- `nsh.json`'s `id` is still the placeholder `com.example.ampmobile`. Change it before packaging.
