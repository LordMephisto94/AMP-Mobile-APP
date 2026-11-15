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
- NSH `Storage` is a plain JSON file in the app's private directory (and Android copies it into backups), so nothing
  secret is written in the clear. The server list holds no secrets; sessions kept with "Stay signed in" are sealed in
  a vault (`amp.vault`) with AES-256-GCM under a key derived from the app PIN (PBKDF2-SHA-256, 600,000 rounds, random
  salt). The PIN is never stored. A PIN is required to stay signed in; without one, sessions live in memory only.
  Wrong PINs are counted on disk: after five each try waits longer, and the tenth erases the vault. The app locks
  itself after a set time in the background and then holds no session in memory. Passwords are never stored.
- AMP 3 calls instances **shards** and nodes **spires**. The spec mixes `/api/Shards` and `/api/shards`: use paths
  exactly as written.
- The app ID (`nsh.json`'s `id`) is `com.meganet.ampmobile`. Changing it makes Android and iOS treat the app as a different one, so saved servers wouldn't carry over.

## Files on iPhone and Android

- **Uploading** uses the system document picker (`Picker.pickFiles`): `UIDocumentPickerViewController` on iOS (picked
  files arrive as copies, iCloud Drive and other providers included) and `ACTION_OPEN_DOCUMENT` on Android (the
  Storage Access Framework). The user grants access to just the files they pick, so the app requests **no storage or
  photo permissions**; don't add `READ_EXTERNAL_STORAGE` / `READ_MEDIA_*` (Google Play rejects them for this use) or
  photo-library usage strings. NSH reads a picked file into memory, and leaves out files over 512 MiB.
- **Downloading** opens a one-time ticket URL in the device's browser (`openUrl`), which saves the file: on iOS
  Safari puts it in Files › Downloads, on Android the browser puts it in Downloads. No permission is needed; the URL
  needs no session token, and the ticket works once.
- `nsh.json` declares no `capabilities`, so a standalone app may use the network (any host: the server address is the
  user's), the picker and `openUrl`. If capabilities are ever declared, everything unlisted is denied, so include at
  least: `"network": { "hosts": ["*"] }`, `"picker": true`, `"openUrl": { "schemes": ["https", "http"] }`,
  `"statusBar": true`.


## Building with the Rust crate

`native/` is a Rust crate (the Android Keystore, through JNI). Building needs Rust from rustup with
`rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`, and the Android NDK
(`ANDROID_NDK_HOME`, e.g. `~/Android/Sdk/ndk/30.0.16248370`). `.cargo/config.toml` optimizes dependencies in
development builds, which the tests need for the vault's crypto to run fast enough.

## Versions

Versions are `MAJOR.MINOR.PATCH` (semantic versioning), tagged `vMAJOR.MINOR.PATCH`:

- **MAJOR**: big releases, or changes that break how the app is used.
- **MINOR**: new features and patches.
- **PATCH**: hotfixes. It counts on without padding (`0.1.9`, then `0.1.10`), since versions can't have leading zeros.

`nsh.json` holds `version` and `build`. Raise `build` by one for every release: Android only installs an update
over the old app when its build number is higher. Changes are listed in `CHANGELOG.md`.

## Release signing

Release APKs are signed with the release key, kept outside the repository at `~/.android/amp-mobile-release.jks`
(alias `amp-mobile`). Every update must be signed with the same key: Android refuses an update signed by another,
and the only way past that is uninstalling the app, which deletes its saved servers and sign-ins. **Keep a backup of
the key file and its password somewhere safe (a password manager, plus an offline copy).** A lost key means no more
updates for anyone who installed the app.

Build both release APKs (asks for the key's password; `.nsh/out/` gets the versioned files):

```sh
scripts/build-release.sh
```

The key was made once with (PKCS12, so the key and the keystore share one password):

```sh
keytool -genkeypair -v -keystore ~/.android/amp-mobile-release.jks -storetype PKCS12 -alias amp-mobile \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=AMP Mobile, O=MegaNet Systems"
```

The certificate's SHA-256 fingerprint, to check a download against
(`apksigner verify --print-certs AMP-Mobile-vX.Y.Z.apk`):

```
bac44fe4b557bb334bedbd20bc1c39df3f202438c4d3c340e299b9406d5e6dbb
```

Builds before 0.1.7 were signed with a debug key, so moving from one of those to a release-signed build needs an
uninstall first.
