#!/usr/bin/env bash
# Builds the two release APKs with Gradle (android/), signed with the release key:
#   .nsh/out/AMP-Mobile-vX.Y.Z.apk           phones (arm64-v8a, armeabi-v7a)
#   .nsh/out/AMP-Mobile-vX.Y.Z-all-abis.apk  arm64-v8a, armeabi-v7a and x86_64
#
# The key stays outside the repository. Override its place with AMP_RELEASE_KEYSTORE.
# The password is asked for (never echoed) unless AMP_KEYSTORE_PASSWORD is already set.
set -euo pipefail

cd "$(dirname "$0")/.."

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
