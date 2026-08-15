#!/bin/bash
# Build the local sealed-payload runtime for dsh-norm-spec development.
#
# Downloads the exact norm-spec release archive pinned by the compiled
# bridge (authoritative pin, not a local dist build), verifies its
# checksum, stages it into .local-runtime/upstream/, seals it with the
# bridge's own sealing command, and builds the release bridge binary.
#
# Usage: bash scripts/build-local-runtime.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$repo/.local-runtime"
upstream="$runtime/upstream"
bridge="$repo/target/release/dsh-norm-bridge"
target="$(rustc -vV | sed -n 's/^host: //p')"

echo "==> building release bridge"
cargo build --release -p dsh-norm-bridge

echo "==> resolving pinned upstream asset for $target"
pin="$("$bridge" upstream-pin --target "$target")"
asset="$(printf '%s\n' "$pin" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
expected_sha="$(printf '%s\n' "$pin" | sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p')"
url="$(printf '%s\n' "$pin" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
if [[ -z "$asset" || ! "$expected_sha" =~ ^[0-9a-f]{64}$ || -z "$url" ]]; then
  echo "error: compiled upstream asset pin could not be read" >&2
  exit 1
fi

archive="$runtime/$asset"
mkdir -p "$runtime"

if [[ -f "$archive" && "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$expected_sha" ]]; then
  echo "==> cached archive verified: $asset"
else
  echo "==> downloading $url"
  rm -f "$archive"
  curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
    --connect-timeout 20 --max-time 180 --retry 4 --retry-all-errors \
    --retry-delay 2 --retry-max-time 180 \
    "$url" --output "$archive"
  actual_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "error: downloaded archive checksum mismatch: $actual_sha != $expected_sha" >&2
    exit 1
  fi
fi

echo "==> staging upstream archive"
rm -rf "$upstream"
mkdir -p "$upstream"
tar xzf "$archive" -C "$upstream" --strip-components=1
# The sealed payload retains the release's checksum line as provenance.
printf '%s  %s\n' "$expected_sha" "$asset" > "$upstream/archive.sha256"

echo "==> sealing payload"
"$bridge" upstream-seal --payload "$upstream"

echo "==> verifying payload"
"$bridge" upstream-verify --payload "$upstream"

cat <<RUNTIME

Local runtime ready:
  DSH_NORM_BRIDGE=$bridge
  DSH_NORM_PAYLOAD=$upstream

Export these before starting dsh with the plugin.
RUNTIME
