# Release Notes

## 0.1.0-arranger-workspace

### Added

- multi-document tab workspace with split view
- cross-document page move
- merge selected documents
- workspace persistence
- crop editor with live preview and batch apply
- image import for JPEG / PNG / TIFF / BMP / WebP
- mobile bottom toolbar and pinch zoom

### Quality

- Rust backend unit coverage for merge, rotate, reorder, crop, import, and 500-page inspection
- React component test for crop editor apply flow
- Playwright smoke coverage for desktop, iPhone 13 viewport, and Pixel 7 viewport
- virtual-grid benchmark script for large collections

### Notes

- crop and import operations are written in place and protected through snapshot-based undo/redo
- browser-based mobile checks currently use device-profile emulation rather than physical hardware
