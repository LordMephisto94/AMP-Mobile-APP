# Security

This file covers how AMP Mobile protects your panel access, what five audits (November 2026) found and fixed,
and what's still open. To report a problem, open an issue (or contact the owner privately if it's
sensitive).

## What the app keeps, and where

| What | Where | Protection |
|---|---|---|
| Passwords | Nowhere | Sent once to your panel at sign-in, then dropped |
| Session tokens you keep ("Stay signed in") | `amp.vault` in the app's storage | AES-256-GCM under a random data key. On Android that key is sealed by keys in the phone's Keystore (secure hardware), which never leave it: one that your PIN's key is made with (PBKDF2-SHA-256, 600,000 rounds, then an HMAC computed inside the Keystore, so a PIN guess can only be checked on the phone), and, only if you turn one on in Security, a second way in: quick unlock (off by default; works only within a minute of unlocking the phone) or fingerprint unlock (a key that needs a fingerprint or face check (strong biometrics) for each use and is voided when a fingerprint or face is added). Without a key store (desktops): the PIN-derived key alone. The PIN is never stored |
| Session tokens you don't keep | Memory only | Gone when the app closes or locks |
| Server list (name, address, user name) | `amp.servers` in the app's storage | Not secret, so not encrypted |
| Wrong-PIN count | `amp.vault.lockout` | Survives restarts |

The app's storage is a file in its private folder that other apps can't read. From 0.2.0 the app is left out of
Android's backups; before that, Android copied the file into Google backups, which is why tokens have always been
encrypted rather than stored as they are (and the vault can't be opened on another phone anyway).

## The app lock

- Staying signed in requires a 6–12 digit PIN. Repeated or sequential PINs (`777777`, `123456`) are refused.
- The app opens locked, and locks again after a chosen time in the background (immediately, 30 s, 1 min or 5 min).
  The time runs on a timer while the app is in the background, so it locks even if you never come back to it.
- It opens with the PIN. Quick unlock (off unless you turn it on in Security) also lets it open by itself within a
  minute of unlocking the phone, so anyone who knows your phone's PIN or pattern could get in that way: leave it off
  if that matters. With fingerprint unlock
  on (Security; Android 11+, strong biometrics), it asks for a fingerprint or face instead, and doesn't open by
  itself; the PIN always works too. "Lock now" doesn't reopen by itself until you leave the app and come back.
- While locked, no session is in memory and none of your pages are drawn behind the lock screen.
- While the app is in the background its screen is covered, and Android is told not to keep a picture of it for the
  app switcher (Android 13 and newer: no app-switcher screenshot; older versions: the window is blanked as the app
  leaves the front). Settings can also block screenshots and screen recording (Android's `FLAG_SECURE`; off by
  default), which blanks the app switcher's picture on every Android version.
- After 5 wrong PINs each try waits longer (30 s, 1 min, 5 min, 15 min). The 10th erases the saved sign-ins; your
  servers stay, signed out. "Forgot PIN?" does the same.
- A vault file that fails authentication (damaged, or changed by something else) is cleared at the next unlock and the
  app says so; your servers stay, signed out.

## Connections

- **https by default, http by choice.** A new server gets `https://` unless you pick http in the Connection choice
  (or type `http://`). Plain http needs a tick on a warning that says what it exposes: for a Tailscale address,
  that Tailscale encrypts the link; for a private network, that anyone on it can read the password and session; for
  the public internet, that anyone on the path can. Addresses with a user name or password in them are refused.
- **Enforced twice.** The app checks every address, and `nsh.json` declares capabilities so NSH's runtime refuses
  anything else for every request, image and WebSocket: `https` and `wss`, plus `http` and `ws` (which the runtime
  allows to any host, so the app only uses them for a server you added over http), links `https` (and `http` for a
  download from your own panel's host), the clipboard, the file picker, and the Android app's key-store calls
  (`deviceKey.*`); nothing else at all (no file system, processes, sockets, web views, notifications or audio).
  On Android, `network_security_config.xml` permits plain http (it is off in Android by default) and trusts only the
  system certificate store.
- **Online check.** The home page asks each panel for its password policy (no sign-in needed), sending no token,
  and never while the app is locked.
- **No redirects.** API calls refuse redirects, so your session token can't be forwarded to another host.
- **Live console** connects over `wss://` for an https server and `ws://` for one added over http, with a one-time
  ticket.
- **Size cap.** Answers over 64 MB are refused: one that declares a length over the cap at once, and any other (no
  length, or a false one) as soon as it passes the cap, counted as it arrives rather than after it was all read.
  Avatars: 2 MB at most, PNG, JPEG, WebP or GIF only.

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

## Third audit: security, races and edge cases (November 2026, 0.1.10)

Covers everything since the second audit (the phone-bound vault and quick unlock, the in-app password change, release
signing, Snapshots and Schedules) and a fresh pass over the vault, lock, connections and panel content.

| # | Finding | Severity | Status |
|---|---|---|---|
| 31 | A sign-in that finished after the app had locked put a session in memory behind the lock | Medium | Fixed: it's dropped, the panel is told, and the user signs in again after unlocking |
| 32 | A failed quick unlock could write the old vault back to disk after "Forgot PIN" had erased it | Low | Fixed: only the current vault is ever rewritten |
| 33 | "Forgot PIN" deleted the phone's keys without waiting, so a PIN set straight after could lose its fresh key to that late deletion | Low | Fixed: a new vault waits for the deletions |
| 34 | Locking while a PIN-only vault moved to a phone-bound one left its key in memory while locked | Low | Fixed: the move is abandoned by a lock or an erase |
| 35 | Setting the clock back while the app was in the background skipped the auto-lock | Low | Fixed: a backwards clock locks |
| 36 | Six pages asked for the API client while being drawn, so opening one as a session ran out could break the page | Low | Fixed: those reads start once the page is up, and fail quietly |
| 37 | A sign-in answer without a valid expiry was accepted, and the session counted as over at once | Low | Fixed: refused with an explanation |
| 38 | A schedule's "next times" preview could show an older answer that arrived after a newer one | Low | Fixed: only the newest is shown |
| 39 | Saving a schedule rebuilt its trigger from the form, dropping an interval's anchor and rounding seconds | Low | Fixed: an untouched trigger is sent back exactly as stored; sub-minute intervals are labelled in seconds |
| 40 | A snapshot could be deleted while a restore was running (possibly the one being restored) | Low | Fixed: no deleting during a restore |

Checked and found sound: HTTPS-only addresses and `wss` for the console, redirects refused, every API path segment
encoded, error messages stripped of tickets, links and artwork checked, nothing logged, the Keystore errors told
apart, PIN checks one at a time, vault writes in order, renewals shared and superseded correctly, the console's hub
stopped with its page, and Schedules sending branched steps back untouched.

## Fourth audit: bugs, races and edge cases (November 2026, 0.2.1)

Covers 0.2.0 (fingerprint unlock, the Java key store, the Gradle app) and the home page's Online check, with a
pass over timers and late answers across the pages.

| # | Finding | Severity | Status |
|---|---|---|---|
| 41 | A late look at an instance after a start, stop or restart ran even after leaving the page; signing out of that server meanwhile sent the user to its sign-in page from wherever they were | Low | Fixed: those looks only run while the page shows and the app is unlocked (also the console's) |
| 42 | A session saved while quick or fingerprint unlock was being added or removed was dropped from disk instead of saved | Low | Fixed: the save seals again onto the current vault |
| 43 | Turning fingerprint unlock on failed ("the app locked meanwhile") whenever a session renewal saved the vault during the prompt | Low | Fixed: only a lock, an erase or a new data key stops it, and then the new key is deleted |
| 44 | The Java key store could crash the app if a fingerprint result arrived after its screen had closed | Low | Fixed: answered as cancelled |

Checked and found sound: the old Rust-sealed keys open with the Java code (same aliases and format, tested by
upgrading on an emulator); a key store that doesn't answer never erases the vault; the fingerprint prompt opens by
itself once per return, not after "Lock now" or "Use PIN"; a fingerprint added to the phone voids the key and the
app falls back to the PIN; the vault isn't opened before the server list is read; the Online check sends no token,
nothing while the app is locked, and drops answers older than the newest; the release password file is read as
data, never run, and refused when others can read it.

## Fifth audit: bugs, races and edge cases (November 2026, 0.2.2)

A full pass: the API layer and the live console connection, sign-in and renewal, files and uploads, every page's
loading and saving, the vault, the Android key store and the build scripts.

| # | Finding | Severity | Status |
|---|---|---|---|
| 45 | An upload whose server answered a chunk with a missing-number or out-of-range count ended early and committed a partial file as if whole | Medium | Fixed: counts are checked (whole, within the file); anything else stops the upload uncommitted |
| 46 | An upload carried on behind the lock with the session it started with | Low | Fixed: it stops at the next chunk when the app locks, uncommitted |
| 47 | A renewal answer with an unreadable expiry was accepted, so the session counted as over at once and the server showed signed out | Low | Fixed: refused, keeping the session it had (as sign-in already did) |
| 48 | A double tap on "Change it" sent the password change twice; the second failed and showed an error after a change that worked | Low | Fixed: one change at a time |
| 49 | Unsaved file edits kept over a lock were keyed by server, not account: another account signing in to that server got them back | Low | Fixed: kept per account |
| 50 | A fingerprint prompt that never answered would block the PIN pad until the app restarted | Low | Fixed: the call gives up after two minutes and the PIN works |
| 51 | Seven pages (instances, overview, machines, a machine, networking, access, files) could show an older answer that arrived after a newer one, such as "Running" just after a stop | Low | Fixed: only the newest load's answer is shown |
| 52 | A machine's page asked for the API client outside its error handling, so a lock or sign-out at that moment was an unhandled error instead of the usual recovery | Low | Fixed |
| 53 | Live console messages already received kept being handled after the page stopped the connection | Low | Fixed: dropped |
| 54 | "Uploaded N files" counted files the user chose to skip | Low | Fixed: counts what was uploaded |

Checked and found sound: HTTPS-only addresses, no credentials or query in them, redirects refused for anything
carrying a token, tickets redacted from messages, response and frame size limits, one live connection at a time
with stale attempts abandoned, renewals shared per server and superseded correctly, sign-ins dropped when the app
locked meanwhile, every other save button guarded against double taps, timers that load later checking the page
still shows, and the Java key store answering every call once.

## Sixth review: an outside read of the code (November 2026)

A read of the vault, key store, API client, links, lock screen, manifest and build scripts, with a search of the
rest of the code for risky calls. Its fixes are in the changelog (0.2.6-A). What is left is under "Still open".

| # | Finding | Severity | Status |
|---|---|---|---|
| 55 | An answer with no declared length (chunked) was read in full before the 64 MB cap was checked, so a hostile panel could make the app buffer far more; avatars the same | Low | Fixed: counted as it streams, refused the moment it passes the cap |
| 56 | Quick unlock was on by default: anyone who knew the phone's own PIN or pattern could open the app without its PIN for a minute after unlocking the phone | Medium | Fixed: off unless turned on in Security; a way in left from before is removed at the next PIN unlock |
| 57 | A reply to a prompt (a Steam password or Guard code) was typed in the clear | Low | Fixed: hidden unless shown with the Show control |
| 58 | The app switcher's picture could capture the app: the in-app cover is drawn from the app's code and can come too late | Low | Fixed: Android told not to keep a picture (13 and newer); window blanked as the app leaves the front (older) |
| 59 | Intents sent to the app's open launcher entry were passed on to NSH's URL-scheme and notification handlers, which the app doesn't use; the app's error text was written to the log in release builds | Info | Fixed: not passed on; logged only in debuggable builds |
| 60 | Avatars accepted any image type, SVG included | Info | Fixed: PNG, JPEG, WebP and GIF only |
| 61 | The PIN's sealed box was wrapped by a phone key that works without the user, so code running as the app could read the box, copy it off the phone and try PINs on a graphics card | Medium | Fixed: the PIN's key now needs an HMAC computed inside the Keystore, so a guess can only be checked on the phone; older vaults upgrade at the next PIN unlock |
| 62 | A vault file with a huge `rounds` value froze unlocking | Info | Fixed: values over 5,000,000 are refused as a damaged file |
| 63 | Easy PINs such as 121212, 123123 and 112233 were accepted | Low | Fixed: repeated blocks and doubled runs are refused too |
| 64 | If the key store refused the vault key, the app quietly fell back to the weaker PIN-only vault | Low | Fixed: the Security page says so and asks for a longer PIN |
| 65 | A link the panel names (release notes, panel address) opened without showing where it goes | Low | Fixed: the host is shown and the user confirms first |
| 66 | A schedule's step ids used `Math.random` | Info | Fixed: secure random |

## Release signing

From 0.1.7 the APKs are signed with the app's own release key (RSA 4096), kept off the repository by its owner.
Android installs an update only when it's signed by the same key, so nobody without it can ship an update that
replaces the app and reads its data. Earlier builds used a development key. The certificate's SHA-256 fingerprint is
`bac44fe4b557bb334bedbd20bc1c39df3f202438c4d3c340e299b9406d5e6dbb`.

## Still open

- **PIN strength where there's no key store.** On Android the vault is bound to the phone's Keystore, so a copy of
  the file is useless elsewhere. Elsewhere (desktops) the vault is only as strong as the PIN.
- **iOS.** The Keychain and Face ID need the same work in an Xcode project, which needs a Mac.
- **Screenshots.** Blocking them is a setting, off by default, and the Android app applies it once the app has read its
  settings at launch.
- **Certificates.** The app trusts the phone's certificate authorities; there's no certificate pinning.
- **Server list at rest.** Panel addresses and user names aren't secret, so they're stored unencrypted (outside
  Android's backups from 0.2.0). They could be moved into the vault, at the cost of "Forgot PIN" also forgetting
  the servers.
- **PIN guessing by code running as the app.** On a rooted phone (or under a debugger), code running as the app can
  still ask the Keystore to check PIN guesses without the wrong-PIN count. Each guess now needs the phone (an HMAC
  computed in the Keystore, in StrongBox where the phone has it), so it can't be run on a graphics card, but a
  6-digit PIN is still short against a patient attacker on the phone itself. A longer PIN is the defence.
- **The weaker vault kinds.** Where there is no key store (desktops, `nsh run`), or it refuses the key, the vault is
  PIN-only and an offline guesser with a copy of the file needs only the PIN's strength; the Security page says when
  the key store refused. Phone vaults made by earlier versions upgrade at the next PIN unlock, and only on a build
  of the Android app that has the HMAC call.
- **Hidden addresses and the copied server list.** Hiding an address changes only what is drawn: Copy still copies the
  real one and the server list stays unencrypted in storage. The server list Settings copies (names, addresses and
  user names, never passwords or sessions) stays on the clipboard until something replaces it, and other apps can
  read the clipboard on some Android versions.
- **Edits while locked.** An unsaved schedule or snapshot form is lost when the app locks (file edits are kept).
- **Concurrent edits.** Saving a schedule replaces what's stored, so an edit made meanwhile in the web panel is
  overwritten (the web panel behaves the same way).
- **Passkeys.** Accounts that sign in with a passkey are sent to the web panel. (Accounts held for a password
  change now set the new password in the app.)
