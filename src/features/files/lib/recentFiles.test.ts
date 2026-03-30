import { describe, expect, test } from "bun:test";
import { updateRecentFiles } from "./recentFiles";

describe("updateRecentFiles", () => {
  test("moves the latest file to the front and removes duplicates", () => {
    expect(
      updateRecentFiles(
        ["/tmp/a.pdf", "/tmp/b.pdf", "/tmp/c.pdf"],
        "/tmp/b.pdf",
        5,
      ),
    ).toEqual(["/tmp/b.pdf", "/tmp/a.pdf", "/tmp/c.pdf"]);
  });

  test("caps the recent file list to the requested limit", () => {
    expect(
      updateRecentFiles(
        ["/tmp/a.pdf", "/tmp/b.pdf", "/tmp/c.pdf", "/tmp/d.pdf"],
        "/tmp/e.pdf",
        3,
      ),
    ).toEqual(["/tmp/e.pdf", "/tmp/a.pdf", "/tmp/b.pdf"]);
  });
});
