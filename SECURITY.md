# Security

This file covers how AMP Mobile protects your panel access, what a security audit (November 2026) found and
fixed, and what's still open. To report a problem, open an issue (or contact the owner privately if it's
sensitive).

## What the app keeps, and where

| What | Where | Protection |
|---|---|---|
| Passwords | Nowhere | Sent once to your panel at sign-in, then dropped |
| Session tokens you keep ("Stay signed in") | `amp.vault` in the app's storage | AES-256-GCM. On Android 12+ the data key is locked by keys in the phone's Keystore (secure hardware) that never leave it: one needs your PIN too (PBKDF2-SHA-256, 600,000 rounds), one works only within a minute of unlocking the phone. Elsewhere: PIN-derived key alone. The PIN is never stored |
| Session tokens you don't keep | Memory only | Gone when the app closes or locks |
| Server list (name, address, user name) | `amp.servers` in the app's storage | Not secret, so not encrypted |
| Wrong-PIN count | `amp.vault.lockout` | Survives restarts |

The app's storage is a file in its private folder. Other apps can't read it, but Android copies it into Google
backups and onto a new phone, which is why tokens are encrypted rather than stored as they are.

## The app lock

- Staying signed in requires a 6–12 digit PIN. Repeated or sequential PINs (`777777`, `123456`) are refused.
- The app opens locked, and locks again after a chosen time in the background (immediately, 30 s, 1 min or 5 min).
- While locked, no session is in memory and none of your pages are drawn behind the lock screen.
- While the app is in the background its screen is covered, so the app switcher shows nothing.
- After 5 wrong PINs each try waits longer (30 s, 1 min, 5 min, 15 min). The 10th erases the saved sign-ins; your
  servers stay, signed out. "Forgot PIN?" does the same.

## Connections

- **HTTPS only.** `http://` addresses are refused; so are addresses with a user name or password in them.
- **Enforced twice.** The app checks every address, and `nsh.json` declares capabilities so NSH's runtime refuses
  anything else for every request, image and WebSocket: only `https` and `wss`, links only `https`, and nothing
  else at all (no file system, processes, sockets, web views, notifications or audio).
- **No redirects.** API calls refuse redirects, so your session token can't be forwarded to another host.
- **Live console** connects over `wss://` only, with a one-time ticket.
- **Size cap.** Answers over 64 MB are refused rather than read into memory.

## Content from your panel

AMP Mobile shows what your panel sends as plain text (there is no web view and no HTML), so a panel can't run
code in the app. Links and images the panel names are checked before use:

- Release notes and the panel address open only if they're `https`. Steam profiles open only on
  `steamcommunity.com`, and downloads only on your own panel's host.
- Template artwork given as an address loads only if it's `https`.
- Error pages from proxies are stripped of markup and cut short.
- One-time tickets and tokens are cut out of error messages before they're shown.

## Audit findings (November 2026)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Saved session tokens were stored in plain text, and included in Android backups | High | Fixed: encrypted vault behind a required PIN; old plain tokens scrubbed at launch |
| 2 | A session renewal could overwrite a newer sign-in or a sign-out; its sign-out wasn't awaited; expired tokens were never offered for renewal | Medium | Fixed: sessions carry a generation number; renewal on a timer |
| 3 | API requests followed redirects with the session token attached | Medium | Fixed: redirects refused |
| 4 | `http://` server addresses were accepted (Android blocked them, but with an unclear error) | Medium | Fixed: refused with an explanation; runtime allows HTTPS only |
| 5 | Links from the panel (release notes, Steam profile, panel address) opened without checks | Medium | Fixed: `https` only, and Steam profiles only on Steam |
| 6 | Template artwork could name any address, plain `http` included | Low | Fixed: `https` only |
| 7 | Copied invite links (one-time sign-up secrets) stayed on the clipboard | Low | Fixed: cleared after a minute |
| 8 | Uploaded file names from the phone's picker weren't checked; the 512 MB limit wasn't enforced | Low | Fixed |
| 9 | The hub's one-time ticket could appear in connection error messages | Low | Fixed: redacted |
| 10 | Address, user-name and password fields allowed autocorrect, so the keyboard could learn them | Low | Fixed |
| 11 | A server's IDs used `Math.random` | Info | Fixed: secure random |
| 12 | The banner could loop forever when measured at an invalid size (a freeze) | Low | Fixed |

## Second audit: bugs, edge cases and races (November 2026)

| # | Finding | Severity | Status |
|---|---|---|---|
| 13 | Any 401 deleted the session and sent the user to sign in, without first trying the renewal AMP allows | Medium | Fixed: one shared handler renews first; only AMP's refusal signs out. Screens hitting it at once share one renewal |
| 14 | A dialog open when the app locked stayed above the lock screen and could still be answered | Medium | Fixed: locking cancels it |
| 15 | Two PIN checks at once could both read the wrong-PIN count and undercount guesses | Medium | Fixed: PIN checks run one at a time |
| 16 | Locking while an unlock was finishing could still open the app | Medium | Fixed: an unlock that started before a lock is abandoned |
| 17 | Vault writes could finish out of order and save stale sessions | Medium | Fixed: one write at a time, each sealing what's current |
| 18 | Wrong current PINs on the change-PIN screen weren't counted | Low | Fixed: counted and waited like any other |
| 19 | A clock set backwards could stretch the wrong-PIN wait almost without end; an unreadable count reset to zero | Low | Fixed: capped at the longest wait; unreadable counts as nearly used up |
| 20 | A damaged vault file also emptied the server list on screen | Low | Fixed: each part loads on its own |
| 21 | The live console could open two connections at once (stop then start, or two failures); a bad message dropped the rest; incoming data and unanswered calls had no limits | Medium | Fixed |
| 22 | The console accepted lines without an instance id, which could belong to another instance | Low | Fixed: only this instance's well-formed lines |
| 23 | Typing during a file save was marked as saved; locking discarded unsaved edits | Medium | Fixed: only what was sent counts as saved; drafts kept in memory (never on disk) and restored after unlocking |
| 24 | The request timeout didn't cover reading the answer, so a stalled server could hang a screen | Low | Fixed |
| 25 | Going back while a sign-in finished replaced the home screen | Low | Fixed |
| 26 | Switching an instance's graph range mid-refresh could show the old range | Low | Fixed |
| 27 | Removing a server waited for the server's sign-out answer (up to 15 s) | Low | Fixed: removed at once, the server told afterwards |
| 28 | Adding the same account on the same panel twice made a duplicate | Low | Fixed: the existing entry is refreshed |
| 29 | Users, roles or invites missing a field could break the Access pages | Low | Fixed: answers tidied where they arrive |
| 30 | Avatars weren't size- or type-checked and had no timeout | Low | Fixed: images only, 2 MB at most, 15 s |

## Release signing

From 0.1.7 the APKs are signed with the app's own release key (RSA 4096), kept off the repository by its owner.
Android installs an update only when it's signed by the same key, so nobody without it can ship an update that
replaces the app and reads its data. Earlier builds used a development key. The certificate's SHA-256 fingerprint is
`bac44fe4b557bb334bedbd20bc1c39df3f202438c4d3c340e299b9406d5e6dbb`.

## Still open

- **PIN strength where there's no key store.** On Android 12 and newer the vault is bound to the phone's Keystore,
  so a copy of the file is useless elsewhere. On older phones (and desktops) the vault is only as strong as the PIN.
- **No in-app fingerprint prompt.** `nsh package` can't declare Android's `USE_BIOMETRIC` permission, so instead the
  vault opens without the PIN within a minute of unlocking the phone (by fingerprint, face or the phone's PIN). A
  real prompt needs the app moved into its own Android Studio project. iOS (Keychain, Face ID) needs a Mac.
- **Screenshots.** NSH can't block screenshots or screen recording (Android's `FLAG_SECURE`).
- **Certificates.** The app trusts the phone's certificate authorities; there's no certificate pinning.
- **Permissions.** NSH's Android runtime adds the notifications permission; the app never uses it, and its
  capabilities deny notifications.
- **Server list at rest.** Panel addresses and user names aren't secret, so they're stored unencrypted (and go into
  backups). They could be moved into the vault, at the cost of "Forgot PIN" also forgetting the servers.
- **Passkeys.** Accounts that sign in with a passkey are sent to the web panel. (Accounts held for a password
  change now set the new password in the app.)
