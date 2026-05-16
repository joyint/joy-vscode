# joy-vscode

Joy VS Code extension: tree view, item editor, and session indicator backed by the joy CLI.

## Status

Pre-release. Scaffold in place (`JVSC-0003-E2`); item tree, webview editor, and status bar indicator follow in their own stories.

## Requirements

The `joy` CLI must be installed on the system: https://github.com/joyint/joy. The extension shells out to it and does not bundle a binary.

## Develop locally

```bash
just install   # npm ci
just check     # typecheck, lint, format, unit tests
just build     # bundle dist/extension.js via esbuild
```

Open the repo in VS Code and press `F5` to launch an Extension Development Host with the extension loaded.

## Documentation

- [Vision](docs/dev/vision/README.md)
- [Architecture](docs/dev/architecture/README.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
