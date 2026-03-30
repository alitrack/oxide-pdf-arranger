import { create } from "zustand";
import { pdfBackend } from "../../backend/api/pdfBackend";
import type { PdfDocumentSummary } from "../../backend/types/pdf";
import { TauriInvokeError } from "../../../shared/lib/tauri";

interface PdfDocumentStoreState {
  draftPath: string;
  activeDocument: PdfDocumentSummary | null;
  lastError: string | null;
  isInspecting: boolean;
  setDraftPath(nextPath: string): void;
  inspectPdf(path?: string): Promise<void>;
}

function getInspectErrorMessage(error: unknown) {
  return error instanceof TauriInvokeError ? error.message : "Inspect PDF 失败。";
}

export const usePdfDocumentStore = create<PdfDocumentStoreState>((set, get) => ({
  draftPath: "",
  activeDocument: null,
  lastError: null,
  isInspecting: false,

  setDraftPath(nextPath) {
    set({ draftPath: nextPath });
  },

  async inspectPdf(path) {
    const nextPath = (path ?? get().draftPath).trim();
    if (!nextPath) {
      set({
        activeDocument: null,
        lastError: "请输入一个可访问的 PDF 绝对路径。",
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
      });
    } catch (error) {
      set({
        activeDocument: null,
        isInspecting: false,
        lastError: getInspectErrorMessage(error),
      });
    }
  },
}));
