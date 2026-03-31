export type ImageImportPlacement = "append" | "prepend" | "after-selection";

export function resolveImageImportPlacement(
  placement: ImageImportPlacement,
  selectedPageNumbers: number[],
  pageCount: number,
) {
  if (placement !== "after-selection") {
    return {
      position: placement,
      afterPageNumber: null,
    } as const;
  }

  const validSelection = selectedPageNumbers.filter(
    (pageNumber) => pageNumber >= 1 && pageNumber <= pageCount,
  );
  if (validSelection.length === 0) {
    return {
      position: "append",
      afterPageNumber: null,
    } as const;
  }

  return {
    position: "after-selection",
    afterPageNumber: Math.max(...validSelection),
  } as const;
}

export function getImageImportDialogExtensions() {
  return ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp"];
}
