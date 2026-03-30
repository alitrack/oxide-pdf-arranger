export interface VirtualGridInput {
  itemCount: number;
  gridItemWidth: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollTop: number;
}

export interface VirtualGridWindow {
  columns: number;
  rowHeight: number;
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

const GRID_GAP = 16;
const OVERSCAN_ROWS = 2;
const CARD_CHROME_HEIGHT = 92;

function clampToNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function computeVirtualGridWindow(input: VirtualGridInput): VirtualGridWindow {
  const itemCount = clampToNonNegative(input.itemCount);
  const gridItemWidth = Math.max(1, input.gridItemWidth);
  const viewportWidth = Math.max(gridItemWidth, input.viewportWidth);
  const viewportHeight = Math.max(1, input.viewportHeight);
  const scrollTop = clampToNonNegative(input.scrollTop);

  const columns = Math.max(
    1,
    Math.floor((viewportWidth + GRID_GAP) / (gridItemWidth + GRID_GAP)),
  );
  const rowHeight = Math.max(
    1,
    Math.round(gridItemWidth * 1.28 + CARD_CHROME_HEIGHT),
  );
  const totalRows = Math.ceil(itemCount / columns);

  if (itemCount === 0) {
    return {
      columns,
      rowHeight,
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const firstVisibleRow = Math.floor(scrollTop / rowHeight);
  const lastVisibleRowExclusive = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const startRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
  const endRowExclusive = Math.min(totalRows, lastVisibleRowExclusive + OVERSCAN_ROWS);

  return {
    columns,
    rowHeight,
    startIndex: startRow * columns,
    endIndex: Math.min(itemCount, endRowExclusive * columns),
    paddingTop: startRow * rowHeight,
    paddingBottom: Math.max(0, (totalRows - endRowExclusive) * rowHeight),
  };
}
