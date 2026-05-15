# Architecture

## Technology Stack

| Component | Version | Rationale |
|-----------|---------|-----------|
| TypeScript | <!-- TBD: pinned by JVSC-0003-E2 --> | VS Code extension API is TS-first |
| VS Code Extension API | matches `engines.vscode` in `package.json` | target platform |
| `vsce` | <!-- TBD: pinned by JVSC-0006-79 --> | Microsoft Marketplace packaging and publish |
| `ovsx` | <!-- TBD: pinned by JVSC-0006-79 --> | Open VSX Registry publish |

## Repository Structure

The TypeScript scaffold lands with `JVSC-0003-E2`. Until then this is a Joy-managed workspace only (`.joy/`, docs, `justfile`, license, readme).

## Data Storage

The extension stores no state of its own.

- Joy items, project metadata, members, sessions, logs: all in `.joy/`, managed by the `joy` CLI.
- Extension configuration (`joy.executablePath`, minimum required version, panel preferences): VS Code's standard `settings.json` via the configuration API.
- Passphrases and session credentials: never persisted by the extension. The passphrase is piped once to `joy auth --passphrase-stdin` and discarded. The session is held on disk by joy itself.

## Architectural Decisions

- **CLI subprocess only.** All Joy reads and writes go through `joy --json <subcommand>`. The extension parses stdout JSON. `.joy/items/` is watched only for change detection that triggers a refresh.
- **No bundled binary.** `joy` is expected on PATH. A `joy.executablePath` setting overrides PATH. A minimum version is declared in `package.json`; on activation the extension runs `joy --version --json` and surfaces an upgrade hint via the status bar and command palette if too old.
- **Human auth via passphrase pipe.** The status bar item opens a VS Code `InputBox` for passphrase entry and pipes the value to `joy auth --passphrase-stdin` (the upstream flag is tracked in the joy repo as `JOY-018E-21`). The session is persisted on disk by joy and used by every subsequent invocation. On session-expired errors the same `InputBox` re-appears automatically before retrying the failed command.
- **No AI delegation path.** Token-based AI auth (`joy auth --token`, `JOY_SESSION`) is out of scope; a future companion module may handle it separately.

## Performance Targets

<!-- TBD: not yet decided. -->
