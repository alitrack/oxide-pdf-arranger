import { create } from "zustand";
import { pdfBackend } from "../../backend/api/pdfBackend";
import type { PdfDocumentSummary } from "../../backend/types/pdf";
import { TauriInvokeError } from "../../../shared/lib/tauri";

const DEFAULT_GRID_ITEM_WIDTH = 156;
const GRID_ITEM_WIDTH_STEP = 20;
const MIN_GRID_ITEM_WIDTH = 140;
const MAX_GRID_ITEM_WIDTH = 260;

interface PdfDocumentStoreState {
  draftPath: string;
  activeDocument: PdfDocumentSummary | null;
  lastError: string | null;
  isInspecting: boolean;
  selectedPageNumbers: number[];
  selectionAnchorPage: number | null;
  gridItemWidth: number;
  setDraftPath(nextPath: string): void;
  inspectPdf(path?: string): Promise<void>;
  selectPage(pageNumber: number, mode: "replace" | "toggle" | "range"): void;
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
  isInspecting: false,
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
        selectedPageNumbers: [],
        selectionAnchorPage: null,
      });
      return;
    }

    set({
      draftPath: nextPath,
      isInspecting: true,
      lastError: null,
    });

    try {
      const activeDocument = await pdfBackend.inspectPdf(nextPath);
      set({
        activeDocument,
        isInspecting: false,
        lastError: null,
        selectedPageNumbers: activeDocument.pages[0] ? [activeDocument.pages[0].pageNumber] : [],
        selectionAnchorPage: activeDocument.pages[0]?.pageNumber ?? null,
      });
    } catch (error) {
      set({
        activeDocument: null,
        isInspecting: false,
        lastError: getInspectErrorMessage(error),
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
