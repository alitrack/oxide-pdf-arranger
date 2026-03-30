import type { PdfDocumentSummary, PdfPageInfo, RotatePdfRequest } from "../../backend/types/pdf";

function rotateBox(box: [number, number, number, number]) {
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  return [box[0], box[1], box[0] + height, box[1] + width] as [
    number,
    number,
    number,
    number,
  ];
}

export function createInPlaceRotateRequest(
  documentPath: string,
  pageNumbers: number[],
  rotationDegrees: number,
): RotatePdfRequest {
  return {
    inputPath: documentPath,
    outputPath: documentPath,
    pageNumbers,
    rotationDegrees,
  };
}

function rotatePagePreview(page: PdfPageInfo, rotationDegrees: number): PdfPageInfo {
  const normalizedRotation = ((page.rotation + rotationDegrees) % 360 + 360) % 360;
  const shouldSwapBoxes = Math.abs(rotationDegrees) % 180 === 90;

  return {
    ...page,
    rotation: normalizedRotation,
    mediaBox: shouldSwapBoxes ? rotateBox(page.mediaBox) : page.mediaBox,
    cropBox:
      shouldSwapBoxes && page.cropBox ? rotateBox(page.cropBox) : page.cropBox,
  };
}

export function applyRotationPreview(
  document: PdfDocumentSummary,
  pageNumbers: number[],
  rotationDegrees: number,
): PdfDocumentSummary {
  const selected = new Set(pageNumbers);

  return {
    ...document,
    pages: document.pages.map((page) =>
      selected.has(page.pageNumber)
        ? rotatePagePreview(page, rotationDegrees)
        : page,
    ),
  };
}
