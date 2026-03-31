# Contributing

## Prerequisites

- Bun
- Rust toolchain
- Tauri platform prerequisites

## Install

```bash
bun install
```

## Common Commands

```bash
bun run build
bun run test:unit
bun run test:components
bun run test:e2e
bun run bench
cargo test -p pdf-arranger-core -- --nocapture
```

## Contribution Workflow

1. Keep changes scoped to one feature batch when possible.
2. Run the relevant verification commands before committing.
3. Update `README.md` or docs when the user-facing behavior changes.
4. Sync the matching OpenSpec tasks in the sibling `oxide-pdf` repository.

## Areas That Need Extra Care

- snapshot-based undo / redo semantics
- split-view cross-document moves
- crop/import operations that rewrite PDFs in place
- mobile layout regressions and pinch interactions

## Commit Style

Prefer focused conventional-style messages such as:

- `feat: add image import workflow`
- `fix: preserve workspace selection after save as`
- `docs: update arranger crop editor tasks`
