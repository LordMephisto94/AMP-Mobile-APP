#!/usr/bin/env bash
# Puts NSH's Android runtime (nsh.aar, about 70 MB) where the Gradle build looks for it:
# android/nsh-sdk/nsh.aar. Its version must match the `nsh` that compiles the app's bundle.
# The download is checked against the SHA-256 NSH published with the release.
set -euo pipefail

cd "$(dirname "$0")/.."

NSH_VERSION="0.5.0"
ZIP_SHA256="4e0c943c75c4618e84a0139394719068de341f5c4386714502a2fb1cba802d7f"
URL="https://github.com/longbridge/nsh/releases/download/v$NSH_VERSION/nsh-embed-android.zip"

installed="$(nsh --version | awk '{print $2}')"
if [[ "$installed" != "$NSH_VERSION" ]]; then
  echo "nsh is $installed but this script fetches the $NSH_VERSION runtime: update both together." >&2
  exit 1
fi

cache="${XDG_CACHE_HOME:-$HOME/.cache}/nsh-embed/$NSH_VERSION"
mkdir -p "$cache"
if [[ ! -f "$cache/nsh-embed-android.zip" ]] || ! echo "$ZIP_SHA256  $cache/nsh-embed-android.zip" | sha256sum -c --quiet 2>/dev/null; then
  echo "Downloading the NSH $NSH_VERSION Android runtime…"
  curl -fL --progress-bar -o "$cache/nsh-embed-android.zip" "$URL"
  echo "$ZIP_SHA256  $cache/nsh-embed-android.zip" | sha256sum -c --quiet
fi

mkdir -p android/nsh-sdk
unzip -oqj "$cache/nsh-embed-android.zip" nsh-embed-android/nsh.aar -d android/nsh-sdk
echo "android/nsh-sdk/nsh.aar ready (NSH $NSH_VERSION)."
