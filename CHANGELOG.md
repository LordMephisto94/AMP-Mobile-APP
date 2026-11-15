# Changelog

## 0.2.6-A

A pre-release test build.

- Redesign (`DESIGN.md`, `anti-slop/audit-001-2026-11-15.md`): solid cards and a single violet accent in place of
  glass, shadows and gradients. The artwork now shows on the home screen only. Emoji are gone from screens, menus and
  dialogs; folder and file rows use new line icons. Buttons use the theme's own text colour on the accent, which also
  fixes danger buttons (white on the red was 2.69:1, now 6.96:1). The home screen shows each server as a plain card with
  its status, and an instance's page has one Controls button above a single list that starts with the console.

- Connection choice when adding a server: https (the default) or http. Plain http shows a warning that fits the
  address (Tailscale, a private network or the public internet) and needs a tick before anything is sent. A typed
  `http://` or `https://` moves the choice to match, and an http server's address stays visible on its card. The
  live console uses `ws://` for http servers, and a download from an http panel opens over http. Android now
  permits plain http (it blocks it by default) and still trusts only the system certificate store.

- App settings, opened from Settings on the home screen (Security is one tap further): theme (dark, light, or the
  phone's), sizes in binary (KiB, MiB, GiB) or decimal (kB, MB, GB) units, network speed in bytes or bits per
  second, hiding IP addresses and host names (never, until tapped, or always; Copy still copies the real address),
  and blocking screenshots and screen recording on Android. Sizes now read in binary units unless you change that,
  so a machine that showed 2,678 MB shows 2.6 GiB.
- Light theme. Every screen follows the chosen theme: colours come from theme tokens (new `info` and `series`
  ones, plus `success`, `warning` and `destructive`) instead of picks that only worked on black, and the lock screen,
  PIN pad, status badges, switches, charts and code blocks were redone for it. Contrast was measured, and these
  light values changed: muted text on muted surfaces (4.39:1 to 5.02:1), destructive text on the page (4.28:1 to
  5.73:1), success and warning text on cards (3.77:1 and 3.56:1 to 5.48:1 and 5.18:1), and the edge of an input or
  switch (1.85:1 to 3.30:1 on a card; the dark theme's from 1.86:1 to 3.54:1). Both themes were looked at in
  real-window screenshots of the lock screen, home, settings, security, add server, the instance list, an instance
  and its files.
- Line icons made for the app (`assets/icons`, beside the menu set in `assets/menu`): on the settings groups, the
  instance menu, and file and folder rows. They are tinted from the theme and sit only where they name a
  destination or a kind of thing.
- Servers: move one up or down from its menu, and copy the server list to the clipboard (names, addresses and user
  names, never passwords or sessions) or add servers from a copied list, both in Settings.
- The auto-lock time now runs on a timer while the app is in the background; before, it was only checked when the
  app came back to the front. If the saved sign-ins can't be read (a damaged vault file), the app opens, clears
  them and says so, instead of resetting them without a word.
- Keyboard focus rings on buttons, rows, PIN keys and fields. NSH draws them on macOS and the web, so nothing
  changes on a phone yet.

An outside read of the code (SECURITY.md, findings 55 to 60):

- Quick unlock is now off unless you turn it on in Security. Before, the app could open without its PIN for a minute
  after the phone was unlocked, so anyone who knew the phone's own PIN or pattern got in. If you used it, it is
  switched off at your next PIN unlock: turn it on again in Security if you want it. Fingerprint unlock is unchanged.
- Answers from a panel are cut off as they arrive once they pass 64 MB, even when the panel declares no length
  (before, only a declared length was checked, after the whole answer had been read). Avatars the same, and only
  PNG, JPEG, WebP and GIF are shown.
- A reply to an instance's prompt (a Steam password or Guard code) is hidden as you type it; a Show control reveals it.
- Android: the app switcher no longer keeps a picture of the app (Android 13 and newer; older versions blank the
  window as the app leaves the front). The app no longer passes launch intents to NSH's URL-scheme and notification
  handlers, which it doesn't use, and writes its error text to the log only in debuggable builds.
- The PIN's key is now made with an HMAC computed inside the Android Keystore (findings 61 to 66). A copy of the
  vault file can no longer be used to try PINs on a graphics card: every guess needs the phone. Vaults made by
  earlier versions upgrade at your next PIN unlock. Easy PINs such as 121212 and 112233 are refused, a vault file with
  an absurd `rounds` value is treated as damaged, and the Security page now says when the key store refused the vault
  key and the PIN is all that protects it.
- A link your panel sends (release notes, panel address) shows where it goes and asks before it opens.
- Schedule step ids use a secure random.

## 0.2.2

A fifth audit (SECURITY.md, findings 45 to 54):

- Uploads: a server answer that makes no sense stops the upload instead of saving a partial file as if whole, an
  upload stops when the app locks, and "Uploaded N files" no longer counts skipped files.
- A session renewal with an unreadable expiry no longer shows the server as signed out.
- A double tap on "Change it" no longer shows an error after a password change that worked.
- Unsaved file edits kept over a lock come back only for the same account.
- A fingerprint prompt that never answers can't block the PIN pad: it gives up after two minutes.
- Pages no longer flash back an older state (such as "Running" just after a stop) when answers arrive out of order.
- A machine's page handles a lock or sign-out while loading like every other page.

## 0.2.1

- Home page: each server's card now says whether its panel answers (Online, Offline, or Checking… at first), signed
  in or not. It's checked when the page shows and every minute while it does, never while the app is locked, and
  without sending your sign-in.
- A fourth audit (SECURITY.md, findings 41 to 44):
  - Leaving an instance page right after starting, stopping or restarting it, then signing out of that server, no
    longer throws you onto its sign-in page.
  - A session renewed while quick or fingerprint unlock was being switched is saved instead of dropped.
  - Turning fingerprint unlock on no longer fails when a session renews during the prompt.
  - A fingerprint result arriving after the app's screen closed can no longer crash it.
- Release builds can read the signing key's password from a private env file instead of asking
  (`release.env.example`).

## 0.2.0

- Fingerprint unlock: turn it on in Security, and the app asks for your fingerprint or face when it opens (Android
  11 and newer, with a fingerprint or face set up on the phone). It replaces opening by itself within a minute of
  unlocking the phone; the PIN always works too. Adding a fingerprint or face to the phone turns it off (enter the
  PIN, then turn it on again). Changing the PIN keeps it on.
- The Android app is now built with Gradle around NSH's runtime instead of `nsh package`, so the app declares its
  own permissions: the fingerprint permission is added, and the unused notifications permission is gone. The phone's
  key store moved from Rust to Java with the same keys and format, so saved sign-ins and servers carry over.
- The app is left out of Android's cloud backups (its saved sign-ins can't be opened on another phone anyway).
- A key store that doesn't answer no longer erases the saved sign-ins at unlock; only a key that's really gone does.
- The lock screen no longer tries to open the vault before the server list is read (which could lose saved
  sign-ins).

## 0.1.10

A third security audit, covering races and edge cases (details in SECURITY.md, findings 31 to 40).

- A sign-in that finishes after the app locked is dropped (and the panel told) instead of being kept behind the lock.
- "Forgot PIN", quick unlock and the move to a phone-bound vault can no longer race each other into a stale vault or
  a key left in memory.
- Setting the clock back while the app is in the background no longer skips the auto-lock.
- Pages no longer break when opened just as a session runs out.
- A sign-in answer without a valid expiry is refused.
- Schedules: an untouched trigger is saved exactly as stored (an interval's anchor and seconds survive), intervals
  under a minute show in seconds, and the "next times" preview only shows the newest answer.
- Snapshots: no deleting while a restore runs.

## 0.1.9

- Schedules: a new page on each instance (Schedules, under Snapshots) for what AMP runs on its own.
  - See every schedule: when it runs, its next time, how the last run went, repeated failures, and why AMP turned
    one off or skipped a step.
  - Turn one on or off with its switch, run it now, or delete it (both ask first).
  - Add or edit one: every few minutes or hours, hourly, daily, weekly, a custom cron expression (with a time zone),
    or when something happens (a user connects, the server changes state…). The next times it would run show as you
    type.
  - Its actions run in order: send a console command, wait, take a backup, call a webhook, start, stop, restart,
    update or kill the server. Reorder, add or remove them.
  - Schedules with conditions or follow-up steps are shown in full and can be renamed, retimed, turned on or off and
    run; their steps are kept exactly as they are (edit those in the web panel).
  - Run history: each run's result, how long it took, and what every step did.

## 0.1.8

- Snapshots: a new page on each instance (Snapshots, under Files) for AMP 3's backups.
  - See every snapshot: full or partial, what it holds, its size and file count, what started it, which one is on
    disk now, pinned ones, failures and their reasons, and files that couldn't be read.
  - Take a snapshot (partial or full; game data, base install and/or AMP settings; named and optionally pinned) and
    watch its progress.
  - Restore one, after a confirmation; AMP saves the current state first, so a restore can be undone. Its progress
    shows at the top.
  - Rename, describe, pin or unpin, and delete snapshots.
  - Set the size limits (per snapshot and in total) and whether to stop a game that can't pause its saving.

## 0.1.7

- Release APKs are now signed with the app's own release key instead of a development key. **Uninstall the old app
  before installing this one** (Android refuses an update signed by a different key); that removes its saved
  servers, PIN and sign-ins, so add your servers again afterwards. Later updates install over it as usual.
- `scripts/build-release.sh` builds both release APKs.

## 0.1.6

- Fixed: after "Lock now", quick unlock didn't come back when you turned the screen off, unlocked the phone and
  returned. Turning the screen off may only count as the app losing focus, not leaving it; any step away now counts.

## 0.1.5

- Fixed: "Lock now" seemed to do nothing. Within a minute of unlocking the phone, quick unlock opened the app again
  straight away. Now, after "Lock now", quick unlock waits until you've left the app and come back.

## 0.1.4

- An account AMP holds for a password change (expired, or forced by an admin) now sets its new password in the app
  and signs straight in, with the panel's password rules shown. Previously it was sent to the web panel.

## 0.1.3

- Saved sign-ins are locked to the phone's secure hardware (Android Keystore, Android 12+): a copy of the vault from
  a backup or another phone can't be opened, even with the PIN. Existing vaults move over at the next PIN unlock.
- Quick unlock: within a minute of unlocking your phone (fingerprint, face or the phone's PIN), the app opens without
  its PIN. It turns on at the first PIN unlock made within that minute.
- If the phone's key is gone (a reset, or a copy from another phone), the saved sign-ins are cleared with a message.
- The app now includes a small Rust crate (`native/`); building needs Rust (rustup) with the Android targets and the
  Android NDK. (Replaced by Java in the Gradle app from 0.2.0.)

## 0.1.2

Bug fixes from a second audit (edge cases and races). See `SECURITY.md` for the list.

- A rejected request first offers AMP a renewal; you're only sent to sign in when AMP refuses.
- Locking cancels any open dialog; unsaved file edits survive the lock (kept in memory, never on disk).
- PIN checks and vault writes run one at a time; a lock during an unlock wins; the wrong-PIN wait can't be
  stretched by a clock change, and wrong PINs on the change-PIN screen count.
- The live console never opens two connections, and ignores other instances' and malformed lines.
- Typing during a file save stays unsaved; stalled servers time out; removing a server is instant; adding the same
  account twice no longer duplicates it; pages cope with answers missing fields.

## 0.1.1

Security release. See `SECURITY.md` for the full audit.

- Saved sign-ins are encrypted (AES-256-GCM) behind a required app PIN. The app opens locked, locks again after a
  set time in the background, and erases saved sign-ins after 10 wrong PINs. Tokens stored in plain text by 0.1.0
  are removed at launch.
- New Security page (home screen): set, change or remove the PIN, lock now, choose the auto-lock time.
- Session renewal can no longer undo a sign-out or overwrite a newer sign-in, and runs on a timer while the app is
  open.
- HTTPS only, enforced by the app and by NSH's runtime. Redirects are refused, so the session token can't follow
  one to another host.
- Links and images from the panel open only as `https`; invite links leave the clipboard after a minute; upload
  names and the 512 MB limit are checked; form fields no longer autocorrect.
- Fixed: the header banner could freeze the app.

## 0.1.0

First test release: multiple servers; instances with artwork, state, connect address, graphs, power controls,
create, settings, delete and restore; live console; file manager; Overview, Spires, Networking, Analytics,
Activity, Access (users, roles with the permission editor, invites) and Settings.
