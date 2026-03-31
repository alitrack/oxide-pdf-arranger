import { describe, expect, test } from "bun:test";
import {
  getPinchZoomAction,
  measureTouchDistance,
} from "./touchGestures";

describe("touchGestures", () => {
  test("measureTouchDistance returns the Euclidean distance between two touches", () => {
    expect(
      measureTouchDistance(
        { clientX: 10, clientY: 10 },
        { clientX: 34, clientY: 42 },
      ),
    ).toBe(40);
  });

  test("getPinchZoomAction returns zoom-in when the distance grows beyond the threshold", () => {
    expect(getPinchZoomAction(100, 136, 24)).toBe("zoom-in");
  });

  test("getPinchZoomAction returns zoom-out when the distance shrinks beyond the threshold", () => {
    expect(getPinchZoomAction(120, 80, 24)).toBe("zoom-out");
  });

  test("getPinchZoomAction ignores small movements", () => {
    expect(getPinchZoomAction(120, 132, 24)).toBeNull();
  });
});
