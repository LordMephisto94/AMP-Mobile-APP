# Changelog

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
  Android NDK.

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
