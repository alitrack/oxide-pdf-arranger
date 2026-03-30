import { describe, expect, test } from "bun:test";
import { getSingleSavePath, getSingleSelectedPath } from "./dialogSelection";

describe("getSingleSelectedPath", () => {
  test("returns the path when the dialog selects a single file", () => {
    expect(getSingleSelectedPath("/tmp/sample.pdf")).toBe("/tmp/sample.pdf");
  });

  test("ignores null and multi-select results", () => {
    expect(getSingleSelectedPath(null)).toBeNull();
    expect(getSingleSelectedPath(["/tmp/a.pdf", "/tmp/b.pdf"])).toBeNull();
  });
});

describe("getSingleSavePath", () => {
  test("returns the path when the dialog selects a save target", () => {
    expect(getSingleSavePath("/tmp/export.pdf")).toBe("/tmp/export.pdf");
  });

  test("ignores null and multi-select results", () => {
    expect(getSingleSavePath(null)).toBeNull();
    expect(getSingleSavePath(["/tmp/a.pdf", "/tmp/b.pdf"])).toBeNull();
  });
});
