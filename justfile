# Joy VS Code extension -- Task Runner
#
# Lifecycle recipes mirror the umbrella's expectations: install, check,
# release, publish. `just publish` pushes the tag; the tag push then drives
# the GitHub release and the Marketplace + Open VSX upload from CI
# (.github/workflows/release.yml).

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

# Check tools and deps.
doctor:
    #!/usr/bin/env bash
    red=$'\033[31m' orange=$'\033[38;5;208m' reset=$'\033[0m'
    ok()   { local v; v=$("$1" --version 2>/dev/null) && echo "  $2: $v" || echo "  $2: ok"; }
    miss() { printf "  %s%s: MISSING%s\n" "$red" "$1" "$reset"; }
    opt()  { printf "  %s%s: MISSING (%s)%s\n" "$orange" "$1" "$2" "$reset"; }
    # Warn if the active node major differs from the nearest .nvmrc (portable: nvm/fnm/asdf all read it).
    nvmrc_check() {
        local want have file
        for file in ../.nvmrc .nvmrc; do [ -f "$file" ] && { want=$(tr -d '[:space:]' <"$file"); break; }; done
        { [ -n "$want" ] && command -v node >/dev/null; } || return 0
        want=${want#v}; want=${want%%.*}
        case "$want" in ''|*[!0-9]*) return 0;; esac   # non-numeric alias (e.g. lts/jod): can't compare, skip
        have=$(node --version | sed 's/^v//;s/\..*//')
        [ "$want" = "$have" ] || printf "  %snode: v%s but .nvmrc wants %s (run 'nvm use')%s\n" "$orange" "$(node --version | sed s/^v//)" "$want" "$reset"
    }
    command -v node >/dev/null && ok node node || miss node
    nvmrc_check
    command -v npm  >/dev/null && ok npm npm   || miss npm
    test -x node_modules/.bin/tsc             && echo "  tsc (node_modules): ok" || opt "tsc (node_modules)" "run just joy-vscode install"
    command -v gh   >/dev/null && ok gh "gh (GitHub CLI)" || opt "gh" "https://cli.github.com"

# Typecheck, lint, format-check, and run unit tests.
check:
    npm run check

# Build the shippable VSIX into package/ (bundles via esbuild, then packages).
build:
    npm run build
    npm run package

# Run extension-host tests via @vscode/test-cli.
test-integration:
    npm run test:integration

# Package the VSIX into package/ (bundle runs via the vsce prepublish hook).
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

# Push commits + tag. The pushed tag triggers .github/workflows/release.yml,
# which builds the VSIX, creates/updates the GitHub release, and uploads to
# the VS Code Marketplace and Open VSX.
publish:
    joy release publish
