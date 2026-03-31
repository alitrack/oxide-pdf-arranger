# Oxide PDF Arranger

Cross-platform PDF page arranger built with Tauri v2, React, TypeScript, and the Rust-based Oxide-PDF toolkit.

## Status

The current milestone already includes a working multi-document desktop workspace:

- open PDFs into tabs with recent-file recall
- split view and cross-document page move
- in-place undo / redo snapshot history
- merge selected open documents into a new PDF
- restore workspace tabs across restarts
- visual crop editor with live preview and batch apply
- import JPEG / PNG / TIFF / BMP / WebP images as PDF pages
- mobile-oriented toolbar and pinch-to-zoom support
- Rust unit tests, React component tests, Playwright smoke tests, and virtual-grid benchmarks

## Tech Stack

- Tauri v2
- React
- TypeScript
- Vite
- Bun
- Rust

## Development

### Prerequisites

- Bun
- Rust toolchain
- Tauri platform prerequisites

Linux desktop builds additionally need the WebKitGTK and librsvg packages required by Tauri. See:

- <https://tauri.app/start/prerequisites/>

### Install Dependencies

```bash
bun install
```

### Run Frontend Dev Server

```bash
bun run dev
```

### Build Frontend Assets

```bash
bun run build
```

### Run Unit Tests

```bash
bun run test:unit
cargo test -p pdf-arranger-core -- --nocapture
```

### Run Component Test

```bash
bun run test:components
```

### Run E2E Smoke Tests

```bash
bun run test:e2e
```

### Run Virtual Grid Benchmark

```bash
bun run bench
```

### Run Tauri Desktop App

```bash
bun run tauri dev
```

### Build Desktop Packages

```bash
bun run release:desktop
```

### Android Initialization

```bash
bun run tauri android init
```

## Repository Layout

```text
oxide-pdf-arranger/
├── docs/         # API, user, release, and distribution docs
├── src/          # React frontend
├── src-tauri/    # Rust + Tauri backend
└── public/       # Static assets
```

## Documentation

- [API reference](docs/api.md)
- [User manual](docs/user-manual.md)
- [Contributing guide](CONTRIBUTING.md)
- [Release notes](docs/release-notes.md)
- [Distribution guide](docs/distribution.md)

## License

Licensed under either of:

- MIT license
- Apache License, Version 2.0
