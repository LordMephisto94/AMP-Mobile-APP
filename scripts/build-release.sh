#!/usr/bin/env bash
# Builds the two release APKs, signed with the release key:
#   .nsh/out/AMP-Mobile-vX.Y.Z.apk           phones (arm64-v8a, armeabi-v7a)
#   .nsh/out/AMP-Mobile-vX.Y.Z-all-abis.apk  arm64-v8a, armeabi-v7a and x86_64
#
# The key stays outside the repository. Override its place with AMP_RELEASE_KEYSTORE.
# The password is asked for (never echoed) unless NSH_KEYSTORE_PASSWORD is already set.
set -euo pipefail

cd "$(dirname "$0")/.."

KEYSTORE="${AMP_RELEASE_KEYSTORE:-$HOME/.android/amp-mobile-release.jks}"
ALIAS="${AMP_RELEASE_ALIAS:-amp-mobile}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$HOME/Android/Sdk/ndk/30.0.16248370}"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "No release key at $KEYSTORE (see README, \"Release signing\")." >&2
  exit 1
fi

if [[ -z "${NSH_KEYSTORE_PASSWORD:-}" ]]; then
  read -rsp "Release key password: " NSH_KEYSTORE_PASSWORD
  echo
fi
export NSH_KEYSTORE_PASSWORD

# Check the password and alias before spending minutes on the build.
if ! keytool -list -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env NSH_KEYSTORE_PASSWORD >/dev/null 2>&1; then
  echo "The password is wrong, or the key has no alias \"$ALIAS\"." >&2
  exit 1
fi

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' nsh.json | head -1)"
SIGN=(--keystore "$KEYSTORE" --key-alias "$ALIAS")

rm -rf .nsh/release-arm .nsh/release
nsh package --target android "${SIGN[@]}" -o .nsh/release-arm
nsh package --target android --abi arm64-v8a,armeabi-v7a,x86_64 "${SIGN[@]}" -o .nsh/release

mkdir -p .nsh/out
cp .nsh/release-arm/*.apk ".nsh/out/AMP-Mobile-v$VERSION.apk"
cp .nsh/release/*.apk ".nsh/out/AMP-Mobile-v$VERSION-all-abis.apk"
echo "Built (signed with $ALIAS):"
ls -l .nsh/out/AMP-Mobile-v"$VERSION"*.apk
