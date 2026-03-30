import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearStoredWorkspaceState,
  getStoredWorkspaceState,
  persistWorkspaceState,
} from "./workspacePersistence";

function createStorage() {
  const data = new Map<string, string>();

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe("workspacePersistence", () => {
  const storage = createStorage();

  beforeEach(() => {
    clearStoredWorkspaceState(storage);
  });

  test("persistWorkspaceState stores the workspace payload", () => {
    persistWorkspaceState(
      {
        openDocumentPaths: ["/tmp/a.pdf", "/tmp/b.pdf"],
        activeDocumentId: "/tmp/b.pdf",
        isSplitViewEnabled: true,
        secondaryDocumentId: "/tmp/a.pdf",
        mergeSelectionDocumentIds: ["/tmp/b.pdf"],
      },
      storage,
    );

    expect(getStoredWorkspaceState(storage)).toEqual({
      openDocumentPaths: ["/tmp/a.pdf", "/tmp/b.pdf"],
      activeDocumentId: "/tmp/b.pdf",
      isSplitViewEnabled: true,
      secondaryDocumentId: "/tmp/a.pdf",
      mergeSelectionDocumentIds: ["/tmp/b.pdf"],
    });
  });

  test("getStoredWorkspaceState sanitizes invalid identifiers and preserves document order", () => {
    storage.setItem(
      "oxide-pdf-arranger.workspace",
      JSON.stringify({
        openDocumentPaths: ["/tmp/a.pdf", "/tmp/b.pdf", "/tmp/a.pdf", 42],
        activeDocumentId: "/tmp/missing.pdf",
        isSplitViewEnabled: true,
        secondaryDocumentId: "/tmp/a.pdf",
        mergeSelectionDocumentIds: ["/tmp/b.pdf", "/tmp/a.pdf", "/tmp/missing.pdf"],
      }),
    );

    expect(getStoredWorkspaceState(storage)).toEqual({
      openDocumentPaths: ["/tmp/a.pdf", "/tmp/b.pdf"],
      activeDocumentId: "/tmp/a.pdf",
      isSplitViewEnabled: true,
      secondaryDocumentId: "/tmp/b.pdf",
      mergeSelectionDocumentIds: ["/tmp/a.pdf", "/tmp/b.pdf"],
    });
  });

  test("getStoredWorkspaceState returns null for malformed payloads", () => {
    storage.setItem("oxide-pdf-arranger.workspace", "{not-json");

    expect(getStoredWorkspaceState(storage)).toBeNull();
  });
});
