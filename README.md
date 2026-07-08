# Joy for VS Code

**Your Joy backlog, right inside the editor.**

A VS Code extension that surfaces the [Joy](https://github.com/joyint/joy) backlog of any repository you open: an activity-bar tree with parent/child nesting, lifecycle actions on each item, and auto-refresh when the underlying files change. Part of the [Joyint](https://github.com/joyint) ecosystem.

## Install (preview)

The extension is not on the Marketplace yet. Grab the VSIX from the [latest GitHub release](https://github.com/joyint/joy-vscode/releases/latest) and install it one of two ways:

**Command line** (works on Linux, macOS, Windows):

```sh
code --install-extension joy-vscode-X.Y.Z.vsix
```

**VS Code UI**: open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **Extensions: Install from VSIX...**, then pick the downloaded file.

Updates ship as new GitHub releases - install the newer VSIX over the old one with the same command.

## Requirements

The [joy CLI](https://github.com/joyint/joy) must be installed on your system. The extension shells out to it for every read and write and does not bundle a binary.

On first activation the extension auto-discovers `joy` via PATH, your login shell, and common install locations (`~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/.cargo/bin`, plus the Windows equivalents). The resolved path appears in the status bar; click it to override via a guided dialog. The path can also be set explicitly via the `joy.executablePath` setting.

## Features

- **Backlog tree** in a dedicated Joy activity-bar container - milestones as top-level groups, items nested by parent, sorted by status then priority.
- **Structural drag and drop** in the tree: drop an item on another item to re-parent it, on the empty area to un-parent it, on a milestone to link it. No manual ordering.
- **New Item / New Milestone** buttons in the view title.
- **Item detail form** (movable to the secondary sidebar): edit title, type, priority, effort, milestone, and description, trigger lifecycle verbs, read and add comments.
- **Board** with New, In progress, Review, and Done columns: drag cards between columns to change status, double-click to edit, instant filter on id and title, sortable by updated, created, id, title, effort, priority, or type.
- **Authentication built in**: a modal passphrase prompt (with reveal toggle) appears when joy requires auth; the failed action retries automatically after login.
- **Live refresh** on changes under `.joy/items/` (debounced) so tree, detail, and board stay in sync with terminal use, `git pull`, or AI edits.
- **Compact status bar entry**: check when ready, key when unauthenticated, warning when the CLI is missing or too old - details in the tooltip.
- **Cross-platform**: Linux, macOS, and Windows.

## Documentation

- [Vision](VISION.md) - what's in and out of scope
- [Architecture](ARCHITECTURE.md) - how the extension talks to the joy CLI
- [Contributing](CONTRIBUTING.md) - coding conventions, development setup, commit messages

## Status

Pre-release. Tracked under [JVSC-0001-D4](https://github.com/joyint/joy-vscode) and the milestones beneath it. Marketplace + Open VSX publishing is on the roadmap (`JVSC-0006-79`).

## License

[MIT](LICENSE).
