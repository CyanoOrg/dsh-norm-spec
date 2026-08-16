#!/bin/bash
# Build and stage one native platform package candidate, then npm pack it.
#
# Runs on the host toolchain (CI matrix runners are native for each target).
# Downloads the exact norm-spec release archive pinned by the compiled bridge
# (authoritative pin, not a local dist build), verifies its checksum, seals
# the payload, stages the platform package, and packs the exact tarball plus
# its sha256 sidecar into the output directory.
#
# Usage: build-platform-candidate.sh <rust-target> <output-dir>
# Prints the tarball path as JSON on the last stdout line.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:?usage: build-platform-candidate.sh <rust-target> <output-dir>}"
output_dir="${2:?usage: build-platform-candidate.sh <rust-target> <output-dir>}"

# Portable sha256: sha256sum (git-bash, linux) or shasum (macOS).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256sum or shasum is required" >&2
    return 1
  fi
}

runtime="$repo/.local-runtime"
upstream="$runtime/upstream"
bridge="$repo/target/release/dsh-norm-bridge"

if [[ ! -x "$bridge" ]]; then
  echo "error: release bridge not built: $bridge" >&2
  exit 1
fi

version="$(cd "$repo" && node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")"
pin="$("$bridge" upstream-pin --target "$target")"
asset="$(printf '%s\n' "$pin" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
expected_sha="$(printf '%s\n' "$pin" | sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p')"
url="$(printf '%s\n' "$pin" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
if [[ -z "$asset" || ! "$expected_sha" =~ ^[0-9a-f]{64}$ || -z "$url" ]]; then
  echo "error: compiled upstream asset pin could not be read" >&2
  exit 1
fi

archive="$runtime/$asset"
mkdir -p "$runtime" "$output_dir"
if [[ -f "$archive" && "$(sha256_of "$archive")" == "$expected_sha" ]]; then
  echo "==> cached archive verified: $asset"
else
  echo "==> downloading $url"
  rm -f "$archive"
  curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
    --connect-timeout 20 --max-time 180 --retry 4 --retry-all-errors \
    --retry-delay 2 --retry-max-time 180 \
    "$url" --output "$archive"
  actual_sha="$(sha256_of "$archive")"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "error: downloaded archive checksum mismatch: $actual_sha != $expected_sha" >&2
    exit 1
  fi
fi

echo "==> staging upstream payload"
rm -rf "$upstream"
mkdir -p "$upstream"
tar xzf "$archive" -C "$upstream" --strip-components=1
# The sealed payload retains the release's checksum line as provenance.
printf '%s  %s\n' "$expected_sha" "$asset" > "$upstream/archive.sha256"

echo "==> sealing payload"
"$bridge" upstream-seal --payload "$upstream"
"$bridge" upstream-verify --payload "$upstream"

echo "==> staging and packing the platform candidate"
BUILD_TARGET="$target" BUILD_OUTPUT="$output_dir" node --experimental-strip-types "$repo/scripts/pack-platform.mjs"

echo "==> candidate ready"
