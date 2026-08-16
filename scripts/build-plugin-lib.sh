#!/bin/bash
# Build the distributable plugin package.
# Default target: ~/dsh-dev/plugin (persistent, gitignored).
# Override with: build-plugin-lib.sh [target-dir]
# Compiles src/ to lib/ (ESM), fixes .ts import specifiers, and stages
# the full installable package layout (src, lib, skills, patch, manifest).
set -euo pipefail

repo=/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec
pkg="${1:-$HOME/dsh-dev/plugin}"

# Stage source and package assets.
rsync -a --delete "$repo/src/" "$pkg/src/"
mkdir -p "$pkg/lib" "$pkg/skills"
rsync -a "$repo/skills/" "$pkg/skills/"
cp "$repo/scripts/cordis.patch.yml" "$pkg/cordis.patch.yml" 2>/dev/null || true
if [ ! -f "$pkg/cordis.patch.yml" ]; then
  cat > "$pkg/cordis.patch.yml" <<'EOF'
# dsh-norm-spec bundle patch: mounts the norm-spec convention adapter.
# The runtime resolves from DSH_NORM_BRIDGE/DSH_NORM_PAYLOAD environment
# variables until packaged distribution exists (D004).
- insert:
    - id: norm
      name: 'dsh-norm-spec'
      config:
        launch:
          command: !!js process.env.DSH_NORM_BRIDGE
          args: !!js "[\"serve\", \"--payload\", process.env.DSH_NORM_PAYLOAD ?? \"\"]"
EOF
fi

# Manifest: installable identity with the bundle declaration dsh requires.
if [ ! -f "$pkg/package.json" ] || [ "${FORCE_MANIFEST:-0}" = "1" ]; then
  cat > "$pkg/package.json" <<'EOF'
{
  "name": "dsh-norm-spec",
  "version": "0.1.0-alpha.1",
  "description": "Rust-backed DeepSeek Harness (dsh) Cordis plugin for norm-spec conventions",
  "license": "MIT",
  "author": "Wade",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "skills", "cordis.patch.yml"],
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-agent": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-llm": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-session": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-skill": "^0.1.0-rc.6"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
EOF
fi

# Compile to ESM lib/ using the repo's pinned TypeScript.
cd "$pkg"
"$repo/node_modules/.bin/tsc" --outDir lib \
  --module nodenext --target es2023 --moduleResolution nodenext \
  --strict --skipLibCheck --verbatimModuleSyntax --lib es2023 \
  src/index.ts 2>/dev/null || true
for f in lib/*.js; do
  sed -i '' 's/\.ts"/\.js"/g; s/\.ts'"'"'/\.js'"'"'/g' "$f"
done

# Verify the built entry imports cleanly.
node -e "import('$pkg/lib/index.js').then(m => {
  const need = ['name','inject','apply'];
  for (const k of need) if (!(k in m)) throw new Error('missing export: ' + k);
  console.log('plugin lib ok:', Object.keys(m).join(','));
})"
echo "built $pkg"
