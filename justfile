# Joy VS Code extension -- Task Runner
#
# Lifecycle recipes mirror the umbrella's expectations: install, check,
# release, publish. Marketplace upload (vsce + ovsx) lands with JVSC-0006-79.

# List recipes
default:
    @just --list

# Stage and commit Joy's own generated files (items, logs, releases)
# so the working tree is clean before release runs its check.
[private]
auto-commit:
    #!/usr/bin/env bash
    set -euo pipefail
    staged=false
    for f in .joy/items .joy/logs .joy/releases; do
        if [ -e "$f" ] && ! git diff --quiet -- "$f" 2>/dev/null; then
            git add "$f"
            staged=true
        fi
    done
    if [ "$staged" = true ]; then
        git commit --quiet -m "chore: update generated files [no-item]"
        echo "Committed pending changes."
    fi

# Install npm dependencies.
install:
    npm ci

# Typecheck, lint, format-check, and run unit tests.
check:
    npm run check

# Bundle the extension into dist/extension.js.
build:
    npm run build

# Run extension-host tests via @vscode/test-cli.
test-integration:
    npm run test:integration

# Build a local VSIX (joy-vscode-X.Y.Z.vsix in the working tree).
package:
    npm run package

# Local-only release: bump version files, record, commit, tag.
# Follow with `just publish` once this succeeds.
release bump="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    if git describe --tags --exact-match HEAD >/dev/null 2>&1; then
        echo "No changes since last tag, skipping."
        exit 0
    fi
    just auto-commit
    if ! command -v joy >/dev/null 2>&1 || ! [ -f ".joy/project.yaml" ]; then
        echo "No Joy project found. Use joy init to set up."
        exit 1
    fi
    if ! joy release show >/dev/null 2>&1; then
        echo "No items closed since last release."
        exit 0
    fi
    # joy release show writes a log line, absorb it before the clean check.
    just auto-commit
    if [ -n "$(git status --porcelain)" ]; then
        echo "Error: working tree is not clean."
        exit 1
    fi
    joy release bump "{{bump}}"
    joy release record "{{bump}}"
    tag=$(git describe --tags --exact-match HEAD 2>/dev/null || echo "unknown")
    echo "Tagged ${tag} locally. Run 'just publish' to ship."

# Push commits + tag and create the GitHub release.
# Marketplace + Open VSX upload is added by JVSC-0006-79.
publish:
    joy release publish
