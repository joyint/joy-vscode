# Contributing

## Coding Conventions

TypeScript. Lint, format, and toolchain config land with the scaffold (`JVSC-0003-E2`).

## Commit Messages

Conventional commits: `type(scope): description [JVSC-XXXX-YY]`.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.

Every commit must reference a Joy item ID. Pure infrastructure commits may use `[no-item]`. Do not use AI tool brand names in commits, code, or documentation.

## Testing

<!-- TBD: testing approach lands with the scaffold (JVSC-0003-E2). -->

## CI/CD

GitHub Actions pipeline ships with `JVSC-0006-79`: build and test on push, `vsce publish` to the Microsoft Marketplace and `ovsx publish` to Open VSX on tag.

## Branching Strategy

<!-- TBD: not yet decided. -->
