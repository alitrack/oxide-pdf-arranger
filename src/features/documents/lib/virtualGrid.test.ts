import { describe, expect, test } from "bun:test";
import { computeVirtualGridWindow } from "./virtualGrid";

describe("computeVirtualGridWindow", () => {
  test("renders the first viewport with overscan and bottom padding", () => {
    const windowState = computeVirtualGridWindow({
      itemCount: 120,
      gridItemWidth: 160,
      viewportWidth: 900,
      viewportHeight: 720,
      scrollTop: 0,
    });

    expect(windowState.columns).toBe(5);
    expect(windowState.rowHeight).toBe(297);
    expect(windowState.startIndex).toBe(0);
    expect(windowState.endIndex).toBe(25);
    expect(windowState.paddingTop).toBe(0);
    expect(windowState.paddingBottom).toBeGreaterThan(0);
  });

  test("keeps only the intersecting rows plus overscan around a scrolled viewport", () => {
    const windowState = computeVirtualGridWindow({
      itemCount: 200,
      gridItemWidth: 180,
      viewportWidth: 1024,
      viewportHeight: 680,
      scrollTop: 1800,
    });

    expect(windowState.columns).toBe(5);
    expect(windowState.rowHeight).toBe(322);
    expect(windowState.startIndex).toBe(15);
    expect(windowState.endIndex).toBe(50);
    expect(windowState.paddingTop).toBeGreaterThan(0);
    expect(windowState.paddingBottom).toBeGreaterThan(0);
  });
});
