export type CropBox = [number, number, number, number];

export interface CropMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CropState {
  pageBox: CropBox;
  margins: CropMargins;
}

type CropEdge = keyof CropMargins;

const MIN_CROP_SIZE = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPageWidth(pageBox: CropBox) {
  return pageBox[2] - pageBox[0];
}

function getPageHeight(pageBox: CropBox) {
  return pageBox[3] - pageBox[1];
}

function getAvailableHorizontalMargin(pageBox: CropBox) {
  return getPageWidth(pageBox) - MIN_CROP_SIZE;
}

function getAvailableVerticalMargin(pageBox: CropBox) {
  return getPageHeight(pageBox) - MIN_CROP_SIZE;
}

function clampMargins(pageBox: CropBox, margins: CropMargins): CropMargins {
  const left = clamp(margins.left, 0, getAvailableHorizontalMargin(pageBox));
  const right = clamp(
    margins.right,
    0,
    Math.max(getAvailableHorizontalMargin(pageBox) - left, 0),
  );
  const top = clamp(margins.top, 0, getAvailableVerticalMargin(pageBox));
  const bottom = clamp(
    margins.bottom,
    0,
    Math.max(getAvailableVerticalMargin(pageBox) - top, 0),
  );

  return {
    left,
    right,
    top,
    bottom,
  };
}

function distributeMargins(total: number, first: number, second: number) {
  if (total <= 0) {
    return [0, 0] as const;
  }

  const currentTotal = first + second;
  if (currentTotal <= 0) {
    const half = total / 2;
    return [half, total - half] as const;
  }

  const firstRatio = first / currentTotal;
  const nextFirst = total * firstRatio;
  return [nextFirst, total - nextFirst] as const;
}

export function createCropStateFromPageBoxes(
  pageBox: CropBox,
  cropBox: CropBox | null,
): CropState {
  if (!cropBox) {
    return {
      pageBox,
      margins: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
    };
  }

  return {
    pageBox,
    margins: {
      left: cropBox[0] - pageBox[0],
      right: pageBox[2] - cropBox[2],
      top: pageBox[3] - cropBox[3],
      bottom: cropBox[1] - pageBox[1],
    },
  };
}

export function getCropDimensions(state: CropState) {
  const { pageBox, margins } = state;

  return {
    width: getPageWidth(pageBox) - margins.left - margins.right,
    height: getPageHeight(pageBox) - margins.top - margins.bottom,
  };
}

export function applyCropMarginChange({
  edge,
  lockAspectRatio = false,
  nextValue,
  state,
}: {
  edge: CropEdge;
  lockAspectRatio?: boolean;
  nextValue: number;
  state: CropState;
}): CropMargins {
  const pageWidth = getPageWidth(state.pageBox);
  const pageHeight = getPageHeight(state.pageBox);
  const nextMargins = {
    ...state.margins,
    [edge]: nextValue,
  };

  if (!lockAspectRatio) {
    return clampMargins(state.pageBox, nextMargins);
  }

  const pageAspectRatio = pageWidth / pageHeight;
  if (edge === "left" || edge === "right") {
    const horizontal = clampMargins(state.pageBox, nextMargins);
    const croppedWidth = pageWidth - horizontal.left - horizontal.right;
    const targetHeight = croppedWidth / pageAspectRatio;
    const verticalMargins = clamp(pageHeight - targetHeight, 0, pageHeight - MIN_CROP_SIZE);
    const [top, bottom] = distributeMargins(
      verticalMargins,
      state.margins.top,
      state.margins.bottom,
    );

    return clampMargins(state.pageBox, {
      ...horizontal,
      top,
      bottom,
    });
  }

  const vertical = clampMargins(state.pageBox, nextMargins);
  const croppedHeight = pageHeight - vertical.top - vertical.bottom;
  const targetWidth = croppedHeight * pageAspectRatio;
  const horizontalMargins = clamp(
    pageWidth - targetWidth,
    0,
    pageWidth - MIN_CROP_SIZE,
  );
  const [left, right] = distributeMargins(
    horizontalMargins,
    state.margins.left,
    state.margins.right,
  );

  return clampMargins(state.pageBox, {
    ...vertical,
    left,
    right,
  });
}
