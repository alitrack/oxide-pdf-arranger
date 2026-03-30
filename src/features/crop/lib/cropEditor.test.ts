import { describe, expect, test } from "bun:test";
import {
  applyCropMarginChange,
  createCropStateFromPageBoxes,
  getCropDimensions,
} from "./cropEditor";

describe("cropEditor", () => {
  test("createCropStateFromPageBoxes derives margins from the existing crop box", () => {
    expect(
      createCropStateFromPageBoxes([0, 0, 600, 800], [12, 24, 560, 760]),
    ).toEqual({
      margins: {
        left: 12,
        right: 40,
        top: 40,
        bottom: 24,
      },
      pageBox: [0, 0, 600, 800],
    });
  });

  test("applyCropMarginChange clamps margins to the page bounds", () => {
    const state = createCropStateFromPageBoxes([0, 0, 600, 800], null);

    expect(
      applyCropMarginChange({
        edge: "left",
        nextValue: 650,
        state,
      }),
    ).toEqual({
      left: 599,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  test("applyCropMarginChange keeps aspect ratio when locked", () => {
    const state = createCropStateFromPageBoxes([0, 0, 600, 800], null);

    expect(
      applyCropMarginChange({
        edge: "right",
        lockAspectRatio: true,
        nextValue: 120,
        state,
      }),
    ).toEqual({
      left: 0,
      right: 120,
      top: 80,
      bottom: 80,
    });
  });

  test("getCropDimensions returns the current cropped width and height", () => {
    const state = createCropStateFromPageBoxes([0, 0, 600, 800], [10, 20, 560, 780]);

    expect(getCropDimensions(state)).toEqual({
      width: 550,
      height: 760,
    });
  });
});
