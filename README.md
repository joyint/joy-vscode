# Joy for VS Code

**Your Joy backlog, right inside the editor.**

A VS Code extension that surfaces the [Joy](https://github.com/joyint/joy) backlog of any repository you open: an activity-bar tree with parent/child nesting, lifecycle actions on each item, and auto-refresh when the underlying files change. Part of the [Joyint](https://github.com/joyint) ecosystem.

## Install

**From the Marketplace**: open the Extensions view, search for **Joy**, and install `joyint.joy-vscode`. Also on the [Open VSX Registry](https://open-vsx.org/extension/joyint/joy-vscode) for VSCodium, Cursor, and other Open VSX editors.

**From a VSIX**: grab it from the [latest GitHub release](https://github.com/joyint/joy-vscode/releases/latest) and install it one of two ways:

**Command line** (works on Linux, macOS, Windows):

```sh
code --install-extension joy-vscode-X.Y.Z.vsix
```

**VS Code UI**: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **Extensions: Install from VSIX...**, then pick the downloaded file.

## Requirements

The [joy CLI](https://github.com/joyint/joy) must be installed on your system. The extension shells out to it for every read and write and does not bundle a binary.

On first activation the extension auto-discovers `joy` via PATH, your login shell, and common install locations (`~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/.cargo/bin`, plus the Windows equivalents). The resolved path appears in the status bar; click it to override via a guided dialog. The path can also be set explicitly via the `joy.executablePath` setting.

## Features

- **Backlog tree** in a dedicated Joy activity-bar container - milestones as top-level groups (plus a "No Milestone" group), items nested by parent, ordered oldest or newest first via a title-bar toggle.
- **Structural drag and drop** in the tree: drop an item on another item to re-parent it, on the "No Milestone" group or empty area to un-parent / unlink it, on a milestone to link it. Right-click an item to remove its parent. No manual ordering.
- **New Item / New Milestone** buttons in the view title.
- **Item detail form**, in the secondary side bar by default: edit title, type, priority, effort, milestone, and description; add and remove parent, assignees, and dependencies; trigger lifecycle verbs; read and add comments.
- **Board** with status columns and a Mine filter: drag cards between columns to change status, click a card to open it, filter by id or title, and sort by updated, created, id, title, effort, priority, or type.
- **Editor links**: Joy item ids (`ACRONYM-XXXX`) in code, Markdown, or commit messages become links that open the item, with a hover showing its title and status.
- **GitHub Copilot integration**: the **Joy: Init Copilot** command teaches Copilot the Joy workflow and adds a `/joy` prompt to Copilot Chat — see [GitHub Copilot integration](#github-copilot-integration).
- **Authentication built in**: a modal passphrase prompt (with reveal toggle) appears when joy requires auth; the failed action retries automatically after login.
- **Live refresh** on changes under `.joy/items/` (debounced) so tree, detail, and board stay in sync with terminal use, `git pull`, or AI edits.
- **Compact status bar entry**: check when ready, key when unauthenticated, warning when the CLI is missing or too old - details in the tooltip.
- **Cross-platform**: Linux, macOS, and Windows.

## GitHub Copilot integration

Run **Joy: Init Copilot** from the Command Palette to wire Copilot into this repo. It runs `joy ai init --tool copilot` (prompting once for your Joy passphrase) and:

- writes `.github/copilot-instructions.md`, so Copilot Chat knows to drive the backlog through the `joy` CLI instead of reading or editing `.joy/` files directly;
- adds a **`/joy`** prompt (`.github/prompts/joy.prompt.md`) — type `/joy` in Copilot Chat to get the Joy-aware assistant;
- registers the `ai:copilot@joy` member so Copilot's commits are attributed.

Pick a capable Copilot model (for example a full GPT-5 or a Claude model). Smaller models such as GPT-5 mini tend to ignore custom instructions and count `.joy/` files by hand instead of running `joy ls`.

## Documentation

- [Vision](VISION.md) - what's in and out of scope
- [Architecture](ARCHITECTURE.md) - how the extension talks to the joy CLI
- [Contributing](CONTRIBUTING.md) - coding conventions, development setup, commit messages

## Status

Published to the VS Code Marketplace and Open VSX. Each `vX.Y.Z` tag (pushed by `just publish` / `joy release publish`) drives a GitHub release plus the Marketplace and Open VSX uploads from CI. Tracked under [JVSC-0001-D4](https://github.com/joyint/joy-vscode) and the milestones beneath it.

## License

[MIT](LICENSE).
