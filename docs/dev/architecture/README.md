# Architecture

## Technology Stack

| Component             | Version                                    | Rationale                                   |
| --------------------- | ------------------------------------------ | ------------------------------------------- |
| TypeScript            | `^5.6.3`                                   | VS Code extension API is TS-first           |
| Node runtime          | `>=20`                                     | matches VS Code 1.92's bundled Node         |
| Bundler               | `esbuild ^0.24`                            | fast CJS bundle for the extension entry     |
| Linter                | `eslint ^9` (flat config)                  | `@typescript-eslint`, prettier-compatible   |
| Test runner           | `mocha ^10` + `@vscode/test-cli ^0.0.10`   | unit + extension-host tests                 |
| VS Code Extension API | matches `engines.vscode` in `package.json` | target platform                             |
| `vsce`                | <!-- TBD: pinned by JVSC-0006-79 -->       | Microsoft Marketplace packaging and publish |
| `ovsx`                | <!-- TBD: pinned by JVSC-0006-79 -->       | Open VSX Registry publish                   |

## Repository Structure

- `src/` — TypeScript sources. `extension.ts` is the activation entry; `joyClient.ts` wraps the `joy` CLI.
- `src/test/unit/` — unit tests, run via `mocha` against compiled output in `out-test/`.
- `src/test/integration/` — extension-host tests, run via `@vscode/test-cli`.
- `dist/` — bundled extension output (esbuild), git-ignored.
- `.vscode/` — workspace-local launch and task configuration.
- `docs/` — vision and architecture docs (this directory).
- `.joy/` — Joy project state; never edited by hand.

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
