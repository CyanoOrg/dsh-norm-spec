#!/bin/bash
# Bump the release version across all eight sites (seven manifests plus
# the intra-workspace engine pin in crates/dsh-norm-bridge/Cargo.toml —
# the site missed in 8dfe0f0, 0.2.2, and 0.2.3) and refresh both locks.
# Guards before mutating, verifies no residual old string after.
# Usage: bash scripts/promote-version.sh <old> <new>
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
old="${1:?usage: promote-version.sh <old> <new>}"
new="${2:?usage: promote-version.sh <old> <new>}"

cd "$repo"
if [[ -n "$(git status --porcelain -- Cargo.toml package.json packages Cargo.lock package-lock.json crates)" ]]; then
  echo "error: dirty tree under bump paths; commit or stash first" >&2
  exit 1
fi

manifests=(
  Cargo.toml
  package.json
  packages/darwin-arm64/package.json
  packages/darwin-x64/package.json
  packages/linux-x64/package.json
  packages/root/package.json
  packages/win32-x64/package.json
  crates/dsh-norm-bridge/Cargo.toml
)
for f in "${manifests[@]}"; do
  if ! grep -q "$old" "$f"; then
    echo "error: $f does not carry $old — refusing to bump" >&2
    exit 1
  fi
done

sed -i '' "s/^version = \"$old\"$/version = \"$new\"/" Cargo.toml
sed -i '' "s/\"version\": \"$old\"/\"version\": \"$new\"/" package.json \
  packages/darwin-arm64/package.json packages/darwin-x64/package.json \
  packages/linux-x64/package.json packages/win32-x64/package.json
sed -i '' "s/\"$old\"/\"$new\"/g" packages/root/package.json
sed -i '' "s|version = \"$old\" }|version = \"$new\" }|" crates/dsh-norm-bridge/Cargo.toml

cargo update --workspace
npm install --package-lock-only

for f in "${manifests[@]}"; do
  if grep -q "$old" "$f"; then
    echo "error: residual $old in $f" >&2
    exit 1
  fi
done

echo "bumped $old -> $new across ${#manifests[@]} sites; locks refreshed"
git diff --stat
