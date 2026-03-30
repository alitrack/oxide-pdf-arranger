import { invokeCommand } from "../../../shared/lib/tauri";
import type {
  DeletePagesRequest,
  DuplicatePagesRequest,
  MergePdfRequest,
  PdfDocumentSummary,
  PdfOperationResult,
  RotatePdfRequest,
  SplitPdfRequest,
} from "../types/pdf";

export const pdfBackend = {
  inspectPdf(path: string) {
    return invokeCommand<PdfDocumentSummary>("inspect_pdf", { path });
  },

  mergePdfs(request: MergePdfRequest) {
    return invokeCommand<PdfOperationResult>("merge_pdfs", { request });
  },

  splitPdf(request: SplitPdfRequest) {
    return invokeCommand<PdfOperationResult>("split_pdf", { request });
  },

  rotatePdf(request: RotatePdfRequest) {
    return invokeCommand<PdfOperationResult>("rotate_pdf", { request });
  },

  deletePages(request: DeletePagesRequest) {
    return invokeCommand<PdfOperationResult>("delete_pages", { request });
  },

  duplicatePages(request: DuplicatePagesRequest) {
    return invokeCommand<PdfOperationResult>("duplicate_pages", { request });
  },
};
