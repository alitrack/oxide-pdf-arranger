import { describe, expect, test } from "bun:test";
import { buildHistorySnapshotPaths } from "./historySnapshots";

describe("buildHistorySnapshotPaths", () => {
  test("creates sidecar snapshot paths for unix-style document paths", () => {
    expect(buildHistorySnapshotPaths("/tmp/docs/sample.pdf", "rotate-1")).toEqual({
      beforeSnapshotPath:
        "/tmp/docs/.oxide-pdf-arranger-history/sample-rotate-1-before.pdf",
      afterSnapshotPath:
        "/tmp/docs/.oxide-pdf-arranger-history/sample-rotate-1-after.pdf",
    });
  });

  test("preserves windows path separators when creating snapshot paths", () => {
    expect(buildHistorySnapshotPaths(String.raw`C:\docs\sample file.pdf`, "delete-2")).toEqual({
      beforeSnapshotPath:
        String.raw`C:\docs\.oxide-pdf-arranger-history\sample-file-delete-2-before.pdf`,
      afterSnapshotPath:
        String.raw`C:\docs\.oxide-pdf-arranger-history\sample-file-delete-2-after.pdf`,
    });
  });
});
