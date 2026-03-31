# Distribution Guide

## Desktop Packaging

Build desktop packages with:

```bash
bun run release:desktop
```

This runs `tauri build` and produces platform-specific artifacts under the Tauri target output.

## Recommended Release Checklist

1. `bun run build`
2. `bun run test:unit`
3. `bun run test:components`
4. `bun run test:e2e`
5. `bun run bench`
6. `cargo test -p pdf-arranger-core -- --nocapture`
7. `bun run release:desktop`

## Packaging Notes

- Linux desktop packaging depends on the Tauri prerequisite stack described in the official Tauri docs.
- Mobile layout validation currently relies on Playwright device-profile smoke tests.
- Release artifacts should include the current release notes and user manual links.
