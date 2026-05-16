# Contributing

## Coding Conventions

TypeScript, strict mode. ESLint flat config (`eslint.config.mjs`) with `@typescript-eslint`, Prettier for formatting (`.prettierrc.json`), `.editorconfig` for whitespace.

## Development setup

```sh
just install         # npm ci
just check           # typecheck + lint + format + unit tests
just build           # bundle dist/extension.js via esbuild
just test-integration  # run extension-host tests
just package         # build a local VSIX (joy-vscode-X.Y.Z.vsix)
```

Open the repo in VS Code and press `F5` to launch an Extension Development Host with the extension loaded.

## Releasing

Releases follow the standard Joy umbrella flow:

```sh
just release patch   # or minor / major
just publish
```

`just release patch` runs `joy release bump patch`, which rewrites the `version` field in `package.json` (declared under `release.version-files` in `.joy/project.yaml`), then `joy release record` commits the bump and creates a `v<version>` tag locally. `just publish` pushes the commit and tag.

The pushed tag triggers the [Release workflow](.github/workflows/release.yml), which rebuilds on GitHub Actions, packages the extension with `vsce`, and attaches the `.vsix` to a fresh GitHub Release. The workflow also runs `npm version --allow-same-version` as a safety net in case the tag and `package.json` ever drift.

Version numbering follows semantic versioning. Marketplace + Open VSX publishing is set up under `JVSC-0006-79`.

## Commit Messages

Conventional commits: `type(scope): description [JVSC-XXXX-YY]`.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.

Every commit must reference a Joy item ID. Pure infrastructure commits may use `[no-item]`. Do not use AI tool brand names in commits, code, or documentation outside the `Co-Authored-By:` trailer.

## Testing

Unit tests live in `src/test/unit/` and run via `mocha` against the compiled output in `out-test/`. They cover pure logic (CLI wrapper, resolver, backlog tree-building) without VS Code.

Integration tests live in `src/test/integration/` and run via `@vscode/test-cli` inside a real Extension Development Host. They verify command registration, view contributions, and other VS Code-level wiring.

`just check` runs the unit suite; `just test-integration` runs the integration suite (downloads VS Code on first run).

## Branching Strategy

<!-- TBD: not yet decided. -->
