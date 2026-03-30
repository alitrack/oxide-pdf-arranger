import { describe, expect, test } from "bun:test";
import {
  createWorkspaceDocumentSession,
  projectActiveWorkspaceDocumentState,
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
});
