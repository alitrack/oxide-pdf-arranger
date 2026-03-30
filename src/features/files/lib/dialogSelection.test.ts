import { describe, expect, test } from "bun:test";
import { getSingleSelectedPath } from "./dialogSelection";

describe("getSingleSelectedPath", () => {
  test("returns the path when the dialog selects a single file", () => {
    expect(getSingleSelectedPath("/tmp/sample.pdf")).toBe("/tmp/sample.pdf");
  });

  test("ignores null and multi-select results", () => {
    expect(getSingleSelectedPath(null)).toBeNull();
    expect(getSingleSelectedPath(["/tmp/a.pdf", "/tmp/b.pdf"])).toBeNull();
  });
});
