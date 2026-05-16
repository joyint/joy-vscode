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

Releases are driven by git tags. Push a tag matching `v*` (e.g. `v0.1.0`); the [Release workflow](.github/workflows/release.yml) builds the extension on GitHub Actions, packages it with `vsce`, and attaches the `.vsix` to a new GitHub Release.

Version numbering follows semantic versioning. The workflow rewrites `package.json` to match the tag before packaging, so the VSIX file name and metadata are always in sync with the tag.

Marketplace + Open VSX publishing is set up under `JVSC-0006-79`.

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
