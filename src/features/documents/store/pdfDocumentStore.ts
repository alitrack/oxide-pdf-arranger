import { create } from "zustand";
import { pdfBackend } from "../../backend/api/pdfBackend";
import type {
  CropMargins,
  ImageImportPosition,
  PdfDocumentSummary,
} from "../../backend/types/pdf";
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
  createWorkspaceDocumentSession,
  getWorkspaceDocumentSession,
  hasWorkspaceDocumentSessionHistory,
  normalizeMergeSelectionDocumentIds,
  projectActiveWorkspaceDocumentState,
  removeWorkspaceDocumentSession,
  renameWorkspaceDocumentSession,
  resolveNextActiveWorkspaceDocumentId,
  resolveSecondaryWorkspaceDocumentId,
  upsertWorkspaceDocumentSession,
  type PdfWorkspaceDocumentSession,
} from "../lib/workspaceDocuments";
import {
  clearStoredWorkspaceState,
  getStoredWorkspaceState,
  persistWorkspaceState,
} from "../lib/workspacePersistence";
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
const MAX_OPEN_DOCUMENTS = 10;

function getDocumentLabel(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

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
  openDocuments: PdfWorkspaceDocumentSession[];
  activeDocumentId: string | null;
  isSplitViewEnabled: boolean;
  secondaryDocumentId: string | null;
  mergeSelectionDocumentIds: string[];
  activeDocument: PdfDocumentSummary | null;
  lastError: string | null;
  lastOperationMessage: string | null;
  isInspecting: boolean;
  isSaving: boolean;
  isExporting: boolean;
  isMerging: boolean;
  isImportingImages: boolean;
  imageImportProgressTotal: number;
  hasAttemptedWorkspaceRestore: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
  isRotating: boolean;
  isCropping: boolean;
  isReordering: boolean;
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
  restoreWorkspace(): Promise<void>;
  switchToDocument(documentId: string): void;
  closeDocument(documentId: string): void;
  toggleSplitView(): void;
  setSecondaryDocument(documentId: string): void;
  toggleDocumentMergeSelection(documentId: string): void;
  mergeSelectedDocuments(outputPath: string): Promise<void>;
  selectPage(pageNumber: number, mode: "replace" | "toggle" | "range"): void;
  movePageToDocument(
    targetDocumentId: string,
    sourcePageNumber: number,
    targetPosition: number | null,
  ): Promise<void>;
  reorderPages(pageNumbers: number[]): Promise<void>;
  rotateSelectedPages(rotationDegrees: 90 | 180 | 270): Promise<void>;
  cropSelectedPages(margins: CropMargins): Promise<void>;
  importImages(
    imagePaths: string[],
    position: ImageImportPosition,
    afterPageNumber: number | null,
  ): Promise<void>;
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

function shiftSelectionAfterPageRemoval(
  selectedPageNumbers: number[],
  removedPageNumber: number,
) {
  return selectedPageNumbers
    .filter((pageNumber) => pageNumber !== removedPageNumber)
    .map((pageNumber) => (pageNumber > removedPageNumber ? pageNumber - 1 : pageNumber));
}

function getInspectErrorMessage(error: unknown) {
  return error instanceof TauriInvokeError ? error.message : "Inspect PDF 失败。";
}

function getOperationErrorMessage(error: unknown, fallback: string) {
  return error instanceof TauriInvokeError ? error.message : fallback;
}

function buildActiveWorkspaceState(
  openDocuments: PdfWorkspaceDocumentSession[],
  activeDocumentId: string | null,
  isSplitViewEnabled = false,
  secondaryDocumentId: string | null = null,
) {
  const nextIsSplitViewEnabled = isSplitViewEnabled && openDocuments.length > 1;
  const nextSecondaryDocumentId = nextIsSplitViewEnabled
    ? resolveSecondaryWorkspaceDocumentId(
        openDocuments,
        activeDocumentId,
        secondaryDocumentId,
      )
    : null;

  return {
    openDocuments,
    activeDocumentId,
    isSplitViewEnabled: nextIsSplitViewEnabled,
    secondaryDocumentId: nextSecondaryDocumentId,
    ...projectActiveWorkspaceDocumentState(openDocuments, activeDocumentId),
  };
}

function persistWorkspaceSnapshot(
  state: Pick<
    PdfDocumentStoreState,
    | "openDocuments"
    | "activeDocumentId"
    | "isSplitViewEnabled"
    | "secondaryDocumentId"
    | "mergeSelectionDocumentIds"
  >,
) {
  if (state.openDocuments.length === 0 || !state.activeDocumentId) {
    clearStoredWorkspaceState();
    return;
  }

  persistWorkspaceState({
    openDocumentPaths: state.openDocuments.map((session) => session.document.path),
    activeDocumentId: state.activeDocumentId,
    isSplitViewEnabled: state.isSplitViewEnabled,
    secondaryDocumentId: state.secondaryDocumentId,
    mergeSelectionDocumentIds: normalizeMergeSelectionDocumentIds(
      state.openDocuments,
      state.mergeSelectionDocumentIds,
    ),
  });
}

function updateActiveWorkspaceSessionState(
  state: Pick<
    PdfDocumentStoreState,
    | "openDocuments"
    | "activeDocumentId"
    | "isSplitViewEnabled"
    | "secondaryDocumentId"
  >,
  updater: (session: PdfWorkspaceDocumentSession) => PdfWorkspaceDocumentSession,
) {
  const activeSession = getWorkspaceDocumentSession(
    state.openDocuments,
    state.activeDocumentId,
  );

  if (!activeSession) {
    return buildActiveWorkspaceState(
      state.openDocuments,
      state.activeDocumentId,
      state.isSplitViewEnabled,
      state.secondaryDocumentId,
    );
  }

  const nextSession = updater(activeSession);
  const nextOpenDocuments = state.openDocuments.map((session) =>
    session.id === activeSession.id ? nextSession : session,
  );

  return buildActiveWorkspaceState(
    nextOpenDocuments,
    nextSession.id,
    state.isSplitViewEnabled,
    state.secondaryDocumentId,
  );
}

export const usePdfDocumentStore = create<PdfDocumentStoreState>((set, get) => ({
  draftPath: "",
  openDocuments: [],
  activeDocumentId: null,
  isSplitViewEnabled: false,
  secondaryDocumentId: null,
  mergeSelectionDocumentIds: [],
  activeDocument: null,
  lastError: null,
  lastOperationMessage: null,
  isInspecting: false,
  isSaving: false,
  isExporting: false,
  isMerging: false,
  isImportingImages: false,
  imageImportProgressTotal: 0,
  hasAttemptedWorkspaceRestore: false,
  isUndoing: false,
  isRedoing: false,
  isRotating: false,
  isCropping: false,
  isReordering: false,
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
    const { mergeSelectionDocumentIds, openDocuments, recentFiles } = get();
    const nextPath = (path ?? get().draftPath).trim();
    if (!nextPath) {
      set({
        lastError: "请输入一个可访问的 PDF 绝对路径。",
        lastOperationMessage: null,
      });
      return;
    }

    const nextRecentFiles = updateRecentFiles(recentFiles, nextPath, RECENT_FILES_LIMIT);
    persistRecentFiles(nextRecentFiles);

    const existingSession = getWorkspaceDocumentSession(openDocuments, nextPath);
    if (existingSession) {
      const nextState = {
        draftPath: nextPath,
        isInspecting: false,
        lastError: null,
        lastOperationMessage: null,
        recentFiles: nextRecentFiles,
        ...buildActiveWorkspaceState(
          openDocuments,
          existingSession.id,
          get().isSplitViewEnabled,
          get().secondaryDocumentId,
        ),
      };

      set(nextState);
      persistWorkspaceSnapshot({
        openDocuments,
        activeDocumentId: existingSession.id,
        isSplitViewEnabled: nextState.isSplitViewEnabled,
        secondaryDocumentId: nextState.secondaryDocumentId,
        mergeSelectionDocumentIds,
      });
      return;
    }

    if (openDocuments.length >= MAX_OPEN_DOCUMENTS) {
      set({
        lastError: `最多同时打开 ${MAX_OPEN_DOCUMENTS} 个文档。请先切换到已有标签或关闭未使用文档。`,
        lastOperationMessage: null,
        recentFiles: nextRecentFiles,
      });
      return;
    }

    set({
      draftPath: nextPath,
      isInspecting: true,
      lastError: null,
      lastOperationMessage: null,
      recentFiles: nextRecentFiles,
    });

    try {
      const activeDocument = await pdfBackend.inspectPdf(nextPath);
      const nextSession = createWorkspaceDocumentSession(activeDocument);
      const nextOpenDocuments = upsertWorkspaceDocumentSession(
        get().openDocuments,
        nextSession,
      );
      const nextState = {
        isInspecting: false,
        lastError: null,
        lastOperationMessage: null,
        recentFiles: nextRecentFiles,
        mergeSelectionDocumentIds: normalizeMergeSelectionDocumentIds(
          nextOpenDocuments,
          [...mergeSelectionDocumentIds, nextSession.id],
        ),
        ...buildActiveWorkspaceState(
          nextOpenDocuments,
          nextSession.id,
          get().isSplitViewEnabled,
          get().secondaryDocumentId,
        ),
      };

      set(nextState);
      persistWorkspaceSnapshot({
        openDocuments: nextOpenDocuments,
        activeDocumentId: nextSession.id,
        isSplitViewEnabled: nextState.isSplitViewEnabled,
        secondaryDocumentId: nextState.secondaryDocumentId,
        mergeSelectionDocumentIds: nextState.mergeSelectionDocumentIds,
      });
    } catch (error) {
      set({
        isInspecting: false,
        lastError: getInspectErrorMessage(error),
        lastOperationMessage: null,
      });
    }
  },

  async restoreWorkspace() {
    const { hasAttemptedWorkspaceRestore, openDocuments } = get();
    if (hasAttemptedWorkspaceRestore || openDocuments.length > 0) {
      if (!hasAttemptedWorkspaceRestore) {
        set({ hasAttemptedWorkspaceRestore: true });
      }
      return;
    }

    set({ hasAttemptedWorkspaceRestore: true });
    const persistedWorkspace = getStoredWorkspaceState();

    if (!persistedWorkspace) {
      return;
    }

    set({
      isInspecting: true,
      lastError: null,
      lastOperationMessage: null,
    });

    const restoredSessions: PdfWorkspaceDocumentSession[] = [];
    const skippedPaths: string[] = [];

    for (const path of persistedWorkspace.openDocumentPaths) {
      try {
        const document = await pdfBackend.inspectPdf(path);
        restoredSessions.push(createWorkspaceDocumentSession(document));
      } catch {
        skippedPaths.push(path);
      }
    }

    if (restoredSessions.length === 0) {
      clearStoredWorkspaceState();
      set({
        isInspecting: false,
        draftPath: "",
        openDocuments: [],
        activeDocumentId: null,
        isSplitViewEnabled: false,
        secondaryDocumentId: null,
        mergeSelectionDocumentIds: [],
        activeDocument: null,
        selectedPageNumbers: [],
        selectionAnchorPage: null,
        actionHistory: createEmptyActionHistory(),
        lastError: null,
        lastOperationMessage:
          skippedPaths.length > 0
            ? `上次工作区中的 ${skippedPaths.length} 个文档已不可恢复，已清除恢复记录。`
            : null,
      });
      return;
    }

    const requestedActiveDocumentId =
      restoredSessions.find(
        (session) => session.id === persistedWorkspace.activeDocumentId,
      )?.id ?? restoredSessions[0]?.id ?? null;
    const nextState = {
      isInspecting: false,
      draftPath: requestedActiveDocumentId ?? "",
      lastError: null,
      lastOperationMessage:
        skippedPaths.length > 0
          ? `已恢复 ${restoredSessions.length} 个文档，跳过 ${skippedPaths.length} 个不可访问文档。撤销历史不会跨重启保留。`
          : `已恢复 ${restoredSessions.length} 个文档。撤销历史不会跨重启保留。`,
      mergeSelectionDocumentIds: normalizeMergeSelectionDocumentIds(
        restoredSessions,
        persistedWorkspace.mergeSelectionDocumentIds,
      ),
      ...buildActiveWorkspaceState(
        restoredSessions,
        requestedActiveDocumentId,
        persistedWorkspace.isSplitViewEnabled,
        persistedWorkspace.secondaryDocumentId,
      ),
    };

    set(nextState);
    persistWorkspaceSnapshot({
      openDocuments: restoredSessions,
      activeDocumentId: nextState.activeDocumentId,
      isSplitViewEnabled: nextState.isSplitViewEnabled,
      secondaryDocumentId: nextState.secondaryDocumentId,
      mergeSelectionDocumentIds: nextState.mergeSelectionDocumentIds,
    });
  },

  switchToDocument(documentId) {
    const {
      mergeSelectionDocumentIds,
      openDocuments,
      isSplitViewEnabled,
      secondaryDocumentId,
    } = get();
    const session = getWorkspaceDocumentSession(openDocuments, documentId);
    if (!session) {
      return;
    }

    const nextState = {
      draftPath: session.document.path,
      lastError: null,
      lastOperationMessage: null,
      ...buildActiveWorkspaceState(
        openDocuments,
        documentId,
        isSplitViewEnabled,
        secondaryDocumentId,
      ),
    };

    set(nextState);
    persistWorkspaceSnapshot({
      openDocuments,
      activeDocumentId: documentId,
      isSplitViewEnabled: nextState.isSplitViewEnabled,
      secondaryDocumentId: nextState.secondaryDocumentId,
      mergeSelectionDocumentIds,
    });
  },

  closeDocument(documentId) {
    const state = get();
    const targetDocumentId = documentId || state.activeDocumentId;
    if (!targetDocumentId) {
      return;
    }

    const session = getWorkspaceDocumentSession(state.openDocuments, targetDocumentId);
    if (!session) {
      return;
    }

    if (
      hasWorkspaceDocumentSessionHistory(session) &&
      typeof window !== "undefined" &&
      !window.confirm(
        `“${getDocumentLabel(session.document.path)}”中的页面改动已写回磁盘，但关闭标签会清空本次会话的撤销/重做历史。确定关闭吗？`,
      )
    ) {
      return;
    }

    const nextOpenDocuments = removeWorkspaceDocumentSession(
      state.openDocuments,
      targetDocumentId,
    );
    const nextActiveDocumentId = resolveNextActiveWorkspaceDocumentId(
      state.openDocuments,
      targetDocumentId,
      state.activeDocumentId,
    );
    const nextState = {
      draftPath: nextActiveDocumentId ?? "",
      lastError: null,
      lastOperationMessage: `已关闭 ${getDocumentLabel(session.document.path)}。`,
      mergeSelectionDocumentIds: normalizeMergeSelectionDocumentIds(
        nextOpenDocuments,
        state.mergeSelectionDocumentIds.filter((id) => id !== targetDocumentId),
      ),
      ...buildActiveWorkspaceState(
        nextOpenDocuments,
        nextActiveDocumentId,
        state.isSplitViewEnabled,
        state.secondaryDocumentId,
      ),
    };

    set(nextState);
    persistWorkspaceSnapshot({
      openDocuments: nextOpenDocuments,
      activeDocumentId: nextState.activeDocumentId,
      isSplitViewEnabled: nextState.isSplitViewEnabled,
      secondaryDocumentId: nextState.secondaryDocumentId,
      mergeSelectionDocumentIds: nextState.mergeSelectionDocumentIds,
    });
  },

  toggleSplitView() {
    const {
      activeDocumentId,
      isSplitViewEnabled,
      mergeSelectionDocumentIds,
      openDocuments,
      secondaryDocumentId,
    } = get();
    const nextState = buildActiveWorkspaceState(
      openDocuments,
      activeDocumentId,
      !isSplitViewEnabled,
      secondaryDocumentId,
    );

    set(nextState);
    persistWorkspaceSnapshot({
      openDocuments,
      activeDocumentId: nextState.activeDocumentId,
      isSplitViewEnabled: nextState.isSplitViewEnabled,
      secondaryDocumentId: nextState.secondaryDocumentId,
      mergeSelectionDocumentIds,
    });
  },

  setSecondaryDocument(documentId) {
    const {
      activeDocumentId,
      isSplitViewEnabled,
      mergeSelectionDocumentIds,
      openDocuments,
    } = get();
    if (!isSplitViewEnabled) {
      return;
    }

    const nextState = buildActiveWorkspaceState(
      openDocuments,
      activeDocumentId,
      isSplitViewEnabled,
      documentId,
    );

    set(nextState);
    persistWorkspaceSnapshot({
      openDocuments,
      activeDocumentId: nextState.activeDocumentId,
      isSplitViewEnabled: nextState.isSplitViewEnabled,
      secondaryDocumentId: nextState.secondaryDocumentId,
      mergeSelectionDocumentIds,
    });
  },

  toggleDocumentMergeSelection(documentId) {
    const { mergeSelectionDocumentIds, openDocuments } = get();
    if (!openDocuments.some((session) => session.id === documentId)) {
      return;
    }

    const nextRequestedSelection = mergeSelectionDocumentIds.includes(documentId)
      ? mergeSelectionDocumentIds.filter((id) => id !== documentId)
      : [...mergeSelectionDocumentIds, documentId];
    const nextMergeSelectionDocumentIds =
      nextRequestedSelection.length > 0
        ? normalizeMergeSelectionDocumentIds(openDocuments, nextRequestedSelection)
        : [];

    set({
      mergeSelectionDocumentIds: nextMergeSelectionDocumentIds,
      lastError: null,
      lastOperationMessage: null,
    });
    persistWorkspaceSnapshot({
      openDocuments,
      activeDocumentId: get().activeDocumentId,
      isSplitViewEnabled: get().isSplitViewEnabled,
      secondaryDocumentId: get().secondaryDocumentId,
      mergeSelectionDocumentIds: nextMergeSelectionDocumentIds,
    });
  },

  async mergeSelectedDocuments(outputPath) {
    const {
      isSplitViewEnabled,
      mergeSelectionDocumentIds,
      openDocuments,
      recentFiles,
      secondaryDocumentId,
    } = get();
    const nextOutputPath = outputPath.trim();
    const selectedDocumentIds = normalizeMergeSelectionDocumentIds(
      openDocuments,
      mergeSelectionDocumentIds,
    );
    const selectedSessions = openDocuments.filter((session) =>
      selectedDocumentIds.includes(session.id),
    );

    if (selectedSessions.length < 2) {
      set({
        lastError: "请至少选择两个文档再执行合并。",
        lastOperationMessage: null,
      });
      return;
    }

    if (!nextOutputPath) {
      set({
        lastError: "请选择有效的合并输出路径。",
        lastOperationMessage: null,
      });
      return;
    }

    if (
      openDocuments.some(
        (session) => session.document.path === nextOutputPath,
      )
    ) {
      set({
        lastError: "合并输出路径不能与当前工作区中已打开的文档重复。",
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isMerging: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.mergePdfs({
        inputPaths: selectedSessions.map((session) => session.document.path),
        outputPath: nextOutputPath,
      });
      const mergedDocument = await pdfBackend.inspectPdf(nextOutputPath);
      const mergedSession = createWorkspaceDocumentSession(mergedDocument);
      const nextOpenDocuments = upsertWorkspaceDocumentSession(
        openDocuments,
        mergedSession,
      );
      const nextRecentFiles = updateRecentFiles(
        recentFiles,
        nextOutputPath,
        RECENT_FILES_LIMIT,
      );
      const nextState = {
        isMerging: false,
        draftPath: nextOutputPath,
        lastError: null,
        lastOperationMessage: `已按当前顺序合并 ${selectedSessions.length} 个文档到 ${nextOutputPath}。`,
        recentFiles: nextRecentFiles,
        mergeSelectionDocumentIds,
        ...buildActiveWorkspaceState(
          nextOpenDocuments,
          mergedSession.id,
          isSplitViewEnabled,
          secondaryDocumentId,
        ),
      };

      persistRecentFiles(nextRecentFiles);
      set(nextState);
      persistWorkspaceSnapshot({
        openDocuments: nextOpenDocuments,
        activeDocumentId: mergedSession.id,
        isSplitViewEnabled: nextState.isSplitViewEnabled,
        secondaryDocumentId: nextState.secondaryDocumentId,
        mergeSelectionDocumentIds,
      });
    } catch (error) {
      set({
        isMerging: false,
        lastError: getOperationErrorMessage(error, "合并文档失败。"),
        lastOperationMessage: null,
      });
    }
  },

  selectPage(pageNumber, mode) {
    const currentState = get();
    const { activeDocument, selectedPageNumbers, selectionAnchorPage } = currentState;
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
      set(
        updateActiveWorkspaceSessionState(currentState, (session) => ({
          ...session,
          selectedPageNumbers: [pageNumber],
          selectionAnchorPage: pageNumber,
        })),
      );
      return;
    }

    if (mode === "toggle") {
      const nextSelection = selectedPageNumbers.includes(pageNumber)
        ? selectedPageNumbers.filter((value) => value !== pageNumber)
        : [...selectedPageNumbers, pageNumber];

      set(
        updateActiveWorkspaceSessionState(currentState, (session) => ({
          ...session,
          selectedPageNumbers: sortByDocumentOrder(nextSelection),
          selectionAnchorPage: pageNumber,
        })),
      );
      return;
    }

    const anchor = selectionAnchorPage ?? pageNumber;
    const anchorIndex = pageOrder.indexOf(anchor);
    const nextIndex = pageOrder.indexOf(pageNumber);
    const [start, end] =
      anchorIndex <= nextIndex ? [anchorIndex, nextIndex] : [nextIndex, anchorIndex];

    set(
      updateActiveWorkspaceSessionState(currentState, (session) => ({
        ...session,
        selectedPageNumbers: pageOrder.slice(start, end + 1),
        selectionAnchorPage: anchor,
      })),
    );
  },

  async movePageToDocument(targetDocumentId, sourcePageNumber, targetPosition) {
    const state = get();
    const {
      activeDocument,
      activeDocumentId,
      isSplitViewEnabled,
      openDocuments,
      secondaryDocumentId,
      selectedPageNumbers,
    } = state;

    if (!activeDocument || !activeDocumentId) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    const targetSession = getWorkspaceDocumentSession(openDocuments, targetDocumentId);
    if (!targetSession || targetSession.id === activeDocumentId) {
      return;
    }

    if (!activeDocument.pages.some((page) => page.pageNumber === sourcePageNumber)) {
      set({
        lastError: "拖动的页面不在当前主文档中。",
        lastOperationMessage: null,
      });
      return;
    }

    const nextTargetPosition =
      targetPosition === null ? targetSession.document.pageCount : targetPosition;

    set({
      isReordering: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.movePagesBetweenDocuments({
        sourcePath: activeDocument.path,
        targetPath: targetSession.document.path,
        pageNumbers: [sourcePageNumber],
        targetPosition: nextTargetPosition,
      });

      const refreshedSourceDocument = await pdfBackend.inspectPdf(activeDocument.path);
      const refreshedTargetDocument = await pdfBackend.inspectPdf(targetSession.document.path);
      const nextSourceSelection = getBoundSelection(
        refreshedSourceDocument,
        shiftSelectionAfterPageRemoval(selectedPageNumbers, sourcePageNumber),
      );
      const insertedPageNumber = Math.min(
        nextTargetPosition + 1,
        refreshedTargetDocument.pageCount,
      );
      const nextOpenDocuments = openDocuments.map((session) => {
        if (session.id === activeDocumentId) {
          return {
            ...session,
            document: refreshedSourceDocument,
            actionHistory: createEmptyActionHistory(),
            ...nextSourceSelection,
          };
        }

        if (session.id === targetDocumentId) {
          return {
            ...session,
            document: refreshedTargetDocument,
            actionHistory: createEmptyActionHistory(),
            selectedPageNumbers: [insertedPageNumber],
            selectionAnchorPage: insertedPageNumber,
          };
        }

        return session;
      });

      set({
        ...buildActiveWorkspaceState(
          nextOpenDocuments,
          activeDocumentId,
          isSplitViewEnabled,
          secondaryDocumentId,
        ),
        isReordering: false,
        lastError: null,
        lastOperationMessage: `已将第 ${sourcePageNumber} 页移动到 ${targetSession.document.path}。`,
      });
    } catch (error) {
      set({
        isReordering: false,
        lastError: getOperationErrorMessage(error, "跨文档移动页面失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async reorderPages(pageNumbers) {
    const { activeDocument, actionHistory, selectedPageNumbers } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    const currentPageNumbers = activeDocument.pages.map((page) => page.pageNumber);
    const hasSameLength = pageNumbers.length === currentPageNumbers.length;
    const hasSameOrder =
      hasSameLength && pageNumbers.every((pageNumber, index) => pageNumber === currentPageNumbers[index]);

    if (!hasSameLength || hasSameOrder) {
      return;
    }

    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        activeDocument.path,
        `重排 ${pageNumbers.length} 页`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isReordering: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.reorderPages({
        inputPath: activeDocument.path,
        pageNumbers,
        outputPath: activeDocument.path,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(activeDocument.path);
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已重排 ${pageNumbers.length} 页。`;

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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          ...getBoundSelection(refreshedDocument, selectedPageNumbers),
        })),
        isReordering: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
      });
    } catch (error) {
      set({
        isReordering: false,
        lastError: getOperationErrorMessage(error, "重排页面失败。"),
        lastOperationMessage: null,
      });
    }
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
      ...updateActiveWorkspaceSessionState(get(), (session) => ({
        ...session,
        document: optimisticDocument,
        selectionAnchorPage,
      })),
      isRotating: true,
      lastError: null,
      lastOperationMessage: null,
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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          selectedPageNumbers,
          selectionAnchorPage,
        })),
        isRotating: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
      });
    } catch (error) {
      set({
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: previousDocument,
          selectedPageNumbers,
          selectionAnchorPage,
        })),
        isRotating: false,
        lastError: getOperationErrorMessage(error, "旋转页面失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async cropSelectedPages(margins) {
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
        lastError: "请先选择要裁剪的页面。",
        lastOperationMessage: null,
      });
      return;
    }

    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        activeDocument.path,
        `裁剪 ${selectedPageNumbers.length} 页`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isCropping: true,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.cropPdf({
        inputPath: activeDocument.path,
        outputPath: activeDocument.path,
        pageNumbers: selectedPageNumbers,
        margins,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(activeDocument.path);
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已裁剪 ${selectedPageNumbers.length} 页。`;

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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          selectedPageNumbers,
          selectionAnchorPage:
            selectedPageNumbers[selectedPageNumbers.length - 1] ?? null,
        })),
        isCropping: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
      });
    } catch (error) {
      set({
        isCropping: false,
        lastError: getOperationErrorMessage(error, "裁剪页面失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async importImages(imagePaths, position, afterPageNumber) {
    const { activeDocument, actionHistory, selectedPageNumbers } = get();
    if (!activeDocument) {
      set({
        lastError: "请先加载一个 PDF 文档。",
        lastOperationMessage: null,
      });
      return;
    }

    const nextImagePaths = imagePaths
      .map((path) => path.trim())
      .filter((path, index, paths) => path.length > 0 && paths.indexOf(path) === index);

    if (nextImagePaths.length === 0) {
      set({
        lastError: "请选择至少一个图片文件。",
        lastOperationMessage: null,
      });
      return;
    }

    const resolvedAfterPageNumber =
      position === "after-selection"
        ? afterPageNumber ??
          (selectedPageNumbers.length > 0 ? Math.max(...selectedPageNumbers) : null)
        : null;
    const resolvedPosition =
      position === "after-selection" && resolvedAfterPageNumber === null
        ? "append"
        : position;
    let pendingHistoryEntry: ActionHistoryEntry;

    try {
      pendingHistoryEntry = await createPendingHistoryEntry(
        activeDocument.path,
        `导入 ${nextImagePaths.length} 张图片`,
      );
    } catch (error) {
      set({
        lastError: getOperationErrorMessage(error, "记录撤销快照失败。"),
        lastOperationMessage: null,
      });
      return;
    }

    set({
      isImportingImages: true,
      imageImportProgressTotal: nextImagePaths.length,
      lastError: null,
      lastOperationMessage: null,
    });

    try {
      await pdfBackend.importImages({
        targetPath: activeDocument.path,
        outputPath: activeDocument.path,
        imagePaths: nextImagePaths,
        position: resolvedPosition,
        afterPageNumber: resolvedAfterPageNumber,
      });
      const refreshedDocument = await pdfBackend.inspectPdf(activeDocument.path);
      const insertionStartPageNumber =
        resolvedPosition === "prepend"
          ? 1
          : resolvedPosition === "append"
            ? activeDocument.pageCount + 1
            : (resolvedAfterPageNumber ?? 0) + 1;
      const insertedPageNumbers = Array.from(
        { length: nextImagePaths.length },
        (_, index) => insertionStartPageNumber + index,
      );
      let nextActionHistory = actionHistory;
      let nextOperationMessage = `已导入 ${nextImagePaths.length} 张图片。`;

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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          selectedPageNumbers: insertedPageNumbers,
          selectionAnchorPage: insertedPageNumbers[insertedPageNumbers.length - 1] ?? null,
        })),
        isImportingImages: false,
        imageImportProgressTotal: 0,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
      });
    } catch (error) {
      set({
        isImportingImages: false,
        imageImportProgressTotal: 0,
        lastError: getOperationErrorMessage(error, "导入图片失败。"),
        lastOperationMessage: null,
      });
    }
  },

  async saveDocumentAs(outputPath) {
    const {
      activeDocument,
      mergeSelectionDocumentIds,
      openDocuments,
      selectedPageNumbers,
      recentFiles,
    } = get();
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

    if (
      openDocuments.some(
        (session) =>
          session.id === nextOutputPath && session.id !== activeDocument.path,
      )
    ) {
      set({
        lastError: "该 PDF 已在工作区中打开，请直接切换对应标签。",
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
      const nextMergeSelectionDocumentIds = normalizeMergeSelectionDocumentIds(
        renameWorkspaceDocumentSession(openDocuments, activeDocument.path, refreshedDocument),
        mergeSelectionDocumentIds.map((documentId) =>
          documentId === activeDocument.path ? nextOutputPath : documentId,
        ),
      );
      const nextState = {
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          id: nextOutputPath,
          document: refreshedDocument,
          actionHistory: createEmptyActionHistory(),
          ...getBoundSelection(refreshedDocument, selectedPageNumbers),
        })),
        draftPath: nextOutputPath,
        isSaving: false,
        lastError: null,
        lastOperationMessage: `已另存为 ${nextOutputPath}。`,
        recentFiles: nextRecentFiles,
        mergeSelectionDocumentIds: nextMergeSelectionDocumentIds,
      };

      set(nextState);
      persistWorkspaceSnapshot({
        openDocuments: renameWorkspaceDocumentSession(
          openDocuments,
          activeDocument.path,
          refreshedDocument,
        ),
        activeDocumentId: nextOutputPath,
        isSplitViewEnabled: nextState.isSplitViewEnabled,
        secondaryDocumentId: nextState.secondaryDocumentId,
        mergeSelectionDocumentIds: nextMergeSelectionDocumentIds,
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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: restoredDocument,
          actionHistory: transition.history,
          ...getDefaultSelection(restoredDocument),
        })),
        isUndoing: false,
        lastError: null,
        lastOperationMessage: `已撤销：${transition.entry.label}。`,
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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: restoredDocument,
          actionHistory: transition.history,
          ...getDefaultSelection(restoredDocument),
        })),
        isRedoing: false,
        lastError: null,
        lastOperationMessage: `已重做：${transition.entry.label}。`,
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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          selectedPageNumbers: nextSelectedPages,
          selectionAnchorPage: nextSelectedPages[0] ?? null,
        })),
        isDeleting: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          selectedPageNumbers: duplicatedPageNumbers,
          selectionAnchorPage:
            duplicatedPageNumbers[duplicatedPageNumbers.length - 1] ?? null,
        })),
        isDuplicating: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
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
        ...updateActiveWorkspaceSessionState(get(), (session) => ({
          ...session,
          document: refreshedDocument,
          actionHistory: nextActionHistory,
          selectedPageNumbers: [insertedPageNumber],
          selectionAnchorPage: insertedPageNumber,
        })),
        isInsertingBlank: false,
        lastError: null,
        lastOperationMessage: nextOperationMessage,
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
