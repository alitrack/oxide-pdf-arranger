import { useEffect, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import type { CropMargins, PdfPageInfo } from "../../backend/types/pdf";
import {
  applyCropMarginChange,
  createCropStateFromPageBoxes,
  getCropDimensions,
  type CropState,
} from "../lib/cropEditor";

interface CropEditorModalProps {
  isApplying: boolean;
  isOpen: boolean;
  page: PdfPageInfo | null;
  selectedPageCount: number;
  onApply(margins: CropMargins): void;
  onClose(): void;
}

type HandleId =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const MAX_STAGE_HEIGHT = 560;
const MAX_STAGE_WIDTH = 420;
const HANDLE_SIZE = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function useHtmlImage(src: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }

    const nextImage = new window.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = src;

    return () => {
      nextImage.onload = null;
    };
  }, [src]);

  return image;
}

function getCropRect(state: CropState, scale: number) {
  const pageWidth = state.pageBox[2] - state.pageBox[0];
  const pageHeight = state.pageBox[3] - state.pageBox[1];
  const { margins } = state;

  return {
    x: margins.left * scale,
    y: margins.top * scale,
    width: (pageWidth - margins.left - margins.right) * scale,
    height: (pageHeight - margins.top - margins.bottom) * scale,
  };
}

export function CropEditorModal({
  isApplying,
  isOpen,
  page,
  selectedPageCount,
  onApply,
  onClose,
}: CropEditorModalProps) {
  const [cropState, setCropState] = useState<CropState | null>(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const image = useHtmlImage(isOpen ? page?.thumbnailDataUrl ?? null : null);

  useEffect(() => {
    if (!page || !isOpen) {
      setCropState(null);
      return;
    }

    setCropState(createCropStateFromPageBoxes(page.mediaBox, page.cropBox));
    setLockAspectRatio(false);
    setPreviewMode(true);
  }, [isOpen, page]);

  if (!isOpen || !page || !cropState) {
    return null;
  }

  const pageWidth = cropState.pageBox[2] - cropState.pageBox[0];
  const pageHeight = cropState.pageBox[3] - cropState.pageBox[1];
  const scale = Math.min(MAX_STAGE_WIDTH / pageWidth, MAX_STAGE_HEIGHT / pageHeight);
  const stageWidth = Math.round(pageWidth * scale);
  const stageHeight = Math.round(pageHeight * scale);
  const cropRect = getCropRect(cropState, scale);
  const cropDimensions = getCropDimensions(cropState);

  function updateEdge(edge: keyof CropMargins, nextValue: number) {
    setCropState((current) =>
      current
        ? {
            ...current,
            margins: applyCropMarginChange({
              edge,
              lockAspectRatio,
              nextValue,
              state: current,
            }),
          }
        : current,
    );
  }

  function updateCorner(horizontalEdge: "left" | "right", verticalEdge: "top" | "bottom", nextX: number, nextY: number) {
    setCropState((current) => {
      if (!current) {
        return current;
      }

      const afterHorizontal = {
        ...current,
        margins: applyCropMarginChange({
          edge: horizontalEdge,
          lockAspectRatio,
          nextValue: horizontalEdge === "left" ? nextX / scale : (stageWidth - nextX) / scale,
          state: current,
        }),
      };

      return {
        ...afterHorizontal,
        margins: applyCropMarginChange({
          edge: verticalEdge,
          lockAspectRatio,
          nextValue: verticalEdge === "top" ? nextY / scale : (stageHeight - nextY) / scale,
          state: afterHorizontal,
        }),
      };
    });
  }

  const handleSpecs: Array<{
    id: HandleId;
    x: number;
    y: number;
    cursor: string;
    onDrag(x: number, y: number): void;
  }> = [
    {
      id: "left",
      x: cropRect.x - HANDLE_SIZE / 2,
      y: cropRect.y + cropRect.height / 2 - HANDLE_SIZE / 2,
      cursor: "ew-resize",
      onDrag: (x) => updateEdge("left", x / scale),
    },
    {
      id: "right",
      x: cropRect.x + cropRect.width - HANDLE_SIZE / 2,
      y: cropRect.y + cropRect.height / 2 - HANDLE_SIZE / 2,
      cursor: "ew-resize",
      onDrag: (x) => updateEdge("right", (stageWidth - x) / scale),
    },
    {
      id: "top",
      x: cropRect.x + cropRect.width / 2 - HANDLE_SIZE / 2,
      y: cropRect.y - HANDLE_SIZE / 2,
      cursor: "ns-resize",
      onDrag: (_, y) => updateEdge("top", y / scale),
    },
    {
      id: "bottom",
      x: cropRect.x + cropRect.width / 2 - HANDLE_SIZE / 2,
      y: cropRect.y + cropRect.height - HANDLE_SIZE / 2,
      cursor: "ns-resize",
      onDrag: (_, y) => updateEdge("bottom", (stageHeight - y) / scale),
    },
    {
      id: "top-left",
      x: cropRect.x - HANDLE_SIZE / 2,
      y: cropRect.y - HANDLE_SIZE / 2,
      cursor: "nwse-resize",
      onDrag: (x, y) => updateCorner("left", "top", x, y),
    },
    {
      id: "top-right",
      x: cropRect.x + cropRect.width - HANDLE_SIZE / 2,
      y: cropRect.y - HANDLE_SIZE / 2,
      cursor: "nesw-resize",
      onDrag: (x, y) => updateCorner("right", "top", x, y),
    },
    {
      id: "bottom-left",
      x: cropRect.x - HANDLE_SIZE / 2,
      y: cropRect.y + cropRect.height - HANDLE_SIZE / 2,
      cursor: "nesw-resize",
      onDrag: (x, y) => updateCorner("left", "bottom", x, y),
    },
    {
      id: "bottom-right",
      x: cropRect.x + cropRect.width - HANDLE_SIZE / 2,
      y: cropRect.y + cropRect.height - HANDLE_SIZE / 2,
      cursor: "nwse-resize",
      onDrag: (x, y) => updateCorner("right", "bottom", x, y),
    },
  ];

  return (
    <div className="crop-modal-backdrop" role="presentation">
      <div
        aria-labelledby="crop-editor-title"
        aria-modal="true"
        className="crop-modal"
        role="dialog"
      >
        <div className="crop-modal-header">
          <div>
            <p className="panel-kicker">Visual Crop Editor</p>
            <h3 id="crop-editor-title">Crop Page {page.pageNumber}</h3>
            <p className="crop-modal-subtitle">
              {selectedPageCount > 1
                ? `当前设置会应用到 ${selectedPageCount} 个已选页面。`
                : "当前设置会应用到已选页面。"}
            </p>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="crop-modal-grid">
          <div className="crop-canvas-panel">
            <Stage className="crop-stage" height={stageHeight} width={stageWidth}>
              <Layer>
                <Rect
                  cornerRadius={20}
                  fill="rgba(14, 25, 34, 0.08)"
                  height={stageHeight}
                  width={stageWidth}
                  x={0}
                  y={0}
                />
                {image ? (
                  <KonvaImage
                    height={stageHeight}
                    image={image}
                    width={stageWidth}
                    x={0}
                    y={0}
                  />
                ) : null}
                <Group>
                  <Rect fill="rgba(8, 14, 21, 0.55)" height={cropRect.y} width={stageWidth} />
                  <Rect
                    fill="rgba(8, 14, 21, 0.55)"
                    height={stageHeight - cropRect.y - cropRect.height}
                    width={stageWidth}
                    x={0}
                    y={cropRect.y + cropRect.height}
                  />
                  <Rect
                    fill="rgba(8, 14, 21, 0.55)"
                    height={cropRect.height}
                    width={cropRect.x}
                    x={0}
                    y={cropRect.y}
                  />
                  <Rect
                    fill="rgba(8, 14, 21, 0.55)"
                    height={cropRect.height}
                    width={stageWidth - cropRect.x - cropRect.width}
                    x={cropRect.x + cropRect.width}
                    y={cropRect.y}
                  />
                </Group>
                <Rect
                  cornerRadius={12}
                  dash={[10, 6]}
                  height={cropRect.height}
                  listening={false}
                  stroke="#16a34a"
                  strokeWidth={2}
                  width={cropRect.width}
                  x={cropRect.x}
                  y={cropRect.y}
                />
                {handleSpecs.map((handle) => (
                  <Rect
                    cornerRadius={4}
                    draggable
                    fill="#f8fafc"
                    height={HANDLE_SIZE}
                    key={handle.id}
                    onDragMove={(event) => {
                      const x = clamp(event.target.x() + HANDLE_SIZE / 2, 0, stageWidth);
                      const y = clamp(event.target.y() + HANDLE_SIZE / 2, 0, stageHeight);
                      handle.onDrag(x, y);
                    }}
                    onMouseEnter={(event) => {
                      const container = event.target.getStage()?.container();
                      if (container) {
                        container.style.cursor = handle.cursor;
                      }
                    }}
                    onMouseLeave={(event) => {
                      const container = event.target.getStage()?.container();
                      if (container) {
                        container.style.cursor = "default";
                      }
                    }}
                    stroke="#0f172a"
                    strokeWidth={1}
                    width={HANDLE_SIZE}
                    x={handle.x}
                    y={handle.y}
                  />
                ))}
                <Text
                  fill="#0f172a"
                  fontSize={14}
                  text={`${Math.round(cropDimensions.width)} × ${Math.round(cropDimensions.height)}`}
                  x={12}
                  y={12}
                />
              </Layer>
            </Stage>
          </div>

          <div className="crop-controls-panel">
            <div className="crop-control-row">
              <label className="merge-selection-option">
                <input
                  checked={lockAspectRatio}
                  onChange={(event) => setLockAspectRatio(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Lock aspect ratio</span>
              </label>
              <label className="merge-selection-option">
                <input
                  checked={previewMode}
                  onChange={(event) => setPreviewMode(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Preview crop</span>
              </label>
            </div>

            <div className="crop-input-grid">
              {(["top", "right", "bottom", "left"] as Array<keyof CropMargins>).map((edge) => (
                <label className="field crop-input-field" key={edge}>
                  <span>{edge}</span>
                  <input
                    min={0}
                    onChange={(event) =>
                      updateEdge(edge, Number(event.currentTarget.value || 0))
                    }
                    step={1}
                    type="number"
                    value={Math.round(cropState.margins[edge])}
                  />
                </label>
              ))}
            </div>

            <div className="summary-metadata">
              <div className="summary-field">
                <span>Output size</span>
                <strong>
                  {Math.round(cropDimensions.width)} × {Math.round(cropDimensions.height)}
                </strong>
              </div>
              <div className="summary-field">
                <span>Batch apply</span>
                <strong>{selectedPageCount} page(s)</strong>
              </div>
            </div>

            {previewMode ? (
              <div className="crop-preview-card">
                <div
                  className="crop-preview-frame"
                  style={{
                    aspectRatio: `${cropDimensions.width} / ${cropDimensions.height}`,
                    width: `${stageWidth}px`,
                  }}
                >
                  {page.thumbnailDataUrl ? (
                    <img
                      alt={`Preview crop for page ${page.pageNumber}`}
                      className="crop-preview-image"
                      src={page.thumbnailDataUrl}
                      style={{
                        height: `${stageHeight}px`,
                        transform: `translate(${-cropRect.x}px, ${-cropRect.y}px)`,
                        width: `${stageWidth}px`,
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="crop-actions">
              <button className="secondary-button" onClick={onClose} type="button">
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={isApplying}
                onClick={() => onApply(cropState.margins)}
                type="button"
              >
                {isApplying ? `Applying to ${selectedPageCount} page(s)...` : "Apply crop"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
