import { describe, expect, test } from "bun:test";
import {
  getImageImportDialogExtensions,
  resolveImageImportPlacement,
} from "./imageImport";

describe("imageImport", () => {
  test("resolveImageImportPlacement uses the highest selected page for insert-after-selection", () => {
    expect(
      resolveImageImportPlacement("after-selection", [2, 5, 3], 8),
    ).toEqual({
      afterPageNumber: 5,
      position: "after-selection",
    });
  });

  test("resolveImageImportPlacement falls back to append when no page is selected", () => {
    expect(resolveImageImportPlacement("after-selection", [], 8)).toEqual({
      afterPageNumber: null,
      position: "append",
    });
  });

  test("getImageImportDialogExtensions exposes every supported image type", () => {
    expect(getImageImportDialogExtensions()).toEqual([
      "jpg",
      "jpeg",
      "png",
      "tif",
      "tiff",
      "bmp",
      "webp",
    ]);
  });
});
