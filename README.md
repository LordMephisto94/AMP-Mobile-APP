# AMP Mobile

An unofficial Android app for managing AMP 3 panels (CubeCoders' Application Management Panel) over the internet, the
local network or Tailscale, built with [NSH (Native Shell)](https://nsh.dev) in TSX.

## Run

```sh
nsh run                    # GTK window on Linux (phone-sized, 390×844)
nsh run --target android   # NSH's development host on a device or emulator (adb devices)
nsh run --target web       # in the browser
```

`nsh run` uses NSH's own hosts, which have no device key store: the vault falls back to the PIN alone and there's no
fingerprint unlock. The real Android app is the Gradle project in `android/` (below).

## Check and test

```sh
nsh check   # TypeScript
nsh test    # headless tests (App.test.tsx), network and the Android key store stubbed
```

## Layout

| Path | What |
|---|---|
| `App.tsx` | Entry: loads saved servers, routes the navigation stack, puts the lock over everything |
| `nsh.json` | App id, name, version and build, theme, and the capabilities NSH enforces |
| `theme.json` | Colour theme (shadcn `cssVars`), plus `success`, `warning`, `glow`, `hero-from`/`hero-to` tokens. The app is dark-only (`"appearance": "dark"` in `nsh.json`) to suit the artwork |
| `assets/` | Artwork and branding: the backdrop, the AMP wordmark and hex mark, the 1024 px app icon, the menu icons |
| `src/api/` | The AMP 3 REST client (`client.ts`) and one file per area: sign-in (`auth.ts`), instances (`shards.ts`, `manage.ts`, `infraFields.ts`), console (`console.ts`, plus `hub.ts`, a minimal SignalR client for AMP's live hubs, not in the OpenAPI spec), files, snapshots, schedules, machines (`spires.ts`), networking, users and roles (`access.ts`, `permissions.ts`), activity (`audit.ts`), player analytics, panel settings, the panel's own wording (`panelText.ts`) and template artwork. `types.ts` holds the hand-written types |
| `src/state/` | Saved servers, sessions, the PIN vault and the lock (`servers.ts`, with the crypto in `vaultCrypto.ts`); display preferences (`prefs.ts`: size and speed units, shown through `src/lib/units.ts`); navigation routes (`nav.ts`); each server's Online check (`reachability.ts`) |
| `src/lib/` | The Android key store over NSH's host channel (`deviceKeys.ts`), crash alerts (`crashWatch.ts`, the Android side's switch and token handover), Hide personal details (`privacy.tsx`: `priv()`, `privIps()` and `privJson()` make the stand-in, `PrivText` and `Private` draw it blurred; draw every address, name or email through them), safe link opening (`links.ts`), polling while a page shows (`poll.ts`), and the shared 401 handling (`session.ts`) |
| `src/components/` | Shared UI: the lock screen and PIN pad (`Lock.tsx`), the AMP panel's triangle banner (`AmpBanner.tsx`), dialogs, dropdowns, prompts, charts, buttons and fields, Security's crash alerts card (`CrashAlertsCard.tsx`), and the icon set (`Icon.tsx`) |
| `assets/icons/`, `scripts/make-icons.py` | The app's own icons (no emoji anywhere): 24-point white line SVGs, tinted by `<Icon name tone>`. Edit and run the script to change or add one; it writes the SVGs and `Icon.tsx` together |
| `src/screens/` | One file per page: servers home, sign-in, the server overview, instances (and a new one) and an instance (graphs, console, files and the editor, settings, snapshots, schedules), machines, networking, users and roles, activity, player analytics, panel settings, the app's Security and Settings pages |
| `android/` | The Gradle project that is the Android app (see below) |
| `scripts/` | `build-release.sh` (the signed release APKs) and `fetch-nsh-sdk.sh` (NSH's Android runtime) |
| `App.test.tsx` | The headless tests |

`docs/reference/` (the AMP 3.0.1 OpenAPI spec and NSH's full docs) is kept locally and isn't in git.

## Notes

- The server address is entered by the user, with `https://` assumed when no scheme is typed. Plain `http://` is
  taken when typed: inside Tailscale (`isTailscaleHost`) without a warning, elsewhere with a warning and a confirm or a
  tick before every sign-in (`plainHttpRisk` in `src/api/client.ts`, the warning in `ServerFormScreen.tsx`).
  `nsh.json`'s capabilities and the Android app allow plain HTTP generally, since neither can name an address range.
- NSH `Storage` is a plain JSON file in the app's private directory (the Android app is left out of Android's
  backups). The server list holds no secrets; sessions kept with "Stay signed in" are sealed in a vault
  (`amp.vault`) that opens with the app PIN (checked through the phone's secure hardware) or, if you turn it on,
  your fingerprint. Passwords are never stored. SECURITY.md has the details.
- AMP 3 calls instances **shards** and nodes **spires**. The spec mixes `/api/Shards` and `/api/shards`: use paths
  exactly as written.
- The app ID (`nsh.json`'s `id`) is `com.meganet.ampmobile`. Changing it makes Android and iOS treat the app as a
  different one, so saved servers wouldn't carry over.
- `nsh.json` declares `capabilities`, so everything unlisted is denied: HTTP(S) and WS(S) to any host (the server
  address is the user's), `openUrl` for `https` and `http`, the clipboard, the picker, the status bar, and the host
  calls `deviceKey.*` (the key store) and `crashWatch.*` (crash alerts), both answered by the Android app around it.

## Files on iPhone and Android

- **Uploading** uses the system document picker (`Picker.pickFiles`): `UIDocumentPickerViewController` on iOS (picked
  files arrive as copies, iCloud Drive and other providers included) and `ACTION_OPEN_DOCUMENT` on Android (the
  Storage Access Framework). The user grants access to just the files they pick, so the app requests **no storage or
  photo permissions**; don't add `READ_EXTERNAL_STORAGE` / `READ_MEDIA_*` (Google Play rejects them for this use) or
  photo-library usage strings. NSH reads a picked file into memory, and leaves out files over 512 MiB.
- **Downloading** opens a one-time ticket URL in the device's browser (`openUrl`), which saves the file: on iOS
  Safari puts it in Files › Downloads, on Android the browser puts it in Downloads. No permission is needed; the URL
  needs no session token, and the ticket works once.

## The Android app (android/)

From 0.2.0 the Android app is a small Gradle project that runs the TSX app in NSH's `NshView` (`nsh.aar`), instead
of an APK made by `nsh package`. It owns its manifest, which is what the fingerprint prompt needs
(`USE_BIOMETRIC`, which `nsh package` can't declare). The TSX app is unchanged and still runs anywhere NSH does.

- `MainActivity.java` sets the view up as NSH's packaged app did (edge to edge, the app's own limits) and keeps the
  launcher entry's old name (`com.longbridge.nsh.AppActivity`, an alias), so home-screen icons keep working.
- `DeviceKeys.java` is the phone's key store (sealing keys, and the HMAC key the PIN's key is made with) and the
  fingerprint prompt, answered over NSH's host channel (`host.call("deviceKey.…")`, wrapped in
  `src/lib/deviceKeys.ts`). Without a host (tests, `nsh run`, desktops)
  there are no device keys and the vault uses the PIN alone; the tests play the host with `open`'s `host.handlers`.
- `CrashWatch.java` and `CrashWatchJob.java` are crash alerts: a JobScheduler job, about every 15 minutes with a
  network, that reads watched servers' instance states and activity log and posts notifications. The app turns it on
  and hands it tokens over `host.call("crashWatch.…")` (`src/lib/crashWatch.ts`); a pressed alert comes back as the
  event `crashWatch.open`. To try it on an emulator, force a check:
  `adb shell cmd jobscheduler run -f com.meganet.ampmobile 4101`.
- `CrashWatchService.java` is the faster checks (every 1, 2 or 5 minutes, chosen on Security's Crash alerts card): a
  foreground service of the `specialUse` type with a quiet "Watching for crashes" notification. A timer runs each
  check while the phone is awake and an idle-allowed alarm wakes it when asleep; a guard stops both running one. It
  comes back after a restart of the phone (`BOOT_COMPLETED`), and the 15-minute job keeps running underneath.
- The app's id, version and build come from `nsh.json`. Gradle runs `nsh build --release` and puts the bytecode in
  the APK's `assets/nsh`, with `app.json` naming the app's id, so NSH keeps the app's storage where the packaged
  app kept it and updates keep saved servers.

Needs the Android SDK (platform 35 and Build-Tools 36, which the Android Gradle plugin 9 fetches itself if missing),
the NDK (only to strip the runtime's debug symbols; `-PndkVersion=` picks another installed one) and a JDK 17+.
Gradle (9.9.1) comes with the wrapper; built-in Kotlin is off (`android.builtInKotlin=false`), as the app has none.
Fetch the runtime once (it matches the installed `nsh`, 0.5.0; update both together):

```sh
scripts/fetch-nsh-sdk.sh
```

A debug build for an emulator (debug-signed, so it can't update a release install):

```sh
cd android && ./gradlew assembleDebug -Pabis=x86_64
```

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

Build both release APKs and the Play Store bundle (`.aab`) with Gradle (`.nsh/out/` gets the versioned files):

```sh
scripts/build-release.sh
```

It asks for the key's password, unless it finds one: `AMP_KEYSTORE_PASSWORD` in the environment, or a private env
file, `~/.config/amp-mobile/release.env` (or `AMP_RELEASE_ENV`, or `.env.release` or `.env` in the repository, which
git ignores).
Set one up from the example:

```sh
mkdir -p ~/.config/amp-mobile && cp release.env.example ~/.config/amp-mobile/release.env && chmod 600 ~/.config/amp-mobile/release.env
```

The file is read as plain `KEY=VALUE` lines (never run as a script), and refused if anyone but you can read it.
Anyone who can read it can sign updates as you, so keep it off shared backups.

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

## Thanks

- [MinVT-dev](https://github.com/MinVT-dev), for the hardening and features in
  [LordMephisto94/AMP-Mobile-APP#1](https://github.com/LordMephisto94/AMP-Mobile-APP/pull/1), brought into 0.4.0: the
  PIN key made with a key-store HMAC, quick unlock off by default, the background lock timer, capped reads, the link
  confirmation, masked console replies, the damaged-vault notice, the Settings page's units and server list, and
  server reordering.
