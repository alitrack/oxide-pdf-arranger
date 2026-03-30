import { describe, expect, test } from "bun:test";
import type { PdfDocumentSummary } from "../../backend/types/pdf";
import {
  applyRotationPreview,
  createInPlaceRotateRequest,
} from "./rotationPreview";

function sampleDocument(): PdfDocumentSummary {
  return {
    path: "/tmp/sample.pdf",
    pageCount: 3,
    pages: [
      {
        pageNumber: 1,
        mediaBox: [0, 0, 612, 792],
        cropBox: null,
        rotation: 0,
        thumbnailDataUrl: "data:image/png;base64,a",
      },
      {
        pageNumber: 2,
        mediaBox: [0, 0, 400, 600],
        cropBox: [0, 0, 380, 580],
        rotation: 90,
        thumbnailDataUrl: "data:image/png;base64,b",
      },
      {
        pageNumber: 3,
        mediaBox: [0, 0, 500, 500],
        cropBox: null,
        rotation: 180,
        thumbnailDataUrl: "data:image/png;base64,c",
      },
    ],
  };
}

describe("createInPlaceRotateRequest", () => {
  test("reuses the loaded document path as both input and output", () => {
    expect(createInPlaceRotateRequest("/tmp/sample.pdf", [2, 3], 270)).toEqual({
      inputPath: "/tmp/sample.pdf",
      outputPath: "/tmp/sample.pdf",
      pageNumbers: [2, 3],
      rotationDegrees: 270,
    });
  });
});

describe("applyRotationPreview", () => {
  test("rotates only selected pages and swaps box dimensions for quarter turns", () => {
    const updated = applyRotationPreview(sampleDocument(), [1, 2], 90);

    expect(updated.pages[0].rotation).toBe(90);
    expect(updated.pages[0].mediaBox).toEqual([0, 0, 792, 612]);
    expect(updated.pages[1].rotation).toBe(180);
    expect(updated.pages[1].mediaBox).toEqual([0, 0, 600, 400]);
    expect(updated.pages[1].cropBox).toEqual([0, 0, 580, 380]);
    expect(updated.pages[2].rotation).toBe(180);
    expect(updated.pages[2].mediaBox).toEqual([0, 0, 500, 500]);
  });

  test("preserves box dimensions for half turns", () => {
    const updated = applyRotationPreview(sampleDocument(), [1], 180);

    expect(updated.pages[0].rotation).toBe(180);
    expect(updated.pages[0].mediaBox).toEqual([0, 0, 612, 792]);
  });
});
