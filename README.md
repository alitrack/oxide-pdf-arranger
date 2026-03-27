# Oxide PDF Arranger

Cross-platform PDF page arranger built with Tauri v2, React, TypeScript, and the Rust-based Oxide-PDF toolkit.

## Status

This repository is in early bootstrap. The current milestone establishes the standalone Tauri v2 + React + TypeScript application shell that will grow into a visual PDF page manager.

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

### Run Tauri Desktop App

```bash
bun run tauri dev
```

### Android Initialization

```bash
bun run tauri android init
```

## Repository Layout

```text
oxide-pdf-arranger/
├── src/          # React frontend
├── src-tauri/    # Rust + Tauri backend
└── public/       # Static assets
```

## License

Licensed under either of:

- MIT license
- Apache License, Version 2.0
