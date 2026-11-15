# Security

This file covers how AMP Mobile protects your panel access, what five audits (November 2026) found and fixed,
and what's still open. To report a problem, open an issue (or contact the owner privately if it's
sensitive).

## What the app keeps, and where

| What | Where | Protection |
|---|---|---|
| Passwords | Nowhere | Sent once to your panel at sign-in, then dropped |
| Session tokens you keep ("Stay signed in") | `amp.vault` in the app's storage | AES-256-GCM under a random data key. On Android that key is sealed by keys in the phone's Keystore (secure hardware), which never leave it: one together with your PIN (PBKDF2-SHA-256, 600,000 rounds), and a second way in that's either quick unlock (works only within a minute of unlocking the phone) or, with fingerprint unlock on, a key that needs a fingerprint or face check (strong biometrics) for each use and is voided when a fingerprint or face is added. Without a key store (desktops): the PIN-derived key alone. The PIN is never stored |
| Session tokens you don't keep | Memory only | Gone when the app closes or locks |
| Server list (name, address, user name) | `amp.servers` in the app's storage | Not secret, so not encrypted |
| Wrong-PIN count | `amp.vault.lockout` | Survives restarts |

The app's storage is a file in its private folder that other apps can't read. From 0.2.0 the app is left out of
Android's backups; before that, Android copied the file into Google backups, which is why tokens have always been
encrypted rather than stored as they are (and the vault can't be opened on another phone anyway).

## The app lock

- Staying signed in requires a 6–12 digit PIN. Repeated or sequential PINs (`777777`, `123456`) are refused.
- The app opens locked, and locks again after a chosen time in the background (immediately, 30 s, 1 min or 5 min).
- It opens with the PIN, or by itself within a minute of unlocking the phone (quick unlock). With fingerprint unlock
  on (Security; Android 11+, strong biometrics), it asks for a fingerprint or face instead, and doesn't open by
  itself; the PIN always works too. "Lock now" doesn't reopen by itself until you leave the app and come back.
- While locked, no session is in memory and none of your pages are drawn behind the lock screen.
- While the app is in the background its screen is covered, so the app switcher shows nothing.
- After 5 wrong PINs each try waits longer (30 s, 1 min, 5 min, 15 min). The 10th erases the saved sign-ins; your
  servers stay, signed out. "Forgot PIN?" does the same.

## Hide personal details

A switch in Security (off by default) for screenshots, screen sharing and streams; screenshots are always allowed.
While it's on:

- Addresses (the panel's, IPs, host names, connect and tunnel addresses, trusted proxies, session IPs, and IPs inside
  console lines and event details), account and player names, avatars, emails and invite links are drawn as a
  blurred stand-in of the same shape. Only the hidden parts of a line blur; the words around them stay sharp.
- The real text isn't drawn under the blur, so a capture can't be zoomed to read it. Where the phone can't blur
  (before Android 12) the stand-in shows as dots.
- Form fields holding a name or an address (sign-in, users, invites) are blurred too, and still take typing.
- Copy buttons still copy the real value.
- The choice is read before anything is shown at launch, so nothing flashes unhidden.

## Connections

- **HTTPS by default; plain HTTP only when typed, and warned about.** HTTPS is assumed when no scheme is typed. A
  plain `http://` address (and `ws://` for its console) is taken only when typed so, and how the app treats it
  depends on where it leads:
  - **Tailscale** (100.64.0.0/10, fd7a:115c:a1e0::/48, `*.ts.net`): its WireGuard tunnel encrypts the connection, so
    there's no warning; the server card says "HTTP over Tailscale".
  - **Local network** (private and loopback ranges, `.local` and dotless names): a red "Not secure" warning, and a
    confirmation before every sign-in, as any device on the network could read the password and token.
  - **Internet**: the same warning, stronger, and a box to tick before every sign-in.
  Such a server's card carries a red "Not secure" badge. Addresses with a user name or password in them are
  refused.
- **Enforced twice.** The app checks every address, and `nsh.json` declares capabilities so NSH's runtime refuses
  anything else for every request, image and WebSocket. NSH's capabilities can't name an address range, so they
  allow `http`/`ws` to any host; the warnings above are the app's own. `https`/`wss` are as before, and links open
  only over `https` (or `http` for a plain-HTTP panel's own downloads, pinned to its host). Also allowed: the clipboard,
  the file picker, and the Android app's key-store calls (`deviceKey.*`); nothing else at all (no file system,
  processes, sockets, web views, notifications or audio).
- **Online check.** The home page asks each panel for its password policy (no sign-in needed), sending no token,
  and never while the app is locked.
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

## Sixth audit: Hide personal details (November 2026, 0.2.3)

Covers everything since 0.2.2: Hide personal details, the Security page, and the removal of the test builds'
screenshot blocking.

| # | Finding | Severity | Status |
|---|---|---|---|
| 55 | The setting loaded separately from the server list, so the home page could show real details for a moment at launch | Low | Fixed: it's read before anything is shown |
| 56 | Two quick switches could save out of order, and a slow load could undo a switch made meanwhile | Low | Fixed: saves in order, and a load never overrides a newer choice |
| 57 | Dialog and menu titles showed hidden details as plain dots, and the sign-in, user and invite forms showed names and addresses in their fields | Low | Fixed: blurred like the rest |
| 58 | An event's details hid any key containing "ip", such as "description" | Info | Fixed: keys are read by their words |
| 59 | A failed save of the switch was an unhandled error | Info | Fixed |

Checked and found sound: the real text is never drawn under the blur (copy buttons use the real value), IPs in
console lines are caught without catching times or version numbers, the old screenshot setting is cleared on
launch so screenshots always work, and nothing else changed in the vault, the lock, sign-in or connections.

## Seventh audit: mobile app assessment (November 2026, 0.2.4)

Following OWASP MASTG (the mobile app pentest, insecure data storage and secret scanning checklists): the release
APK's manifest, the app's files on a device, its logs on a real phone, crafted intents against its components, and
every commit in the repository's history.

| # | Finding | Severity | Status |
|---|---|---|---|
| 60 | On Android 12+, `allowBackup="false"` doesn't cover phone-to-phone transfer, so the app's files (the server list; the vault can't be opened elsewhere) would move to a new phone | Low | Fixed: data extraction rules exclude everything from cloud backups and transfers |

Checked and found sound:
- **Build:** not debuggable, no cleartext traffic, two permissions (internet, fingerprint), no web view.
- **Components:** only the launcher entry is exported. The activity and the file provider refuse outside callers, and
  a crafted link with fake extras just opens the lock screen.
- **Storage:** the app's only data is one owner-only JSON file holding the server list, settings and the vault
  (encrypted `iv`/`ct` and sealed keys). No password, token or JWT is anywhere on disk, there's no database, nothing
  on shared storage and no cached images.
- **Logs:** on a phone in daily use, the app's own log lines hold no token, ticket, password, IP or panel address.
- **Repository:** all 62 commits are free of keys, tokens, private keys, keystores and env files, and of the user's
  panel address and email.
- **Fingerprint unlock:** opens a Keystore key (CryptoObject) a real fingerprint unlocks, so hooking the prompt's
  success callback can't open the vault.

## Release signing

From 0.1.7 the APKs are signed with the app's own release key (RSA 4096), kept off the repository by its owner.
Android installs an update only when it's signed by the same key, so nobody without it can ship an update that
replaces the app and reads its data. Earlier builds used a development key. The certificate's SHA-256 fingerprint is
`bac44fe4b557bb334bedbd20bc1c39df3f202438c4d3c340e299b9406d5e6dbb`.

## Still open

- **PIN strength where there's no key store.** On Android the vault is bound to the phone's Keystore, so a copy of
  the file is useless elsewhere. Elsewhere (desktops) the vault is only as strong as the PIN.
- **iOS.** The Keychain and Face ID need the same work in an Xcode project, which needs a Mac.
- **Certificates.** The app trusts the phone's certificate authorities; there's no certificate pinning (panels
  bring their own certificates, so there's nothing fixed to pin to).
- **Plain HTTP, when chosen.** A plain-HTTP panel outside Tailscale sends the password and session token
  unencrypted; the warning and the confirmation are the only guard, and people learn to tap through warnings. The
  Tailscale class relies on the address really being Tailscale's: 100.64.0.0/10 is also the range ISPs use for
  carrier-grade NAT, where a 100.x address off your tailnet would get no warning. Android's own block on plain HTTP
  is lifted for the app (it can't be scoped), so these checks are the app's alone.
- **Rooted phones and tampering.** The app doesn't detect a rooted phone or a modified APK. On a rooted phone,
  code running as the app could reach the vault as the app does (still behind the PIN or fingerprint).
- **Server list at rest.** Panel addresses and user names aren't secret, so they're stored unencrypted (outside
  Android's backups from 0.2.0). They could be moved into the vault, at the cost of "Forgot PIN" also forgetting
  the servers.
- **PIN guessing on the phone itself.** The vault's PIN-bound key works without a recent phone unlock, so code
  running as the app on an unlocked or rooted phone could try PINs without the wrong-PIN count. Each try still costs
  600,000 PBKDF2 rounds on the phone; a longer PIN makes this impractical.
- **Hidden fields on older phones.** Before Android 12 views can't be blurred: hidden text still shows as dots, but
  the text in a form field (sign-in user name, a new user's details) shows as typed.
- **Edits while locked.** An unsaved schedule or snapshot form is lost when the app locks (file edits are kept).
- **Concurrent edits.** Saving a schedule replaces what's stored, so an edit made meanwhile in the web panel is
  overwritten (the web panel behaves the same way).
- **Passkeys.** Accounts that sign in with a passkey are sent to the web panel. (Accounts held for a password
  change now set the new password in the app.)
