#!/usr/bin/env bash
# Builds the two release APKs with Gradle (android/), signed with the release key:
#   .nsh/out/AMP-Mobile-vX.Y.Z.apk           phones (arm64-v8a, armeabi-v7a)
#   .nsh/out/AMP-Mobile-vX.Y.Z-all-abis.apk  arm64-v8a, armeabi-v7a and x86_64
#
# The key stays outside the repository. Override its place with AMP_RELEASE_KEYSTORE.
#
# The password comes from, in order: AMP_KEYSTORE_PASSWORD in the environment; an env file
# (AMP_RELEASE_ENV, else ~/.config/amp-mobile/release.env, else .env.release or .env in the
# repository, which git ignores); else it's asked for (never echoed). The env file is read as plain
# KEY=VALUE lines, never run, and must be readable by you alone (chmod 600). See
# release.env.example.
set -euo pipefail

cd "$(dirname "$0")/.."

# Reads AMP_KEYSTORE_PASSWORD, AMP_RELEASE_KEYSTORE and AMP_RELEASE_ALIAS from an env file,
# without overriding what the environment already sets.
load_env_file() {
  local file="$1" mode line key value
  mode="$(stat -c '%a' "$file")"
  if [[ "${mode: -2}" != "00" ]]; then
    echo "$file can be read by other users (mode $mode). Run: chmod 600 \"$file\"" >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    # Matching quotes around the whole value are dropped; the rest is taken as it is.
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
    case "$key" in
      AMP_KEYSTORE_PASSWORD | AMP_RELEASE_KEYSTORE | AMP_RELEASE_ALIAS)
        [[ -z "${!key:-}" ]] && printf -v "$key" '%s' "$value"
        ;;
      *) echo "Ignoring unknown setting \"$key\" in $file" >&2 ;;
    esac
  done <"$file"
  echo "Using the release settings in $file"
}

for candidate in "${AMP_RELEASE_ENV:-}" "${XDG_CONFIG_HOME:-$HOME/.config}/amp-mobile/release.env" .env.release .env; do
  if [[ -n "$candidate" && -f "$candidate" ]]; then
    load_env_file "$candidate"
    break
  fi
done

KEYSTORE="${AMP_RELEASE_KEYSTORE:-$HOME/.android/amp-mobile-release.jks}"
ALIAS="${AMP_RELEASE_ALIAS:-amp-mobile}"
export AMP_RELEASE_KEYSTORE="$KEYSTORE" AMP_RELEASE_ALIAS="$ALIAS"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "No release key at $KEYSTORE (see README, \"Release signing\")." >&2
  exit 1
fi
[[ -f android/nsh-sdk/nsh.aar ]] || scripts/fetch-nsh-sdk.sh

if [[ -z "${AMP_KEYSTORE_PASSWORD:-}" ]]; then
  read -rsp "Release key password: " AMP_KEYSTORE_PASSWORD
  echo
fi
export AMP_KEYSTORE_PASSWORD

# Check the password and alias before spending minutes on the build.
if ! keytool -list -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env AMP_KEYSTORE_PASSWORD >/dev/null 2>&1; then
  echo "The password is wrong, or the key has no alias \"$ALIAS\"." >&2
  exit 1
fi

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' nsh.json | head -1)"
APK=android/app/build/outputs/apk/release/app-release.apk
mkdir -p .nsh/out

(cd android && ./gradlew --no-daemon -q clean assembleRelease -Pabis=arm64-v8a,armeabi-v7a)
cp "$APK" ".nsh/out/AMP-Mobile-v$VERSION.apk"
(cd android && ./gradlew --no-daemon -q assembleRelease -Pabis=arm64-v8a,armeabi-v7a,x86_64)
cp "$APK" ".nsh/out/AMP-Mobile-v$VERSION-all-abis.apk"

echo "Built (signed with $ALIAS):"
ls -l .nsh/out/AMP-Mobile-v"$VERSION"*.apk
