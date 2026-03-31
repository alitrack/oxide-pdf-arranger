# API Reference

This document summarizes the Tauri commands exposed by `oxide-pdf-arranger`.

## Command Surface

### `inspect_pdf`

- Input: `path`
- Output: `PdfDocumentSummary`
- Purpose: load page metadata, page boxes, rotation, and thumbnail previews

### `merge_pdfs`

- Input: `MergePdfRequest`
- Output: `PdfOperationResult`
- Purpose: merge multiple PDFs into a new output file

### `split_pdf`

- Input: `SplitPdfRequest`
- Output: `PdfOperationResult`
- Purpose: extract explicit pages into a new document

### `rotate_pdf`

- Input: `RotatePdfRequest`
- Output: `PdfOperationResult`
- Purpose: rotate selected pages in 90-degree increments

### `crop_pdf`

- Input: `CropPdfRequest`
- Output: `PdfOperationResult`
- Purpose: write `CropBox` values for selected pages using margin-based crop settings

### `reorder_pages`

- Input: `ReorderPagesRequest`
- Output: `PdfOperationResult`
- Purpose: rewrite the current PDF in a new page order

### `delete_pages`

- Input: `DeletePagesRequest`
- Output: `PdfOperationResult`
- Purpose: remove selected pages while preserving the remaining order

### `duplicate_pages`

- Input: `DuplicatePagesRequest`
- Output: `PdfOperationResult`
- Purpose: duplicate selected pages immediately after their originals

### `insert_blank_page`

- Input: `InsertBlankPageRequest`
- Output: `PdfOperationResult`
- Purpose: add a blank page after the current selection

### `copy_document`

- Input: `CopyDocumentRequest`
- Output: `PdfOperationResult`
- Purpose: save a duplicate PDF without changing the open workspace document

### `move_pages_between_documents`

- Input: `MovePagesBetweenDocumentsRequest`
- Output: `PdfOperationResult`
- Purpose: move pages from the primary document into the secondary split-view document

### `import_images`

- Input: `ImportImagesRequest`
- Output: `PdfOperationResult`
- Purpose: insert JPEG / PNG / TIFF / BMP / WebP images into the current PDF as new pages

## Frontend Store Responsibilities

The Zustand document store coordinates:

- active document/session state
- merge selection state
- split-view state
- undo / redo snapshot flow
- crop and image-import actions
- workspace persistence in `localStorage`

## Error Model

Backend operations normalize into:

- `invalid_request`
- `pdf_error`
- `io_error`

Frontend code wraps Tauri invocation failures through `TauriInvokeError` and surfaces the resulting message in workspace banners.
