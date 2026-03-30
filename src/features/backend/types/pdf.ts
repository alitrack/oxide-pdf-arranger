export interface PdfPageInfo {
  pageNumber: number;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number] | null;
  rotation: number;
  thumbnailDataUrl: string;
}

export interface PdfDocumentSummary {
  path: string;
  pageCount: number;
  pages: PdfPageInfo[];
}

export interface MergePdfRequest {
  inputPaths: string[];
  outputPath: string;
}

export interface SplitPdfRequest {
  inputPath: string;
  pageNumbers: number[];
  outputPath: string;
}

export interface RotatePdfRequest {
  inputPath: string;
  pageNumbers: number[];
  rotationDegrees: number;
  outputPath: string;
}

export interface DeletePagesRequest {
  inputPath: string;
  pageNumbers: number[];
  outputPath: string;
}

export interface DuplicatePagesRequest {
  inputPath: string;
  pageNumbers: number[];
  outputPath: string;
}

export interface InsertBlankPageRequest {
  inputPath: string;
  afterPageNumber: number;
  outputPath: string;
}

export interface ReorderPagesRequest {
  inputPath: string;
  pageNumbers: number[];
  outputPath: string;
}

export interface CopyDocumentRequest {
  inputPath: string;
  outputPath: string;
}

export interface MovePagesBetweenDocumentsRequest {
  sourcePath: string;
  targetPath: string;
  pageNumbers: number[];
  targetPosition: number;
}

export interface PdfOperationResult {
  outputPath: string;
  pageCount: number;
}

export interface TauriCommandErrorPayload {
  code: string;
  message: string;
}
