import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PdfPageInfo } from "../../backend/types/pdf";
import { computeVirtualGridWindow } from "../lib/virtualGrid";

interface PageGridProps {
  pages: PdfPageInfo[];
  isLoading: boolean;
  isInteractive?: boolean;
  dragMode?: "reorder" | "cross-source" | "cross-target" | "readonly";
  crossDocumentDropPageNumber?: number | null;
  gridItemWidth: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onResetZoom(): void;
  selectedPageNumbers: number[];
  onCrossDocumentDragEnd?(): void;
  onCrossDocumentDragStart?(pageNumber: number): void;
  onCrossDocumentDrop?(targetPageNumber: number | null): void;
  onCrossDocumentDropTargetChange?(targetPageNumber: number | null): void;
  onPageClick(pageNumber: number, mode: "replace" | "toggle" | "range"): void;
  onReorderPages(pageNumbers: number[]): void;
  onRotateSelected(rotationDegrees: 90 | 180 | 270): void;
  onDuplicateSelected(): void;
  onDeleteSelected(): void;
  onInsertBlankAfterSelection(): void;
  isApplyingPageAction: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  pageNumber: number;
}

interface SortablePageCardProps {
  page: PdfPageInfo;
  helpTextId: string;
  isInteractive: boolean;
  isDropTarget: boolean;
  isSelected: boolean;
  onOpenContextMenu(event: MouseEvent<HTMLButtonElement>, pageNumber: number): void;
  onSelectPage(event: MouseEvent<HTMLButtonElement>, pageNumber: number): void;
}

interface StaticPageCardProps {
  page: PdfPageInfo;
  isCrossDocumentSource: boolean;
  isDropTarget: boolean;
  isInteractive: boolean;
  isSelected: boolean;
  onCrossDocumentDragEnd?(): void;
  onCrossDocumentDragStart?(pageNumber: number): void;
  onCrossDocumentDrop?(targetPageNumber: number | null): void;
  onCrossDocumentDropTargetChange?(targetPageNumber: number | null): void;
  onOpenContextMenu(event: MouseEvent<HTMLButtonElement>, pageNumber: number): void;
  onSelectPage(event: MouseEvent<HTMLButtonElement>, pageNumber: number): void;
}

function getAspectRatio(page: PdfPageInfo) {
  const displayBox = page.cropBox ?? page.mediaBox;
  const width = Math.max(displayBox[2] - displayBox[0], 1);
  const height = Math.max(displayBox[3] - displayBox[1], 1);
  return `${width} / ${height}`;
}

function getDisplayDimensions(page: PdfPageInfo) {
  const displayBox = page.cropBox ?? page.mediaBox;
  return {
    width: displayBox[2] - displayBox[0],
    height: displayBox[3] - displayBox[1],
  };
}

function getPageLabel(page: PdfPageInfo) {
  return `Page ${page.pageNumber}`;
}

function getSelectionMode(event: MouseEvent<HTMLButtonElement>) {
  if (event.shiftKey) {
    return "range" as const;
  }

  if (event.metaKey || event.ctrlKey) {
    return "toggle" as const;
  }

  return "replace" as const;
}

function PageCardContent({ page }: { page: PdfPageInfo }) {
  const dimensions = getDisplayDimensions(page);

  return (
    <>
      <div className="page-preview-wrap">
        <div className="page-preview" style={{ aspectRatio: getAspectRatio(page) }}>
          <img
            alt={`${getPageLabel(page)} preview`}
            className="page-preview-image"
            src={page.thumbnailDataUrl}
          />
          <span className="page-badge">{getPageLabel(page)}</span>
          {page.cropBox ? <span className="page-badge crop">Cropped</span> : null}
          <div className="page-preview-center">
            <strong>{page.pageNumber}</strong>
            <small>{page.rotation}°</small>
          </div>
        </div>
      </div>
      <div className="page-meta">
        <span>
          {dimensions.width} × {dimensions.height}
        </span>
        <span>{page.cropBox ? "Crop applied" : `Rotate ${page.rotation}°`}</span>
      </div>
    </>
  );
}

function SortablePageCard({
  page,
  helpTextId,
  isInteractive,
  isDropTarget,
  isSelected,
  onOpenContextMenu,
  onSelectPage,
}: SortablePageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.pageNumber, disabled: !isInteractive });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      {...attributes}
      {...listeners}
      aria-describedby={helpTextId}
      aria-label={`${getPageLabel(page)}，${isSelected ? "已选中" : "未选中"}。按空格开始重排。`}
      aria-pressed={isSelected}
      className={`page-card${isSelected ? " selected" : ""}${isDragging ? " dragging" : ""}${isDropTarget ? " drop-target" : ""}`}
      onClick={(event) => {
        if (isInteractive) {
          onSelectPage(event, page.pageNumber);
        }
      }}
      onContextMenu={(event) => {
        if (isInteractive) {
          onOpenContextMenu(event, page.pageNumber);
        }
      }}
      ref={setNodeRef}
      style={style}
      type="button"
    >
      <PageCardContent page={page} />
    </button>
  );
}

function StaticPageCard({
  page,
  isCrossDocumentSource,
  isDropTarget,
  isInteractive,
  isSelected,
  onCrossDocumentDragEnd,
  onCrossDocumentDragStart,
  onCrossDocumentDrop,
  onCrossDocumentDropTargetChange,
  onOpenContextMenu,
  onSelectPage,
}: StaticPageCardProps) {
  return (
    <button
      aria-pressed={isSelected}
      className={`page-card${isSelected ? " selected" : ""}${isDropTarget ? " drop-target" : ""}`}
      draggable={isCrossDocumentSource}
      onClick={(event) => {
        if (isInteractive) {
          onSelectPage(event, page.pageNumber);
        }
      }}
      onContextMenu={(event) => {
        if (isInteractive) {
          onOpenContextMenu(event, page.pageNumber);
        }
      }}
      onDragEnd={() => onCrossDocumentDragEnd?.()}
      onDragOver={(event) => {
        if (!onCrossDocumentDrop) {
          return;
        }

        event.preventDefault();
        onCrossDocumentDropTargetChange?.(page.pageNumber);
      }}
      onDragStart={(event) => {
        if (!isCrossDocumentSource) {
          return;
        }

        event.dataTransfer.effectAllowed = "move";
        onCrossDocumentDragStart?.(page.pageNumber);
      }}
      onDrop={(event) => {
        if (!onCrossDocumentDrop) {
          return;
        }

        event.preventDefault();
        onCrossDocumentDrop(page.pageNumber);
      }}
      type="button"
    >
      <PageCardContent page={page} />
    </button>
  );
}

export function PageGrid({
  pages,
  isLoading,
  isInteractive = true,
  dragMode = "reorder",
  crossDocumentDropPageNumber = null,
  gridItemWidth,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  selectedPageNumbers,
  onCrossDocumentDragEnd,
  onCrossDocumentDragStart,
  onCrossDocumentDrop,
  onCrossDocumentDropTargetChange,
  onPageClick,
  onReorderPages,
  onRotateSelected,
  onDuplicateSelected,
  onDeleteSelected,
  onInsertBlankAfterSelection,
  isApplyingPageAction,
}: PageGridProps) {
  const skeletons = Array.from({ length: 6 }, (_, index) => `skeleton-${index}`);
  const reorderHelpId = "page-grid-reorder-help";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(gridItemWidth * 4);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [activeDragPageNumber, setActiveDragPageNumber] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dropTargetPageNumber, setDropTargetPageNumber] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const virtualWindow = useMemo(
    () =>
      computeVirtualGridWindow({
        itemCount: pages.length,
        gridItemWidth,
        viewportWidth,
        viewportHeight,
        scrollTop,
      }),
    [gridItemWidth, pages.length, scrollTop, viewportHeight, viewportWidth],
  );
  const visiblePages = pages.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  const activeDragPage =
    activeDragPageNumber === null
      ? null
      : pages.find((page) => page.pageNumber === activeDragPageNumber) ?? null;
  const gridStyle = {
    "--page-grid-min": `${gridItemWidth}px`,
    "--page-preview-min-height": `${Math.round(gridItemWidth * 1.28)}px`,
  } as CSSProperties;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const syncMeasurements = () => {
      setViewportWidth(viewport.clientWidth);
      setViewportHeight(viewport.clientHeight);
    };

    syncMeasurements();

    const observer = new ResizeObserver(syncMeasurements);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [pages, gridItemWidth]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        closeContextMenu();
      }
    };

    const handleWindowScroll = () => {
      closeContextMenu();
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleWindowScroll, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleWindowScroll, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeContextMenu, contextMenu]);

  function openContextMenu(event: MouseEvent<HTMLButtonElement>, pageNumber: number) {
    event.preventDefault();

    if (!selectedPageNumbers.includes(pageNumber)) {
      onPageClick(pageNumber, "replace");
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      pageNumber,
    });
  }

  function handleContextMenuAction(action: () => void) {
    action();
    closeContextMenu();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closeContextMenu();
    }
  }

  function resetDragState() {
    setActiveDragPageNumber(null);
    setDropTargetPageNumber(null);
  }

  function handleDragStart(event: DragStartEvent) {
    if (!isInteractive || dragMode !== "reorder") {
      return;
    }
    setActiveDragPageNumber(Number(event.active.id));
    setDropTargetPageNumber(Number(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!isInteractive || dragMode !== "reorder") {
      resetDragState();
      return;
    }

    const overId = event.over?.id;
    const activeId = Number(event.active.id);
    resetDragState();
    if (!overId) {
      return;
    }

    const nextId = Number(overId);
    if (activeId === nextId) {
      return;
    }

    const activeIndex = pages.findIndex((page) => page.pageNumber === activeId);
    const nextIndex = pages.findIndex((page) => page.pageNumber === nextId);
    if (activeIndex === -1 || nextIndex === -1) {
      return;
    }

    const reorderedPageNumbers = arrayMove(pages, activeIndex, nextIndex).map(
      (page) => page.pageNumber,
    );
    onReorderPages(reorderedPageNumbers);
  }

  return (
    <div className="page-grid-shell" style={gridStyle}>
      <div className="page-grid-header">
        <div>
          <p className="panel-kicker">Page Grid</p>
          <h3>Responsive document surface</h3>
        </div>
        <div className="page-grid-tools">
          <p className="page-grid-caption">
            先用页面尺寸和旋转元数据建立网格布局，后续可直接替换成真实缩略图渲染结果。
          </p>
          {isInteractive && dragMode === "reorder" ? (
            <p className="page-grid-accessibility" id={reorderHelpId}>
              拖拽重排：鼠标拖动页面卡片；触屏长按后拖动；键盘聚焦页面后按空格抬起，方向键移动，再按空格放下，按 Escape 取消。
            </p>
          ) : dragMode === "cross-source" || dragMode === "cross-target" ? (
            <p className="page-grid-accessibility" id={reorderHelpId}>
              跨文档移动：从主文档拖动单页到右侧对比文档；放到具体页面上会插入到该页前方，放到空白区域会追加到末尾。
            </p>
          ) : null}
          <div className="zoom-controls" role="group" aria-label="Page grid zoom controls">
            <button onClick={onZoomOut} type="button">
              Compact
            </button>
            <button onClick={onResetZoom} type="button">
              Reset
            </button>
            <button onClick={onZoomIn} type="button">
              Detailed
            </button>
          </div>
        </div>
      </div>

      <div
        className={`page-grid-viewport${pages.length > 0 ? " virtualized" : ""}`}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        ref={viewportRef}
      >
        {pages.length > 0 ? (
          <div className="page-grid-virtual-stack">
            <div style={{ height: `${virtualWindow.paddingTop}px` }} />
            {dragMode === "reorder" ? (
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                onDragCancel={resetDragState}
                onDragOver={(event) =>
                  setDropTargetPageNumber(event.over ? Number(event.over.id) : null)
                }
                onDragStart={handleDragStart}
                sensors={sensors}
              >
                <SortableContext
                  items={pages.map((page) => page.pageNumber)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="page-grid">
                    {visiblePages.map((page) => (
                      <SortablePageCard
                        helpTextId={reorderHelpId}
                        isInteractive={isInteractive}
                        isDropTarget={
                          isInteractive &&
                          dropTargetPageNumber === page.pageNumber &&
                          activeDragPageNumber !== page.pageNumber
                        }
                        isSelected={selectedPageNumbers.includes(page.pageNumber)}
                        key={page.pageNumber}
                        onOpenContextMenu={openContextMenu}
                        onSelectPage={(event, pageNumber) =>
                          onPageClick(pageNumber, getSelectionMode(event))
                        }
                        page={page}
                      />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeDragPage ? (
                    <div className="page-card drag-overlay">
                      <PageCardContent page={activeDragPage} />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <div
                className="page-grid"
                onDragOver={(event) => {
                  if (dragMode !== "cross-target") {
                    return;
                  }

                  event.preventDefault();
                  onCrossDocumentDropTargetChange?.(null);
                }}
                onDrop={(event) => {
                  if (dragMode !== "cross-target") {
                    return;
                  }

                  event.preventDefault();
                  onCrossDocumentDrop?.(null);
                }}
              >
                {visiblePages.map((page) => (
                  <StaticPageCard
                    isCrossDocumentSource={dragMode === "cross-source"}
                    isDropTarget={
                      dragMode === "cross-target" &&
                      crossDocumentDropPageNumber === page.pageNumber
                    }
                    isInteractive={isInteractive}
                    isSelected={selectedPageNumbers.includes(page.pageNumber)}
                    key={page.pageNumber}
                    onCrossDocumentDragEnd={onCrossDocumentDragEnd}
                    onCrossDocumentDragStart={onCrossDocumentDragStart}
                    onCrossDocumentDrop={
                      dragMode === "cross-target" ? onCrossDocumentDrop : undefined
                    }
                    onCrossDocumentDropTargetChange={
                      dragMode === "cross-target"
                        ? onCrossDocumentDropTargetChange
                        : undefined
                    }
                    onOpenContextMenu={openContextMenu}
                    onSelectPage={(event, pageNumber) =>
                      onPageClick(pageNumber, getSelectionMode(event))
                    }
                    page={page}
                  />
                ))}
              </div>
            )}
            <div style={{ height: `${virtualWindow.paddingBottom}px` }} />
          </div>
        ) : null}

        {isLoading && pages.length === 0
          ? skeletons.map((key) => (
              <article className="page-card skeleton" key={key}>
                <div className="page-preview" />
                <div className="page-meta">
                  <span />
                  <span />
                </div>
              </article>
            ))
          : null}
      </div>

      {contextMenu ? (
        <div
          className="page-context-menu"
          onKeyDown={handleMenuKeyDown}
          ref={contextMenuRef}
          role="menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          tabIndex={-1}
        >
          <div className="page-context-menu-label">
            Page {contextMenu.pageNumber}
          </div>
          <button
            disabled={isApplyingPageAction}
            onClick={() => handleContextMenuAction(() => onRotateSelected(90))}
            type="button"
          >
            Rotate 90°
          </button>
          <button
            disabled={isApplyingPageAction}
            onClick={() => handleContextMenuAction(() => onRotateSelected(180))}
            type="button"
          >
            Rotate 180°
          </button>
          <button
            disabled={isApplyingPageAction}
            onClick={() => handleContextMenuAction(() => onRotateSelected(270))}
            type="button"
          >
            Rotate 270°
          </button>
          <button
            disabled={isApplyingPageAction}
            onClick={() => handleContextMenuAction(onDuplicateSelected)}
            type="button"
          >
            Duplicate
          </button>
          <button
            disabled={isApplyingPageAction}
            onClick={() => handleContextMenuAction(onInsertBlankAfterSelection)}
            type="button"
          >
            Insert blank after
          </button>
          <button
            className="danger"
            disabled={isApplyingPageAction}
            onClick={() => handleContextMenuAction(onDeleteSelected)}
            type="button"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
