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

On first activation the extension auto-discovers `joy` via PATH, your login shell, and common install locations (`~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/go/bin`, `~/.cargo/bin`, plus the Windows equivalents). The resolved path appears in the status bar; click it to override via a guided dialog. The path can also be set explicitly via the `joy.executablePath` setting.

## Features

- **Backlog tree** in a dedicated Joy activity-bar container - items nested by parent, sorted by status then priority.
- **Lifecycle actions** on each item via right-click context menu: Start, Submit for Review, Close, Reopen - visible only when the item's status allows the transition.
- **Show Details** opens the full `joy show <ID>` output in a preview document.
- **Live refresh** on changes under `.joy/items/` (debounced) so the tree stays in sync with terminal use, `git pull`, or AI edits.
- **Status bar indicator** for the joy CLI: version when ok, install prompt when missing or too old.
- **Cross-platform**: Linux, macOS, and Windows.

## Documentation

- [Vision](docs/dev/vision/README.md) - what's in and out of scope
- [Architecture](docs/dev/architecture/README.md) - how the extension talks to the joy CLI
- [Contributing](CONTRIBUTING.md) - coding conventions, development setup, commit messages

## Status

Pre-release. Tracked under [JVSC-0001-D4](https://github.com/joyint/joy-vscode) and the milestones beneath it. Marketplace + Open VSX publishing is on the roadmap (`JVSC-0006-79`).

## License

[MIT](LICENSE).
