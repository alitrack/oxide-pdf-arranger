import { describe, expect, test } from "bun:test";
import {
  createWorkspaceDocumentSession,
  hasWorkspaceDocumentSessionHistory,
  normalizeMergeSelectionDocumentIds,
  projectActiveWorkspaceDocumentState,
  removeWorkspaceDocumentSession,
  resolveNextActiveWorkspaceDocumentId,
  renameWorkspaceDocumentSession,
  resolveSecondaryWorkspaceDocumentId,
  updateWorkspaceDocumentSession,
  upsertWorkspaceDocumentSession,
} from "./workspaceDocuments";
import type { PdfDocumentSummary } from "../../backend/types/pdf";

function createDocument(path: string, pageCount: number): PdfDocumentSummary {
  return {
    path,
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      mediaBox: [0, 0, 612, 792] as [number, number, number, number],
      cropBox: null,
      rotation: 0,
      thumbnailDataUrl: "data:image/png;base64,stub",
    })),
  };
}

describe("workspaceDocuments", () => {
  test("upsertWorkspaceDocumentSession appends new sessions and preserves order", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));

    expect(
      upsertWorkspaceDocumentSession([first], second).map((session) => session.id),
    ).toEqual(["/tmp/a.pdf", "/tmp/b.pdf"]);
  });

  test("projectActiveWorkspaceDocumentState returns the active session state", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = {
      ...createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3)),
      selectedPageNumbers: [2, 3],
      selectionAnchorPage: 3,
    };

    expect(
      projectActiveWorkspaceDocumentState([first, second], "/tmp/b.pdf"),
    ).toMatchObject({
      activeDocument: second.document,
      selectedPageNumbers: [2, 3],
      selectionAnchorPage: 3,
    });
  });

  test("renameWorkspaceDocumentSession updates the session id and document path", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const renamed = renameWorkspaceDocumentSession(
      [first],
      "/tmp/a.pdf",
      createDocument("/tmp/renamed.pdf", 2),
    );

    expect(renamed[0]).toMatchObject({
      id: "/tmp/renamed.pdf",
      document: {
        path: "/tmp/renamed.pdf",
      },
    });
  });

  test("updateWorkspaceDocumentSession changes only the targeted session", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));

    const updated = updateWorkspaceDocumentSession(
      [first, second],
      "/tmp/b.pdf",
      (session) => ({
        ...session,
        selectedPageNumbers: [2],
        selectionAnchorPage: 2,
      }),
    );

    expect(updated[0]).toMatchObject({
      id: "/tmp/a.pdf",
      selectedPageNumbers: [1],
    });
    expect(updated[1]).toMatchObject({
      id: "/tmp/b.pdf",
      selectedPageNumbers: [2],
      selectionAnchorPage: 2,
    });
  });

  test("resolveSecondaryWorkspaceDocumentId prefers the requested secondary document when valid", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));
    const third = createWorkspaceDocumentSession(createDocument("/tmp/c.pdf", 4));

    expect(
      resolveSecondaryWorkspaceDocumentId(
        [first, second, third],
        "/tmp/a.pdf",
        "/tmp/c.pdf",
      ),
    ).toBe("/tmp/c.pdf");
  });

  test("resolveSecondaryWorkspaceDocumentId falls back to another open document", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));

    expect(
      resolveSecondaryWorkspaceDocumentId([first, second], "/tmp/a.pdf", "/tmp/a.pdf"),
    ).toBe("/tmp/b.pdf");
    expect(resolveSecondaryWorkspaceDocumentId([first], "/tmp/a.pdf", null)).toBeNull();
  });

  test("removeWorkspaceDocumentSession drops the requested session", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));

    expect(
      removeWorkspaceDocumentSession([first, second], "/tmp/a.pdf").map(
        (session) => session.id,
      ),
    ).toEqual(["/tmp/b.pdf"]);
  });

  test("resolveNextActiveWorkspaceDocumentId prefers the next tab when closing the active one", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));
    const third = createWorkspaceDocumentSession(createDocument("/tmp/c.pdf", 4));

    expect(
      resolveNextActiveWorkspaceDocumentId(
        [first, second, third],
        "/tmp/b.pdf",
        "/tmp/b.pdf",
      ),
    ).toBe("/tmp/c.pdf");
    expect(
      resolveNextActiveWorkspaceDocumentId(
        [first, second, third],
        "/tmp/c.pdf",
        "/tmp/c.pdf",
      ),
    ).toBe("/tmp/b.pdf");
    expect(
      resolveNextActiveWorkspaceDocumentId(
        [first, second, third],
        "/tmp/b.pdf",
        "/tmp/a.pdf",
      ),
    ).toBe("/tmp/a.pdf");
  });

  test("normalizeMergeSelectionDocumentIds keeps workspace order and falls back to all documents", () => {
    const first = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));
    const second = createWorkspaceDocumentSession(createDocument("/tmp/b.pdf", 3));
    const third = createWorkspaceDocumentSession(createDocument("/tmp/c.pdf", 4));

    expect(
      normalizeMergeSelectionDocumentIds(
        [first, second, third],
        ["/tmp/c.pdf", "/tmp/a.pdf", "/tmp/missing.pdf", "/tmp/a.pdf"],
      ),
    ).toEqual(["/tmp/a.pdf", "/tmp/c.pdf"]);
    expect(normalizeMergeSelectionDocumentIds([first, second], [])).toEqual([
      "/tmp/a.pdf",
      "/tmp/b.pdf",
    ]);
    expect(
      normalizeMergeSelectionDocumentIds([first, second], ["/tmp/missing.pdf"]),
    ).toEqual(["/tmp/a.pdf", "/tmp/b.pdf"]);
  });

  test("hasWorkspaceDocumentSessionHistory returns true when undo or redo stacks exist", () => {
    const session = createWorkspaceDocumentSession(createDocument("/tmp/a.pdf", 2));

    expect(hasWorkspaceDocumentSessionHistory(session)).toBe(false);
    expect(
      hasWorkspaceDocumentSessionHistory({
        ...session,
        actionHistory: {
          undoStack: [
            {
              id: "rotate",
              label: "rotate",
              beforeSnapshotPath: "/tmp/before.pdf",
              afterSnapshotPath: "/tmp/after.pdf",
            },
          ],
          redoStack: [],
        },
      }),
    ).toBe(true);
    expect(
      hasWorkspaceDocumentSessionHistory({
        ...session,
        actionHistory: {
          undoStack: [],
          redoStack: [
            {
              id: "delete",
              label: "delete",
              beforeSnapshotPath: "/tmp/before.pdf",
              afterSnapshotPath: "/tmp/after.pdf",
            },
          ],
        },
      }),
    ).toBe(true);
  });
});
