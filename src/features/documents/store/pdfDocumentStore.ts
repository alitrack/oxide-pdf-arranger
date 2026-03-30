import { create } from "zustand";
import { pdfBackend } from "../../backend/api/pdfBackend";
import type { PdfDocumentSummary } from "../../backend/types/pdf";
import { TauriInvokeError } from "../../../shared/lib/tauri";
import {
  applyRotationPreview,
  createInPlaceRotateRequest,
} from "../lib/rotationPreview";

const DEFAULT_GRID_ITEM_WIDTH = 156;
const GRID_ITEM_WIDTH_STEP = 20;
const MIN_GRID_ITEM_WIDTH = 140;
const MAX_GRID_ITEM_WIDTH = 260;

interface PdfDocumentStoreState {
  draftPath: string;
  activeDocument: PdfDocumentSummary | null;
  lastError: string | null;
  lastOperationMessage: string | null;
  isInspecting: boolean;
  isRotating: boolean;
  isDeleting: boolean;
  isDuplicating: boolean;
  selectedPageNumbers: number[];
  selectionAnchorPage: number | null;
  gridItemWidth: number;
  setDraftPath(nextPath: string): void;
  inspectPdf(path?: string): Promise<void>;
  selectPage(pageNumber: number, mode: "replace" | "toggle" | "range"): void;
  rotateSelectedPages(rotationDegrees: 90 | 180 | 270): Promise<void>;
  deleteSelectedPages(): Promise<void>;
  duplicateSelectedPages(): Promise<void>;
  zoomInGrid(): void;
  zoomOutGrid(): void;
  resetGridZoom(): void;
}

function getInspectErrorMessage(error: unknown) {
  return error instanceof TauriInvokeError ? error.message : "Inspect PDF 失败。";
}

export const usePdfDocumentStore = create<PdfDocumentStoreState>((set, get) => ({
  draftPath: "",
  activeDocument: null,
  lastError: null,
  lastOperationMessage: null,
  isInspecting: false,
  isRotating: false,
  isDeleting: false,
  isDuplicating: false,
  selectedPageNumbers: [],
  selectionAnchorPage: null,
  gridItemWidth: DEFAULT_GRID_ITEM_WIDTH,

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
      set({
        activeDocument,
        isInspecting: false,
        lastError: null,
        lastOperationMessage: null,
        selectedPageNumbers: activeDocument.pages[0] ? [activeDocument.pages[0].pageNumber] : [],
        selectionAnchorPage: activeDocument.pages[0]?.pageNumber ?? null,
      });
    } catch (error) {
      set({
        activeDocument: null,
        isInspecting: false,
        lastError: getInspectErrorMessage(error),
        lastOperationMessage: null,
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
    const { activeDocument, selectedPageNumbers } = get();
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

      set({
        activeDocument: refreshedDocument,
        isRotating: false,
        lastError: null,
        lastOperationMessage: `已旋转 ${selectedPageNumbers.length} 页（${rotationDegrees}°）。`,
        selectedPageNumbers,
        selectionAnchorPage,
      });
    } catch (error) {
      set({
        activeDocument: previousDocument,
        isRotating: false,
        lastError: error instanceof TauriInvokeError ? error.message : "旋转页面失败。",
        lastOperationMessage: null,
        selectedPageNumbers,
        selectionAnchorPage,
      });
    }
  },

  async deleteSelectedPages() {
    const { activeDocument, selectedPageNumbers } = get();
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

      set({
        activeDocument: refreshedDocument,
        isDeleting: false,
        lastError: null,
        lastOperationMessage: `已删除 ${selectedPageNumbers.length} 页。`,
        selectedPageNumbers: nextSelectedPages,
        selectionAnchorPage: nextSelectedPages[0] ?? null,
      });
    } catch (error) {
      set({
        isDeleting: false,
        lastError: error instanceof TauriInvokeError ? error.message : "删除页面失败。",
        lastOperationMessage: null,
      });
    }
  },

  async duplicateSelectedPages() {
    const { activeDocument, selectedPageNumbers } = get();
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

      set({
        activeDocument: refreshedDocument,
        isDuplicating: false,
        lastError: null,
        lastOperationMessage: `已复制 ${selectedPageNumbers.length} 页。`,
        selectedPageNumbers: duplicatedPageNumbers,
        selectionAnchorPage:
          duplicatedPageNumbers[duplicatedPageNumbers.length - 1] ?? null,
      });
    } catch (error) {
      set({
        isDuplicating: false,
        lastError: error instanceof TauriInvokeError ? error.message : "复制页面失败。",
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
