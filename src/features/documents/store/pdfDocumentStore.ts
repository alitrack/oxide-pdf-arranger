import { create } from "zustand";
import { pdfBackend } from "../../backend/api/pdfBackend";
import type { PdfDocumentSummary } from "../../backend/types/pdf";
import { TauriInvokeError } from "../../../shared/lib/tauri";
import { updateRecentFiles } from "../../files/lib/recentFiles";
import {
  createEmptyActionHistory,
  pushHistoryEntry,
  redoHistoryEntry,
  undoHistoryEntry,
  type ActionHistoryEntry,
  type ActionHistoryState,
} from "../lib/actionHistory";
import { buildHistorySnapshotPaths } from "../lib/historySnapshots";
import {
  applyRotationPreview,
  createInPlaceRotateRequest,
} from "../lib/rotationPreview";

const DEFAULT_GRID_ITEM_WIDTH = 156;
const GRID_ITEM_WIDTH_STEP = 20;
const MIN_GRID_ITEM_WIDTH = 140;
const MAX_GRID_ITEM_WIDTH = 260;
const RECENT_FILES_LIMIT = 6;
const RECENT_FILES_STORAGE_KEY = "oxide-pdf-arranger.recent-files";

function getStoredRecentFiles() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(RECENT_FILES_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function persistRecentFiles(files: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(files));
}

interface PdfDocumentStoreState {
  draftPath: string;
  activeDocument: PdfDocumentSummary | null;
  lastError: string | null;
  lastOperationMessage: string | null;
  isInspecting: boolean;
  isSaving: boolean;
  isExporting: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
  isRotating: boolean;
  isDeleting: boolean;
  isDuplicating: boolean;
  isInsertingBlank: boolean;
  recentFiles: string[];
  selectedPageNumbers: number[];
  selectionAnchorPage: number | null;
  gridItemWidth: number;
  actionHistory: ActionHistoryState;
  setDraftPath(nextPath: string): void;
  inspectPdf(path?: string): Promise<void>;
  selectPage(pageNumber: number, mode: "replace" | "toggle" | "range"): void;
  rotateSelectedPages(rotationDegrees: 90 | 180 | 270): Promise<void>;
  saveDocumentAs(outputPath: string): Promise<void>;
  exportDocumentCopy(outputPath: string): Promise<void>;
  undoLastAction(): Promise<void>;
  redoLastAction(): Promise<void>;
  deleteSelectedPages(): Promise<void>;
  duplicateSelectedPages(): Promise<void>;
  insertBlankPageAfterSelection(): Promise<void>;
  zoomInGrid(): void;
  zoomOutGrid(): void;
  resetGridZoom(): void;
}

function createHistoryActionId(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "action";

  return `${slug}-${Date.now()}`;
}

async function createPendingHistoryEntry(
  documentPath: string,
  label: string,
): Promise<ActionHistoryEntry> {
  const actionId = createHistoryActionId(label);
  const { beforeSnapshotPath, afterSnapshotPath } = buildHistorySnapshotPaths(
    documentPath,
    actionId,
  );

  await pdfBackend.copyDocument({
    inputPath: documentPath,
    outputPath: beforeSnapshotPath,
  });

  return {
    id: actionId,
    label,
    beforeSnapshotPath,
    afterSnapshotPath,
  };
}

async function finalizeHistoryEntry(
  history: ActionHistoryState,
  documentPath: string,
  entry: ActionHistoryEntry,
): Promise<ActionHistoryState> {
  await pdfBackend.copyDocument({
    inputPath: documentPath,
    outputPath: entry.afterSnapshotPath,
  });

  return pushHistoryEntry(history, entry);
}

async function restoreDocumentSnapshot(
  documentPath: string,
  snapshotPath: string,
): Promise<PdfDocumentSummary> {
  await pdfBackend.copyDocument({
    inputPath: snapshotPath,
    outputPath: documentPath,
  });

  return pdfBackend.inspectPdf(documentPath);
}

function getDefaultSelection(document: PdfDocumentSummary | null) {
  const firstPageNumber = document?.pages[0]?.pageNumber ?? null;

  return {
    selectedPageNumbers: firstPageNumber === null ? [] : [firstPageNumber],
    selectionAnchorPage: firstPageNumber,
  };
}

function getBoundSelection(
  document: PdfDocumentSummary,
  selectedPageNumbers: number[],
) {
  const nextSelectedPageNumbers = selectedPageNumbers.filter(
    (pageNumber) => pageNumber >= 1 && pageNumber <= document.pageCount,
  );

  if (nextSelectedPageNumbers.length === 0) {
    return getDefaultSelection(document);
  }

  return {
    selectedPageNumbers: nextSelectedPageNumbers,
    selectionAnchorPage:
      nextSelectedPageNumbers[nextSelectedPageNumbers.length - 1] ?? null,
  };
}

function getInspectErrorMessage(error: unknown) {
  return error instanceof TauriInvokeError ? error.message : "Inspect PDF 失败。";
}

function getOperationErrorMessage(error: unknown, fallback: string) {
  return error instanceof TauriInvokeError ? error.message : fallback;
}

export const usePdfDocumentStore = create<PdfDocumentStoreState>((set, get) => ({
  draftPath: "",
  activeDocument: null,
  lastError: null,
  lastOperationMessage: null,
  isInspecting: false,
  isSaving: false,
  isExporting: false,
  isUndoing: false,
  isRedoing: false,
  isRotating: false,
  isDeleting: false,
  isDuplicating: false,
  isInsertingBlank: false,
  recentFiles: getStoredRecentFiles(),
  selectedPageNumbers: [],
  selectionAnchorPage: null,
  gridItemWidth: DEFAULT_GRID_ITEM_WIDTH,
  actionHistory: createEmptyActionHistory(),

  setDraftPath(nextPath) {
    set({ draftPath: nextPath });
  },

  async inspectPdf(path) {
    const nextPath = (path ?? get().draftPath).trim();
    if (!nextPath) {
      set({
        activeDocument: null,
        lastError: "请输入一个可访问的 PDF 绝对路径。",
        lastOperationMessage: null,
        actionHistory: createEmptyActionHistory(),
        selectedPageNumbers: [],
        selectionAnchorPage: null,
      });
      return;
    }

    set({
      draftPath: nextPath,
      isInspecting: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      const activeDocument = await pdfBackend.inspectPdf(nextPath);
      const recentFiles = updateRecentFiles(
        get().recentFiles,
        nextPath,
        RECENT_FILES_LIMIT,
      );
      persistRecentFiles(recentFiles);

      set({
        activeDocument,
        isInspecting: false,
        lastError: null,
        lastOperationMessage: null,
        actionHistory: createEmptyActionHistory(),
        recentFiles,
        ...getDefaultSelection(activeDocument),
      });
    } catch (error) {
      set({
        activeDocument: null,
        isInspecting: false,
        lastError: getInspectErrorMessage(error),
        lastOperationMessage: null,
        actionHistory: createEmptyActionHistory(),
        selectedPageNumbers: [],
        selectionAnchorPage: null,
      });
    }
  },

  selectPage(pageNumber, mode) {
    const { activeDocument, selectedPageNumbers, selectionAnchorPage } = get();
    if (!activeDocument) {
      return;
    }

    const pageOrder = activeDocument.pages.map((page) => page.pageNumber);
    if (!pageOrder.includes(pageNumber)) {
      return;
    }

    const sortByDocumentOrder = (pages: number[]) =>
      [...new Set(pages)].sort(
        (left, right) => pageOrder.indexOf(left) - pageOrder.indexOf(right),
      );

    if (mode === "replace") {
      set({
        selectedPageNumbers: [pageNumber],
        selectionAnchorPage: pageNumber,
      });
      return;
    }

    if (mode === "toggle") {
      const nextSelection = selectedPageNumbers.includes(pageNumber)
        ? selectedPageNumbers.filter((value) => value !== pageNumber)
        : [...selectedPageNumbers, pageNumber];

      set({
        selectedPageNumbers: sortByDocumentOrder(nextSelection),
        selectionAnchorPage: pageNumber,
      });
      return;
    }

    const anchor = selectionAnchorPage ?? pageNumber;
    const anchorIndex = pageOrder.indexOf(anchor);
    const nextIndex = pageOrder.indexOf(pageNumber);
    const [start, end] =
      anchorIndex <= nextIndex ? [anchorIndex, nextIndex] : [nextIndex, anchorIndex];

    set({
      selectedPageNumbers: pageOrder.slice(start, end + 1),
      selectionAnchorPage: anchor,
    });
  },

  async rotateSelectedPages(rotationDegrees) {
    const { activeDocument, actionHistory, selectedPageNumbers } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    if (selectedPageNumbers.length === 0) {
      set({
        lastError: "请先选择要旋转的页面。",
        lastOperationMessage: null,
      });
      return;
    }

    const previousDocument = activeDocument;
    const selectionAnchorPage =
      selectedPageNumbers[selectedPageNumbers.length - 1] ?? null;
    const optimisticDocument = applyRotationPreview(
      activeDocument,
      selectedPageNumbers,
      rotationDegrees,
    );
    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        previousDocument.path,
        `旋转 ${selectedPageNumbers.length} 页（${rotationDegrees}°）`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      activeDocument: optimisticDocument,
      isRotating: true,
      lastError: null,
      lastOperationMessage: null,
      selectionAnchorPage,
    });

    try {
      await pdfBackend.rotatePdf(
        createInPlaceRotateRequest(
          previousDocument.path,
          selectedPageNumbers,
          rotationDegrees,
        ),
      );
      const refreshedDocument = await pdfBackend.inspectPdf(previousDocument.path);
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已旋转 ${selectedPageNumbers.length} 页（${rotationDegrees}°）。`;

      try {
        nextActionHistory = await finalizeHistoryEntry(
          actionHistory,
          previousDocument.path,
          pendingHistoryEntry,
        );
      } catch {
        nextOperationMessage += " 但未能记录撤销历史。";
      }

      set({
        activeDocument: refreshedDocument,
        actionHistory: nextActionHistory,
        isRotating: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
        selectedPageNumbers,
        selectionAnchorPage,
      });
    } catch (error) {
      set({
        activeDocument: previousDocument,
        isRotating: false,
        lastError: getOperationErrorMessage(error, "旋转页面失败。"),
        lastOperationMessage: null,
        selectedPageNumbers,
        selectionAnchorPage,
      });
    }
  },

  async saveDocumentAs(outputPath) {
    const { activeDocument, selectedPageNumbers, recentFiles } = get();
    const nextOutputPath = outputPath.trim();

    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    if (!nextOutputPath) {
      set({
        lastError: "请选择有效的另存为目标路径。",
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isSaving: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.copyDocument({
        inputPath: activeDocument.path,
        outputPath: nextOutputPath,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(nextOutputPath);
      const nextRecentFiles = updateRecentFiles(
        recentFiles,
        nextOutputPath,
        RECENT_FILES_LIMIT,
      );
      persistRecentFiles(nextRecentFiles);

      set({
        draftPath: nextOutputPath,
        activeDocument: refreshedDocument,
        isSaving: false,
        lastError: null,
        lastOperationMessage: `已另存为 ${nextOutputPath}。`,
        actionHistory: createEmptyActionHistory(),
        recentFiles: nextRecentFiles,
        ...getBoundSelection(refreshedDocument, selectedPageNumbers),
      });
    } catch (error) {
      set({
        isSaving: false,
        lastError:
          error instanceof TauriInvokeError ? error.message : "另存为 PDF 失败。",
        lastOperationMessage: null,
      });
    }
  },

  async exportDocumentCopy(outputPath) {
    const { activeDocument, recentFiles } = get();
    const nextOutputPath = outputPath.trim();

    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    if (!nextOutputPath) {
      set({
        lastError: "请选择有效的导出目标路径。",
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isExporting: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.copyDocument({
        inputPath: activeDocument.path,
        outputPath: nextOutputPath,
      });
      const nextRecentFiles = updateRecentFiles(
        recentFiles,
        nextOutputPath,
        RECENT_FILES_LIMIT,
      );
      persistRecentFiles(nextRecentFiles);

      set({
        isExporting: false,
        lastError: null,
        lastOperationMessage: `已导出副本到 ${nextOutputPath}。`,
        recentFiles: nextRecentFiles,
      });
    } catch (error) {
      set({
        isExporting: false,
        lastError: getOperationErrorMessage(error, "导出 PDF 副本失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async undoLastAction() {
    const { activeDocument, actionHistory } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    const transition = undoHistoryEntry(actionHistory);
    if (!transition.entry) {
      return;
    }

    set({
      isUndoing: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      const restoredDocument = await restoreDocumentSnapshot(
        activeDocument.path,
        transition.entry.beforeSnapshotPath,
      );

      set({
        activeDocument: restoredDocument,
        actionHistory: transition.history,
        isUndoing: false,
        lastError: null,
        lastOperationMessage: `已撤销：${transition.entry.label}。`,
        ...getDefaultSelection(restoredDocument),
      });
    } catch (error) {
      set({
        isUndoing: false,
        lastError: getOperationErrorMessage(error, "撤销操作失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async redoLastAction() {
    const { activeDocument, actionHistory } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    const transition = redoHistoryEntry(actionHistory);
    if (!transition.entry) {
      return;
    }

    set({
      isRedoing: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      const restoredDocument = await restoreDocumentSnapshot(
        activeDocument.path,
        transition.entry.afterSnapshotPath,
      );

      set({
        activeDocument: restoredDocument,
        actionHistory: transition.history,
        isRedoing: false,
        lastError: null,
        lastOperationMessage: `已重做：${transition.entry.label}。`,
        ...getDefaultSelection(restoredDocument),
      });
    } catch (error) {
      set({
        isRedoing: false,
        lastError: getOperationErrorMessage(error, "重做操作失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async deleteSelectedPages() {
    const { activeDocument, actionHistory, selectedPageNumbers } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    if (selectedPageNumbers.length === 0) {
      set({
        lastError: "请先选择要删除的页面。",
        lastOperationMessage: null,
      });
      return;
    }

    if (selectedPageNumbers.length >= activeDocument.pages.length) {
      set({
        lastError: "不能删除文档中的全部页面。",
        lastOperationMessage: null,
      });
      return;
    }

    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        activeDocument.path,
        `删除 ${selectedPageNumbers.length} 页`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isDeleting: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.deletePages({
        inputPath: activeDocument.path,
        pageNumbers: selectedPageNumbers,
        outputPath: activeDocument.path,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(activeDocument.path);
      const nextSelectedPages = refreshedDocument.pages[0]
        ? [refreshedDocument.pages[0].pageNumber]
        : [];
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已删除 ${selectedPageNumbers.length} 页。`;

      try {
        nextActionHistory = await finalizeHistoryEntry(
          actionHistory,
          activeDocument.path,
          pendingHistoryEntry,
        );
      } catch {
        nextOperationMessage += " 但未能记录撤销历史。";
      }

      set({
        activeDocument: refreshedDocument,
        actionHistory: nextActionHistory,
        isDeleting: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
        selectedPageNumbers: nextSelectedPages,
        selectionAnchorPage: nextSelectedPages[0] ?? null,
      });
    } catch (error) {
      set({
        isDeleting: false,
        lastError: getOperationErrorMessage(error, "删除页面失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async duplicateSelectedPages() {
    const { activeDocument, actionHistory, selectedPageNumbers } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    if (selectedPageNumbers.length === 0) {
      set({
        lastError: "请先选择要复制的页面。",
        lastOperationMessage: null,
      });
      return;
    }

    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        activeDocument.path,
        `复制 ${selectedPageNumbers.length} 页`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isDuplicating: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.duplicatePages({
        inputPath: activeDocument.path,
        pageNumbers: selectedPageNumbers,
        outputPath: activeDocument.path,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(activeDocument.path);
      const duplicatedPageNumbers = selectedPageNumbers
        .map((pageNumber, index) => pageNumber + index + 1)
        .filter((pageNumber) => pageNumber <= refreshedDocument.pageCount);
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已复制 ${selectedPageNumbers.length} 页。`;

      try {
        nextActionHistory = await finalizeHistoryEntry(
          actionHistory,
          activeDocument.path,
          pendingHistoryEntry,
        );
      } catch {
        nextOperationMessage += " 但未能记录撤销历史。";
      }

      set({
        activeDocument: refreshedDocument,
        actionHistory: nextActionHistory,
        isDuplicating: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
        selectedPageNumbers: duplicatedPageNumbers,
        selectionAnchorPage:
          duplicatedPageNumbers[duplicatedPageNumbers.length - 1] ?? null,
      });
    } catch (error) {
      set({
        isDuplicating: false,
        lastError: getOperationErrorMessage(error, "复制页面失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async insertBlankPageAfterSelection() {
    const { activeDocument, actionHistory, selectedPageNumbers } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    if (selectedPageNumbers.length === 0) {
      set({
        lastError: "请先选择插入位置对应的页面。",
        lastOperationMessage: null,
      });
      return;
    }

    const afterPageNumber = selectedPageNumbers[selectedPageNumbers.length - 1];
    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        activeDocument.path,
        `在第 ${afterPageNumber} 页后插入空白页`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isInsertingBlank: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.insertBlankPage({
        inputPath: activeDocument.path,
        afterPageNumber,
        outputPath: activeDocument.path,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(activeDocument.path);
      const insertedPageNumber = Math.min(afterPageNumber + 1, refreshedDocument.pageCount);
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已在第 ${afterPageNumber} 页后插入空白页。`;

      try {
        nextActionHistory = await finalizeHistoryEntry(
          actionHistory,
          activeDocument.path,
          pendingHistoryEntry,
        );
      } catch {
        nextOperationMessage += " 但未能记录撤销历史。";
      }

      set({
        activeDocument: refreshedDocument,
        actionHistory: nextActionHistory,
        isInsertingBlank: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
        selectedPageNumbers: [insertedPageNumber],
        selectionAnchorPage: insertedPageNumber,
      });
    } catch (error) {
      set({
        isInsertingBlank: false,
        lastError: getOperationErrorMessage(error, "插入空白页失败。"),
        lastOperationMessage: null,
      });
    }
  },

  zoomInGrid() {
    set((state) => ({
      gridItemWidth: Math.min(
        MAX_GRID_ITEM_WIDTH,
        state.gridItemWidth + GRID_ITEM_WIDTH_STEP,
      ),
    }));
  },

  zoomOutGrid() {
    set((state) => ({
      gridItemWidth: Math.max(
        MIN_GRID_ITEM_WIDTH,
        state.gridItemWidth - GRID_ITEM_WIDTH_STEP,
      ),
    }));
  },

  resetGridZoom() {
    set({ gridItemWidth: DEFAULT_GRID_ITEM_WIDTH });
  },
}));
