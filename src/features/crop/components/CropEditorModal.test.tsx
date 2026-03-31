import React from "react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import userEvent from "@testing-library/user-event";

mock.module("react-konva", () => ({
  Stage: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stage">{children}</div>
  ),
  Layer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Rect: () => null,
  Text: ({ text }: { text: string }) => <span>{text}</span>,
  Image: () => null,
}));

import { CropEditorModal } from "./CropEditorModal";

describe("CropEditorModal", () => {
  const OriginalImage = globalThis.Image;
  const OriginalWindow = globalThis.window;
  const OriginalDocument = globalThis.document;
  const OriginalNavigator = globalThis.navigator;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    // @ts-expect-error test shim
    globalThis.window = dom.window;
    // @ts-expect-error test shim
    globalThis.document = dom.window.document;
    // @ts-expect-error test shim
    globalThis.navigator = dom.window.navigator;
    // @ts-expect-error test shim
    globalThis.HTMLElement = dom.window.HTMLElement;
    // @ts-expect-error test shim
    globalThis.Node = dom.window.Node;
    // @ts-expect-error React input polyfill compat for jsdom
    dom.window.HTMLElement.prototype.attachEvent = () => {};
    // @ts-expect-error React input polyfill compat for jsdom
    dom.window.HTMLElement.prototype.detachEvent = () => {};

    class TestImage {
      onload: null | (() => void) = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    // @ts-expect-error test stub
    globalThis.Image = TestImage;
  });

  afterEach(() => {
    cleanup();
    globalThis.Image = OriginalImage;
    // @ts-expect-error restore
    globalThis.window = OriginalWindow;
    // @ts-expect-error restore
    globalThis.document = OriginalDocument;
    // @ts-expect-error restore
    globalThis.navigator = OriginalNavigator;
  });

  test("applies the edited crop margins", async () => {
    const onApply = mock(() => {});
    const user = userEvent.setup({ document: globalThis.document });

    const view = render(
      <CropEditorModal
        isApplying={false}
        isOpen
        onApply={onApply}
        onClose={() => {}}
        page={{
          pageNumber: 2,
          mediaBox: [0, 0, 600, 800],
          cropBox: null,
          rotation: 0,
          thumbnailDataUrl: "data:image/png;base64,stub",
        }}
        selectedPageCount={3}
      />,
    );

    const topInput = view
      .getByText("top")
      .closest("label")
      ?.querySelector("input");
    if (!topInput) {
      throw new Error("top input not found");
    }

    await user.clear(topInput);
    await user.type(topInput, "24");
    fireEvent.click(view.getByText("Apply crop"));

    expect(onApply).toHaveBeenCalledWith({
      left: 0,
      right: 0,
      top: 24,
      bottom: 0,
    });
    expect(view.getByText("当前设置会应用到 3 个已选页面。")).toBeTruthy();
  });
});
