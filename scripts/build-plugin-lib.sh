#!/bin/bash
# Build the distributable plugin package under /tmp/dsh-e2e/plugin.
# Compiles src/ to lib/ (ESM) and fixes .ts import specifiers.
set -euo pipefail

repo=/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec
pkg=/tmp/dsh-e2e/plugin

rsync -a --delete "$repo/src/" "$pkg/src/"
mkdir -p "$pkg/lib"
cd "$pkg"
npx tsc --outDir lib \
  --module nodenext --target es2023 --moduleResolution nodenext \
  --strict --skipLibCheck --verbatimModuleSyntax --lib es2023 \
  src/index.ts 2>/dev/null || true
for f in lib/*.js; do
  sed -i '' 's/\.ts"/\.js"/g; s/\.ts'"'"'/\.js'"'"'/g' "$f"
done
node -e "import('$pkg/lib/index.js').then(m => {
  const need = ['name','inject','apply'];
  for (const k of need) if (!(k in m)) throw new Error('missing export: ' + k);
  console.log('plugin lib ok:', Object.keys(m).join(','));
})"
echo "built $pkg/lib"
