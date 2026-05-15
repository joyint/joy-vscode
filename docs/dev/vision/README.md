# Vision

## What is this product?

A Visual Studio Code extension that exposes the local Joy project backlog inside the editor: items as a sortable, nestable tree, a form editor in a webview, and a status bar session indicator. It wraps the `joy` CLI as a subprocess; it does not reimplement Joy's logic.

## Target Audience

Developers and product managers already using Joy who want to drive it from their editor in addition to the terminal.

## Core Features

- Tree view panel listing items with sorting and parent/child nesting, refreshed live from `.joy/items/`.
- Webview form editor for creating and editing items, writing back via `joy add` and `joy edit`.
- Status bar session indicator showing Joy member identity and remaining session time, with a graphical passphrase prompt on click and automatic re-prompt when a command fails with a session-expired error.
- Context actions for the lifecycle shortcuts (`joy start | submit | close | reopen`).

## Design Principles

- The `joy` CLI is the single source of truth. The extension reads and writes Joy state only via the CLI's machine-readable `--json` interface; `.joy/` files are watched read-only for refresh, never written directly.
- The `joy` binary is expected on the system. The extension does not bundle it. A `joy.executablePath` setting overrides PATH lookup. A minimum joy version is declared in `package.json` and enforced at activation.
- Passphrase entry happens once via VS Code's native `InputBox` and is piped to `joy auth --passphrase-stdin`. The extension never stores the passphrase or the session credential.

## Scope Boundaries

- Not a Joy AI or Copilot panel. AI delegation flows (`joy auth --token`, `JOY_SESSION`) are tracked as a separate effort.
- Does not bundle, vendor, or shadow the `joy` binary.
- Does not implement its own item storage, ID generation, encryption, or auth.
